// audio.js — WebAudio music (112 BPM synth loop) + SFX for ISLA BRASA 3D.
// No external audio files: everything is synthesized with oscillators/noise.
// init(ctx) / update(dt, ctx). Attaches ctx.audio = { playSfx, setMusic, setPattern, muted, toggleMute }.
// Music starts only after a first user gesture (AudioContext resume on keydown/click).
import * as THREE from 'three';
import * as Config from './config.js';

const BPM_DEFAULT = Config.BPM ?? 112;

// ---- Pattern definitions: [bassNotes, leadNotes, hatDensity] per 16-step bar ----
// Notes are semitone offsets from A2 (110 Hz) for bass, A4 (440 Hz) for lead. -1 = rest.
const PATTERNS = {
  brasa: { // Brasa FM — upbeat 112 BPM (default)
    bpm: 112,
    bass: [0, -1, 0, -1, 3, -1, 0, -1, 5, -1, 3, -1, 7, -1, 5, 3],
    lead: [12, -1, 15, -1, 19, -1, 15, 12, 17, -1, 19, -1, 24, -1, 19, 15],
    wave: 'sawtooth', leadWave: 'square', hatEvery: 2,
  },
  chill: { // Coral Chill — slower, mellow
    bpm: 84,
    bass: [0, -1, -1, -1, -3, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1],
    lead: [12, -1, -1, 16, -1, -1, 19, -1, -1, 17, -1, -1, 16, -1, -1, -1],
    wave: 'sine', leadWave: 'sine', hatEvery: 4,
  },
  rock: { // Turbo Rock — driving rock loop
    bpm: 132,
    bass: [0, 0, -1, 0, -1, 0, 3, -1, 0, 0, -1, 0, 5, -1, 7, -1],
    lead: [12, 12, -1, 15, -1, 12, -1, 19, -1, 17, -1, 15, -1, 12, -1, 24],
    wave: 'sawtooth', leadWave: 'sawtooth', hatEvery: 1,
  },
};

function noteFreq(semi, base) {
  return base * Math.pow(2, semi / 12);
}

let ctxRef = null;
let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let noiseBuffer = null;

let musicOn = true;
let muted = false;
let currentPattern = 'brasa';
let step = 0;
let nextStepTime = 0;
let schedulerTimer = null;

// Engine hum nodes (created lazily on first gesture).
let engineOsc = null;
let engineGain = null;
let engineFilter = null;

// Siren nodes.
let sirenOsc = null;
let sirenLfo = null;
let sirenGain = null;
let sirenOn = false;

function ensureContext() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = muted ? 0 : 0.9;
  masterGain.connect(audioCtx.destination);
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.32;
  musicGain.connect(masterGain);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(masterGain);
  // Shared white-noise buffer for hats / gunshots.
  const len = audioCtx.sampleRate * 1;
  noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  // Engine hum: low sawtooth through a lowpass, gain driven by speed in update().
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 42;
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 320;
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(sfxGain);
  engineOsc.start();
  startScheduler();
  return audioCtx;
}

function scheduleStep(stepIdx, t) {
  const p = PATTERNS[currentPattern] || PATTERNS.brasa;
  const bassNote = p.bass[stepIdx % 16];
  if (bassNote >= 0) {
    const o = audioCtx.createOscillator();
    o.type = p.wave;
    o.frequency.value = noteFreq(bassNote, 110);
    const g = audioCtx.createGain();
    const stepDur = 60 / p.bpm / 4;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + stepDur);
  }
  const leadNote = p.lead[stepIdx % 16];
  if (leadNote >= 0) {
    const o = audioCtx.createOscillator();
    o.type = p.leadWave;
    o.frequency.value = noteFreq(leadNote, 440);
    const g = audioCtx.createGain();
    const stepDur = 60 / p.bpm / 4;
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.8);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + stepDur * 2);
  }
  if (stepIdx % p.hatEvery === 0) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = audioCtx.createGain();
    const stepDur = 60 / p.bpm / 4;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.5);
    src.connect(hp); hp.connect(g); g.connect(musicGain);
    src.start(t, Math.random() * 0.5, stepDur);
  }
}

function startScheduler() {
  if (schedulerTimer || !audioCtx) return;
  step = 0;
  nextStepTime = audioCtx.currentTime + 0.05;
  schedulerTimer = setInterval(() => {
    if (!musicOn || muted) {
      // Keep the clock moving so music resumes in time.
      const p = PATTERNS[currentPattern] || PATTERNS.brasa;
      const stepDur = 60 / p.bpm / 4;
      while (nextStepTime < audioCtx.currentTime + 0.15) {
        nextStepTime += stepDur;
        step = (step + 1) % 16;
      }
      return;
    }
    const p = PATTERNS[currentPattern] || PATTERNS.brasa;
    const stepDur = 60 / p.bpm / 4;
    while (nextStepTime < audioCtx.currentTime + 0.15) {
      scheduleStep(step, nextStepTime);
      nextStepTime += stepDur;
      step = (step + 1) % 16;
    }
  }, 40);
}

