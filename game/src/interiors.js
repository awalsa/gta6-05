// interiors.js — Enterable interiors for ISLA BRASA 3D (worker W7).
// Garage (Brasa Garage), casino (Coral Room) and safehouse interiors.
// Press F at the door to enter: the screen fades and the player is moved
// into a simple interior room (floor, walls, props, exit door) built far
// from the city. F at the exit door leaves. In the safehouse, F at the bed
// sleeps: advances one day (property income pays out) and saves the game
// via state.saveGame(). In the casino interior, F at the card table opens
// the casino games (ctx.casino.open()).
// Three.js ES module. Exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.

import * as THREE from 'three';
import { LANDMARKS } from './config.js';

// Short names used in this file -> real LANDMARKS keys in config.js.
const LM = {
  garage: 'brasaGarage', casino: 'coralCasino', motel: 'motelVela',
};

const FALLBACK = {
  garage: { x: 80, z: -40 },
  casino: { x: 120, z: 120 },
  motel: { x: -40, z: 40 },
};

function lmPos(name) {
  const key = LM[name] || name;
  const src = (LANDMARKS && LANDMARKS[key]) || FALLBACK[name] || { x: 0, z: 0 };
  if (Array.isArray(src)) return new THREE.Vector3(src[0], 0, src[1]);
  if (src && src.position) return new THREE.Vector3(src.position.x || 0, 0, src.position.z || 0);
  if (src && typeof src.x === 'number') return new THREE.Vector3(src.x, 0, src.z || 0);
  return new THREE.Vector3(0, 0, 0);
}

function keyDown(ctx, code) {
  const inp = (ctx && ctx.input) || {};
  if (typeof inp.isDown === 'function') return !!inp.isDown(code);
  if (inp.keys instanceof Set) return inp.keys.has(code);
  if (inp.keys) return !!inp.keys[code];
  if (typeof inp[code] === 'boolean') return inp[code];
  return false;
}

function playerPos(ctx) {
  if (ctx.player) {
    if (ctx.player.position) return ctx.player.position;
    if (ctx.player.mesh && ctx.player.mesh.position) return ctx.player.mesh.position;
    if (typeof ctx.player.getPosition === 'function') return ctx.player.getPosition();
  }
  if (ctx.state && ctx.state.playerPos) return ctx.state.playerPos;
  if (ctx.camera) return ctx.camera.position;
  return new THREE.Vector3(0, 0, 0);
}

function setPlayerPos(ctx, v) {
  if (ctx.player) {
    if (ctx.player.position && typeof ctx.player.position.copy === 'function') { ctx.player.position.copy(v); return; }
    if (ctx.player.mesh && ctx.player.mesh.position) { ctx.player.mesh.position.copy(v); return; }
    if (typeof ctx.player.setPosition === 'function') { ctx.player.setPosition(v); return; }
  }
  if (ctx.state && ctx.state.playerPos && typeof ctx.state.playerPos.copy === 'function') ctx.state.playerPos.copy(v);
}

function toast(ctx, msg) {
  if (ctx && typeof ctx.notify === 'function') { ctx.notify(msg); return; }
  if (typeof document !== 'undefined') {
    let el = document.getElementById('hud-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-toast';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;z-index:9999;pointer-events:none;transition:opacity .4s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
  }
  console.log('[interiors]', msg);
}

function setPrompt(msg) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('hud-prompt');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud-prompt';
    el.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);color:#ffe9a8;padding:6px 12px;border-radius:6px;font:13px sans-serif;z-index:9998;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// Interior rooms live far outside the city so they never collide with it.
const ROOMS = {
  garage: { center: new THREE.Vector3(1000, 0, 1000), wall: 0x3a3f4a, floor: 0x555a66, label: 'Brasa Garage' },
  casino: { center: new THREE.Vector3(1060, 0, 1000), wall: 0x4a1030, floor: 0x2a0a1a, label: 'Coral Room' },
  safehouse: { center: new THREE.Vector3(1120, 0, 1000), wall: 0x2a3a4a, floor: 0x6b4a2a, label: 'Safehouse' },
};

