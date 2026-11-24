// dialogue.js — ISLA BRASA 3D: dialogue boxes, NPC lines, mission briefs.
// Worker W5 (HUD + economy + dialogue). Built from the design specs only.
// Shared contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.
// Renders into #dialogue-box (created by game/index.html; created here if missing).

const DEFAULT_LINE_MS = 4000;

// Fresh NPC chatter lines (written for this build, not copied from anywhere).
export const NPC_LINES = [
  'You look new around Brasa. Watch yourself after dark.',
  'The Coral Room pays out big tonight, or so they say.',
  'Rico at the garage can get you a car that actually runs.',
  'Heard the Vela job went sideways. Again.',
  'Feria Market has the best tamales on the island. Fact.',
  'Police have been stopping everyone near the tunnel.',
  'If you want work, ask around the plaza. Somebody always needs a driver.',
  'The beach at sunset? Best free thing on this island.',
  'Ghost says the casino cameras are blind on Tuesdays. Don\'t quote me.',
  'Marta doesn\'t miss. If she offers to ride along, say yes.',
];

export const MISSION_GIVER_LINES = {
  default: 'Got a job for you. Read the brief and get moving — time is money.',
};

let queue = [];
let current = null; // { speaker, text, until }
let boxEl = null;
let nameEl = null;
let textEl = null;
let boundCtx = null;

function ensureBox() {
  if (boxEl && document.body.contains(boxEl)) return boxEl;
  boxEl = document.getElementById('dialogue-box');
  if (!boxEl) {
    boxEl = document.createElement('div');
    boxEl.id = 'dialogue-box';
    boxEl.className = 'dialogue-box';
    boxEl.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:90px', 'transform:translateX(-50%)',
      'min-width:280px', 'max-width:560px', 'padding:12px 16px',
      'background:rgba(10,10,18,0.88)', 'color:#fff',
      'border:1px solid rgba(255,255,255,0.25)', 'border-radius:10px',
      'font-family:system-ui,sans-serif', 'font-size:15px', 'line-height:1.4',
      'z-index:60', 'display:none', 'pointer-events:none',
    ].join(';');
    nameEl = document.createElement('div');
    nameEl.id = 'dialogue-speaker';
    nameEl.style.cssText = 'font-weight:700;color:#ffd34d;margin-bottom:4px;';
    textEl = document.createElement('div');
    textEl.id = 'dialogue-text';
    boxEl.appendChild(nameEl);
    boxEl.appendChild(textEl);
    document.body.appendChild(boxEl);
  } else {
    nameEl = boxEl.querySelector('#dialogue-speaker');
    textEl = boxEl.querySelector('#dialogue-text');
    if (!nameEl) {
      nameEl = document.createElement('div');
      nameEl.id = 'dialogue-speaker';
      boxEl.prepend(nameEl);
    }
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.id = 'dialogue-text';
      boxEl.appendChild(textEl);
    }
  }
  return boxEl;
}

function showNext() {
  const box = ensureBox();
  if (!queue.length) {
    current = null;
    box.style.display = 'none';
    return;
  }
  current = queue.shift();
  if (nameEl) nameEl.textContent = current.speaker || '';
  if (textEl) textEl.textContent = current.text || '';
  box.style.display = 'block';
}

function pickNpcLine() {
  return NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)];
}

export function init(ctx) {
  boundCtx = ctx || null;
  queue = [];
  current = null;
  if (typeof document !== 'undefined') ensureBox();

  const api = {
    // showDialogue(speaker, text, ms): one line, queued behind any current line.
    show(speaker, text, ms) {
      queue.push({
        speaker: speaker || '???',
        text: String(text == null ? '' : text),
        ms: typeof ms === 'number' && ms > 0 ? ms : DEFAULT_LINE_MS,
      });
      if (!current) showNext();
      return true;
    },
    // Alias with the spec's plain name.
    showDialogue(speaker, text, ms) { return api.show(speaker, text, ms); },

    // showBrief(title, lines): mission brief — title line, then each line in turn.
    // lines may be a string or an array of strings.
    showBrief(title, lines) {
      const list = Array.isArray(lines) ? lines : [String(lines == null ? '' : lines)];
      queue.push({
        speaker: String(title || 'Mission'),
        text: list.length ? String(list[0]) : '',
        ms: 5000,
      });
      for (let i = 1; i < list.length; i++) {
        queue.push({ speaker: String(title || 'Mission'), text: String(list[i]), ms: 5000 });
      }
      if (!current) showNext();
      return true;
    },

    // NPC line when the player presses F near a pedestrian / mission giver.
    // speakerName optional; picks a random chatter line if no text is given.
    speakTo(speakerName, text) {
      const speaker = speakerName || 'Pedestrian';
      return api.show(speaker, text || pickNpcLine(), DEFAULT_LINE_MS);
    },
    randomNpcLine: pickNpcLine,

    // Skip / dismiss the current line immediately.
    dismiss() {
      current = null;
      showNext();
    },
    clear() {
      queue = [];
      current = null;
      const box = ensureBox();
      box.style.display = 'none';
    },
    get isShowing() { return !!current; },
    get queuedCount() { return queue.length; },
  };

  if (ctx) ctx.dialogue = api;

  // F-interact hook (player.js calls ctx.onInteract(player.pos) on an F
  // edge): the nearest pedestrian within 4.5 units speaks a line. Combat owns
  // F when a live enemy is within punch range, so never talk over a punch.
  if (ctx && typeof ctx.onInteract !== 'function') {
    ctx.onInteract = (pos) => {
      if (!pos || typeof pos.x !== 'number' || typeof pos.z !== 'number') return false;
      const enemies = ctx.combat && Array.isArray(ctx.combat.enemies) ? ctx.combat.enemies : [];
      for (const e of enemies) {
        if (e && e.alive && e.pos && Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) < 3) return false;
      }
      const list = ctx.pedestrians && Array.isArray(ctx.pedestrians.list) ? ctx.pedestrians.list : [];
      let best = null;
      let bestD = 4.5;
      for (const ped of list) {
        if (!ped || !ped.mesh) continue;
        const d = Math.hypot(ped.mesh.position.x - pos.x, ped.mesh.position.z - pos.z);
        if (d < bestD) { bestD = d; best = ped; }
      }
      if (!best) return false;
      api.speakTo('Pedestrian');
      return true;
    };
  }
  return api;
}

export function update(dt, ctx) {
  if (!current) {
    if (queue.length) showNext();
    return;
  }
  // current.ms counts down in real seconds (dt is seconds per frame).
  current.ms -= (typeof dt === 'number' ? dt : 0) * 1000;
  if (current.ms <= 0) showNext();
}

export default { init, update, NPC_LINES };