function setSiren(on) {
  if (!audioCtx || on === sirenOn) return;
  sirenOn = on;
  if (on) {
    sirenOsc = audioCtx.createOscillator();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 770;
    sirenLfo = audioCtx.createOscillator();
    sirenLfo.type = 'square';
    sirenLfo.frequency.value = 0.55; // two-tone alternation ~0.9 s per tone
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 165; // swings 770 +/- 165 Hz (605 / 935 Hz)
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenGain = audioCtx.createGain();
    sirenGain.gain.value = 0.0;
    sirenGain.gain.linearRampToValueAtTime(0.07, audioCtx.currentTime + 0.4);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(sfxGain);
    sirenOsc.start();
    sirenLfo.start();
  } else if (sirenOsc) {
    const t = audioCtx.currentTime;
    sirenGain.gain.linearRampToValueAtTime(0.0, t + 0.2);
    sirenOsc.stop(t + 0.3);
    sirenLfo.stop(t + 0.3);
    sirenOsc = null; sirenLfo = null; sirenGain = null;
  }
}

function playSfx(name) {
  if (muted) return;
  ensureContext();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  if (name === 'gunshot') {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t, Math.random() * 0.4, 0.2);
  } else if (name === 'pickup') {
    [880, 1318.5].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = audioCtx.createGain();
      const t0 = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
      o.connect(g); g.connect(sfxGain);
      o.start(t0); o.stop(t0 + 0.4);
    });
  } else if (name === 'click') {
    const o = audioCtx.createOscillator();
    o.type = 'square'; o.frequency.value = 1200;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + 0.07);
  } else if (name === 'siren') {
    setSiren(true);
    setTimeout(() => setSiren(false), 2500);
  } else if (name === 'explosion') {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(lp); lp.connect(g); g.connect(sfxGain);
    src.start(t, 0, 1.0);
  }
}

function toggleMute() {
  muted = !muted;
  if (masterGain && audioCtx) {
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 0.9, audioCtx.currentTime + 0.1);
  }
  if (ctxRef && ctxRef.hud && ctxRef.hud.showMessage) {
    ctxRef.hud.showMessage(muted ? 'Audio muted (N)' : 'Audio on (N)');
  }
  return muted;
}

function onFirstGesture() {
  ensureContext();
}

export function init(ctx) {
  ctxRef = ctx;
  ctx.state = ctx.state || {};
  // Mute key N toggles all audio. Gesture listeners init/resume the AudioContext.
  const onKey = (e) => {
    ensureContext();
    if (e.code === 'KeyN' && !e.repeat) toggleMute();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('click', onFirstGesture);

  ctx.audio = {
    playSfx,
    playPickup() { playSfx('pickup'); },
    setMusic(on) { musicOn = !!on; },
    setPattern(name) {
      if (PATTERNS[name]) { currentPattern = name; step = 0; }
    },
    toggleMute,
    get muted() { return muted; },
    get musicOn() { return musicOn; },
    get pattern() { return currentPattern; },
  };
  // Keep the BPM constant visible for other modules.
  ctx.audio.bpm = BPM_DEFAULT;
}

function getSpeed(ctx) {
  const s = ctx.state || {};
  if (typeof s.speed === 'number') return s.speed;
  if (s.vehicle && typeof s.vehicle.speed === 'number') return s.vehicle.speed;
  if (ctx.vehicle && typeof ctx.vehicle.speed === 'number') return ctx.vehicle.speed;
  return 0;
}

function isInCar(ctx) {
  const s = ctx.state || {};
  return !!(s.inCar || s.driving || s.vehicle || ctx.vehicle);
}

export function update(dt, ctx) {
  if (!audioCtx) return;
  // Engine hum follows car speed; silent on foot.
  const inCar = isInCar(ctx);
  const speed = Math.abs(getSpeed(ctx));
  if (engineGain && engineOsc) {
    const target = inCar ? Math.min(0.22, 0.05 + speed * 0.006) : 0;
    engineGain.gain.setTargetAtTime(muted ? 0 : target, audioCtx.currentTime, 0.08);
    engineOsc.frequency.setTargetAtTime(42 + speed * 3.2, audioCtx.currentTime, 0.1);
  }
  // Wanted siren while wanted level is 3+.
  const wanted = (ctx.state && typeof ctx.state.wanted === 'number') ? ctx.state.wanted : 0;
  setSiren(wanted >= 3 && !muted);
}