function box(w, h, d, color, x, y, z, emissive) {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: emissive || 0x000000, emissiveIntensity: emissive ? 0.6 : 0 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildRoom(ctx, place) {
  const room = ROOMS[place];
  const c = room.center;
  const g = new THREE.Group();
  g.position.copy(c);

  // Floor + 4 walls (no ceiling, so the scene light reaches in).
  g.add(box(14, 0.3, 11, room.floor, 0, -0.15, 0));
  g.add(box(14, 4, 0.4, room.wall, 0, 2, -5.5));
  g.add(box(14, 4, 0.4, room.wall, 0, 2, 5.5));
  g.add(box(0.4, 4, 11, room.wall, -7, 2, 0));
  g.add(box(0.4, 4, 11, room.wall, 7, 2, 0));
  // Warm ceiling lamp.
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 })
  );
  lamp.position.set(0, 3.6, 0);
  g.add(lamp);
  const light = new THREE.PointLight(0xffe9a8, 60, 18);
  light.position.set(0, 3.4, 0);
  g.add(light);

  // Exit door: glowing panel on the south wall.
  const door = box(1.6, 2.6, 0.2, 0x2ecc71, 0, 1.3, 5.3, 0x2ecc71);
  door.name = 'exitDoor';
  g.add(door);

  if (place === 'garage') {
    // Workbench, tool shelf, tires, a car lift pad.
    g.add(box(3.5, 0.9, 1.2, 0x8b5a2b, -4.5, 0.45, -4.2));
    g.add(box(2.5, 2.2, 0.6, 0x5a5a5a, 4.5, 1.1, -4.8));
    for (let i = 0; i < 3; i++) {
      const tire = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.2, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      tire.position.set(5.5 - i * 1.1, 0.45, 3.5);
      tire.rotation.y = Math.PI / 2;
      g.add(tire);
    }
    g.add(box(4, 0.25, 2, 0xd4af37, 0, 0.12, -1)); // lift pad
    g.add(box(0.8, 1.6, 0.8, 0xe74c3c, -5.5, 0.8, 2)); // oil drum
  } else if (place === 'casino') {
    // Slot machines along the north wall, card table, bar counter.
    for (let i = -1; i <= 1; i++) {
      const slot = box(1.1, 1.9, 0.7, 0xd4af37, i * 2.2, 0.95, -4.6, 0xd4af37);
      slot.name = 'slotMachine';
      g.add(slot);
    }
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.25, 12),
      new THREE.MeshStandardMaterial({ color: 0x0a6b2a })
    );
    table.position.set(0, 0.8, -1);
    table.name = 'cardTable';
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.5, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
    );
    leg.position.set(0, 0.4, -1);
    g.add(table, leg);
    g.add(box(4, 1.1, 1, 0x6b2a1a, -4.5, 0.55, 3.5)); // bar
    for (let i = 0; i < 4; i++) {
      const chip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: [0xff3366, 0x2ecc71, 0x3498db, 0xffc300][i] })
      );
      chip.position.set(-0.8 + i * 0.5, 0.97, -1);
      g.add(chip);
    }
  } else {
    // Safehouse: bed, table, TV, wardrobe.
    const bed = box(2.2, 0.5, 4, 0x7a4a6b, -4.5, 0.25, -3);
    bed.name = 'bed';
    const pillow = box(1.8, 0.25, 0.8, 0xf5f5f5, -4.5, 0.6, -4.6);
    const blanket = box(2.0, 0.12, 2.4, 0x2e86c1, -4.5, 0.55, -2.2);
    g.add(bed, pillow, blanket);
    g.add(box(2, 0.8, 1.2, 0x8b5a2b, 3.5, 0.4, -4.2)); // table
    const tv = box(2.2, 1.3, 0.15, 0x111111, 3.5, 1.8, -5.2, 0x224466);
    g.add(tv);
    g.add(box(2, 2.4, 0.8, 0x5a3a2a, 5.5, 1.2, 2.5)); // wardrobe
    g.add(box(1.2, 0.8, 1.2, 0x2ecc71, -5.5, 0.4, 3.5)); // crate
  }

  ctx.scene.add(g);
  return g;
}

function fadeTo(opacity, ms, done) {
  if (typeof document === 'undefined') { if (done) done(); return; }
  let el = document.getElementById('interior-fade');
  if (!el) {
    el = document.createElement('div');
    el.id = 'interior-fade';
    el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .3s;z-index:10001;';
    document.body.appendChild(el);
  }
  el.style.transition = 'opacity ' + (ms / 1000) + 's';
  el.style.opacity = String(opacity);
  setTimeout(() => { if (done) done(); }, ms + 30);
}

let S = null;

export function init(ctx) {
  S = {
    ctx,
    inside: null,
    returnPos: null,
    rooms: {},
    doors: {
      // Doors sit just OUTSIDE each building's footprint: the player is
      // pushed out of the AABBs, so a door at the landmark centre (or an
      // offset still inside the footprint) could never be reached.
      garage: lmPos('garage').add(new THREE.Vector3(0, 0, 11)),
      casino: lmPos('casino').add(new THREE.Vector3(-14, 0, 0)),
      safehouse: lmPos('motel').add(new THREE.Vector3(0, 0, 8)),
    },
    prevF: false,
    transitioning: false,
  };

  if (ctx.scene) {
    for (const place of Object.keys(ROOMS)) {
      S.rooms[place] = buildRoom(ctx, place);
    }
    // Door markers in the world: glowing green doorway panels.
    for (const [place, pos] of Object.entries(S.doors)) {
      const marker = box(1.6, 2.6, 0.2, 0x2ecc71, pos.x, 1.3, pos.z, 0x2ecc71);
      ctx.scene.add(marker);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 1.7, 24),
        new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, 0.15, pos.z);
      ctx.scene.add(ring);
    }
  }

  const api = {
    get inside() { return S.inside; },
    enter(place) { enter(ctx, place); },
    exit() { exitInterior(ctx); },
  };
  ctx.interiors = api;
  return api;
}

function enter(ctx, place) {
  if (!S || !ROOMS[place] || S.inside || S.transitioning) return false;
  if (ctx.plane && ctx.plane.inPlane) return false;
  S.transitioning = true;
  S.returnPos = playerPos(ctx).clone();
  fadeTo(1, 300, () => {
    S.inside = place;
    const room = ROOMS[place];
    setPlayerPos(ctx, room.center.clone().add(new THREE.Vector3(0, 0, 3)));
    if (ctx.state) ctx.state.insideInterior = place;
    fadeTo(0, 300, () => { S.transitioning = false; });
    toast(ctx, 'You enter the ' + room.label + '.' + (place === 'safehouse' ? ' Press F at the bed to sleep & save.' : place === 'casino' ? ' Press F at the card table to play.' : ''));
  });
  return true;
}

function exitInterior(ctx) {
  if (!S || !S.inside || S.transitioning) return false;
  const place = S.inside;
  S.transitioning = true;
  fadeTo(1, 300, () => {
    S.inside = null;
    if (S.returnPos) setPlayerPos(ctx, S.returnPos);
    if (ctx.state) ctx.state.insideInterior = null;
    fadeTo(0, 300, () => { S.transitioning = false; });
    toast(ctx, 'You leave the ' + ROOMS[place].label + '.');
  });
  return true;
}

function sleep(ctx) {
  if (ctx.state) {
    if (typeof ctx.state.day === 'number') ctx.state.day += 1; // a new day: property income pays out
    if (typeof ctx.state.saveGame === 'function') {
      try {
        ctx.state.saveGame();
        toast(ctx, 'You sleep… game saved. A new day begins (Day ' + ctx.state.day + ').');
        return;
      } catch (e) { /* fall through */ }
    }
  }
  if (typeof ctx.saveGame === 'function') {
    try { ctx.saveGame(); toast(ctx, 'You sleep… game saved. A new day begins.'); return; } catch (e) { /* fall through */ }
  }
  toast(ctx, 'You sleep… but there is no save function to call (state.saveGame missing).');
}

export function update(dt, ctx) {
  if (!S || S.transitioning) return;
  const p = playerPos(ctx);
  const fDown = keyDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;

  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;

  if (!S.inside) {
    // Outside: F at a door enters that interior.
    if (fPressed && !overlayOpen && !inPlane) {
      for (const [place, doorPos] of Object.entries(S.doors)) {
        if (p.distanceTo(doorPos) < 4) { enter(ctx, place); return; }
      }
    }
    if (!overlayOpen && !inPlane) {
      for (const [place, doorPos] of Object.entries(S.doors)) {
        if (p.distanceTo(doorPos) < 4) {
          setPrompt('Press F — Enter the ' + ROOMS[place].label);
          return;
        }
      }
    }
    return;
  }

  // Inside an interior.
  const room = ROOMS[S.inside];
  const exitPos = room.center.clone().add(new THREE.Vector3(0, 0, 5));
  if (fPressed && !overlayOpen) {
    if (p.distanceTo(exitPos) < 3.5) { exitInterior(ctx); return; }
    if (S.inside === 'safehouse') {
      const bedPos = room.center.clone().add(new THREE.Vector3(-4.5, 0, -3));
      if (p.distanceTo(bedPos) < 3.5) { sleep(ctx); return; }
    }
    if (S.inside === 'casino') {
      const tablePos = room.center.clone().add(new THREE.Vector3(0, 0, -1));
      if (p.distanceTo(tablePos) < 3.5) {
        if (ctx.casino && typeof ctx.casino.open === 'function') ctx.casino.open();
        else toast(ctx, 'The casino games are not loaded (ctx.casino missing).');
        return;
      }
    }
    if (S.inside === 'garage' && ctx.state && Array.isArray(ctx.state.garageOwned)) {
      toast(ctx, 'Your garage holds ' + ctx.state.garageOwned.length + ' car(s). Buy more outside with G.');
      return;
    }
  }

  // Contextual prompt while inside.
  let prompt = '';
  if (!overlayOpen) {
    if (p.distanceTo(exitPos) < 3.5) prompt = 'Press F — Leave the ' + room.label;
    else if (S.inside === 'safehouse' && p.distanceTo(room.center.clone().add(new THREE.Vector3(-4.5, 0, -3))) < 3.5) prompt = 'Press F — Sleep & save the game';
    else if (S.inside === 'casino' && p.distanceTo(room.center.clone().add(new THREE.Vector3(0, 0, -1))) < 3.5) prompt = 'Press F — Play slots, blackjack & roulette';
  }
  setPrompt(prompt);
}
