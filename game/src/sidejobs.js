// sidejobs.js — Side jobs for ISLA BRASA 3D (worker W7).
// Taxi job ($120/fare), delivery job ($100/delivery, +$50 fast bonus),
// 10 collectible orbs ($50 each). Start jobs with F near the job marker.
// Three.js ES module. Exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.

import * as THREE from 'three';
import { LANDMARKS, SIDE_JOBS, ORB_COUNT } from './config.js';

// Payouts from config.js (fallbacks if the config shape ever changes).
const TAXI_FARE = (SIDE_JOBS && SIDE_JOBS.taxi) || 120;
const DELIVERY_PAY = (SIDE_JOBS && SIDE_JOBS.delivery) || 100;
const DELIVERY_BONUS = (SIDE_JOBS && SIDE_JOBS.deliveryFastBonus) || 50;
const ORB_PAY = (SIDE_JOBS && SIDE_JOBS.orb) || 50;
const TOTAL_ORBS = ORB_COUNT || 10;

// Short names used in this file -> real LANDMARKS keys in config.js.
const LM = {
  market: 'feriaMarket', plaza: 'plazaTower', pier: 'oldPier',
  marina: 'marinaDocks', garage: 'brasaGarage', arcade: 'rookArcade',
  casino: 'coralCasino', tunnel: 'coastTunnel', motel: 'motelVela',
  church: 'oldChurch', beach: 'beachfront', underpass: 'underpass',
};

// ---- fallback landmark coords (mirror config.js; used only if a key is missing) ----
const FALLBACK = {
  market: { x: 0, z: -80 },
  plaza: { x: 0, z: 0 },
  pier: { x: -160, z: 170 },
  marina: { x: -120, z: 175 },
  garage: { x: 80, z: -40 },
  arcade: { x: 40, z: 80 },
  casino: { x: 120, z: 120 },
  tunnel: { x: -80, z: -160 },
  motel: { x: -40, z: 40 },
  church: { x: -120, z: -120 },
  beach: { x: 160, z: 170 },
  underpass: { x: 0, z: 150 },
};

function lmPos(name) {
  const key = LM[name] || name;
  const src = (LANDMARKS && LANDMARKS[key]) || FALLBACK[name] || { x: 0, z: 0 };
  if (Array.isArray(src)) return new THREE.Vector3(src[0], 0, src[1]);
  if (src && src.position) return new THREE.Vector3(src.position.x || 0, 0, src.position.z || 0);
  if (src && typeof src.x === 'number') return new THREE.Vector3(src.x, 0, src.z || 0);
  return new THREE.Vector3(0, 0, 0);
}

// Nudge a job destination out of any building footprint: landmark centres
// sit inside their own buildings and the player is pushed out of those
// AABBs, so a dropoff at the exact centre (church, plaza, casino...) could
// never come within the 7-unit completion radius. Same fix as missions.js.
function openPointNear(ctx, pos) {
  const buildings = (ctx && ctx.world && ctx.world.buildings) || [];
  let x = pos.x;
  let z = pos.z;
  for (const b of buildings) {
    const r = 2;
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
      const dxl = x - (b.minX - r);
      const dxr = (b.maxX + r) - x;
      const dzl = z - (b.minZ - r);
      const dzr = (b.maxZ + r) - z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) x = b.minX - r;
      else if (m === dxr) x = b.maxX + r;
      else if (m === dzl) z = b.minZ - r;
      else z = b.maxZ + r;
    }
  }
  return new THREE.Vector3(x, 0, z);
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

function getCash(ctx) {
  if (ctx.economy && typeof ctx.economy.getCash === 'function') return ctx.economy.getCash();
  if (ctx.economy && typeof ctx.economy.balance === 'number') return ctx.economy.balance;
  if (ctx.state) return ctx.state.cash || 0;
  return 0;
}

function addCash(ctx, amount) {
  if (ctx.economy && typeof ctx.economy.addCash === 'function') { ctx.economy.addCash(amount); return; }
  if (ctx.economy && typeof ctx.economy.earn === 'function') { ctx.economy.earn(amount); return; }
  if (ctx.state) ctx.state.cash = (ctx.state.cash || 0) + amount;
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
  console.log('[sidejobs]', msg);
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

// ---- orb spots: 10 hidden around the city ----
const ORB_SPOTS = [
  { name: 'pier', off: [6, 2, 0] },
  { name: 'marina', off: [-8, 2, 4] },
  { name: 'beach', off: [10, 2, -6] },
  { name: 'church', off: [0, 2, 8] },
  { name: 'tunnel', off: [-6, 2, -6] },
  { name: 'arcade', off: [8, 2, 8] },
  { name: 'plaza', off: [-10, 2, -4] },
  { name: 'motel', off: [6, 2, 6] },
  { name: 'garage', off: [-8, 2, -8] },
  { name: 'casino', off: [10, 2, 10] },
];

const DEST_NAMES = ['market', 'pier', 'marina', 'garage', 'arcade', 'casino', 'motel', 'church', 'plaza', 'beach'];

function makeBeacon(color) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 30, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  cyl.position.y = 15;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.8, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color })
  );
  gem.position.y = 3.2;
  g.add(cyl, ring, gem);
  g.userData.gem = gem;
  return g;
}

function makePedestrian(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a })
  );
  head.position.y = 1.75;
  g.add(body, head);
  return g;
}

let S = null; // module state, set in init

export function init(ctx) {
  const taxiMarkerPos = lmPos('plaza').add(new THREE.Vector3(6, 0, 0));
  const deliveryMarkerPos = lmPos('market').add(new THREE.Vector3(-8, 0, 0));

  S = {
    ctx,
    orbsCollected: 0,
    orbsTotal: ORB_SPOTS.length,
    orbs: [],
    taxi: { active: false, phase: 'idle', passenger: null, dest: null, destName: '' },
    delivery: { active: false, dest: null, destName: '', timer: 0, elapsed: 0 },
    taxiMarkerPos,
    deliveryMarkerPos,
    taxiBeacon: null,
    deliveryBeacon: null,
    destBeacon: null,
    passengerMesh: null,
    prevF: false,
    hudEl: null,
    time: 0,
  };

  if (ctx.scene) {
    // Job markers (beacons).
    S.taxiBeacon = makeBeacon(0xffc300); // yellow = taxi
    S.taxiBeacon.position.copy(taxiMarkerPos);
    ctx.scene.add(S.taxiBeacon);
    S.deliveryBeacon = makeBeacon(0x2ecc71); // green = delivery
    S.deliveryBeacon.position.copy(deliveryMarkerPos);
    ctx.scene.add(S.deliveryBeacon);
    S.destBeacon = makeBeacon(0xff3366); // pink = current destination
    S.destBeacon.visible = false;
    ctx.scene.add(S.destBeacon);

    // 10 glowing orbs.
    const orbGeo = new THREE.SphereGeometry(0.5, 14, 14);
    for (const spot of ORB_SPOTS) {
      const base = lmPos(spot.name);
      const pos = new THREE.Vector3(base.x + spot.off[0], spot.off[1], base.z + spot.off[2]);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x66e0ff, emissive: 0x33bbff, emissiveIntensity: 1.6, transparent: true, opacity: 0.95,
      });
      const orb = new THREE.Mesh(orbGeo, mat);
      orb.position.copy(pos);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.22, depthWrite: false })
      );
      orb.add(halo);
      orb.userData = { taken: false, baseY: pos.y };
      ctx.scene.add(orb);
      S.orbs.push(orb);
    }
  }

  if (typeof document !== 'undefined') {
    let el = document.getElementById('hud-sidejobs');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-sidejobs';
      el.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(0,0,0,0.6);color:#bfefff;padding:6px 10px;border-radius:6px;font:12px sans-serif;z-index:9997;pointer-events:none;';
      document.body.appendChild(el);
    }
    S.hudEl = el;
  }

  const api = {
    get orbsCollected() { return S.orbsCollected; },
    orbsTotal: TOTAL_ORBS,
    get taxiActive() { return S.taxi.active; },
    get deliveryActive() { return S.delivery.active; },
    taxiMarkerPos,
    deliveryMarkerPos,
    startTaxi() { startTaxi(ctx); },
    startDelivery() { startDelivery(ctx); },
  };
  ctx.sidejobs = api;
  updateHud(ctx);
  return api;
}

function randomDest(ctx, exceptName) {
  const pool = DEST_NAMES.filter((n) => n !== exceptName);
  const name = pool[Math.floor(Math.random() * pool.length)];
  return { name, pos: openPointNear(ctx, lmPos(name)) };
}

function startTaxi(ctx) {
  if (!S || S.taxi.active) return false;
  const pickup = S.taxiMarkerPos.clone().add(new THREE.Vector3(2, 0, 2));
  S.taxi.active = true;
  S.taxi.phase = 'pickup';
  S.taxi.dest = null;
  if (ctx.scene) {
    S.passengerMesh = makePedestrian(0xe74c3c);
    S.passengerMesh.position.copy(pickup);
    ctx.scene.add(S.passengerMesh);
    S.destBeacon.position.copy(pickup);
    S.destBeacon.visible = true;
  }
  toast(ctx, 'Taxi job: pick up the passenger at the yellow marker (Plaza).');
  updateHud(ctx);
  return true;
}

function startDelivery(ctx) {
  if (!S || S.delivery.active) return false;
  const dest = randomDest(ctx, 'market');
  S.delivery.active = true;
  S.delivery.dest = dest.pos;
  S.delivery.destName = dest.name;
  S.delivery.timer = 60;
  S.delivery.elapsed = 0;
  if (ctx.scene) {
    S.destBeacon.position.copy(dest.pos);
    S.destBeacon.visible = true;
  }
  toast(ctx, 'Delivery job: take the package to ' + dest.name + ' (60s — under 25s earns a $' + DELIVERY_BONUS + ' bonus).');
  updateHud(ctx);
  return true;
}

function finishTaxi(ctx) {
  S.taxi.active = false;
  S.taxi.phase = 'idle';
  S.taxi.dest = null;
  if (S.destBeacon) S.destBeacon.visible = false;
  addCash(ctx, TAXI_FARE);
  toast(ctx, 'Fare complete! +$' + TAXI_FARE);
  if (ctx.particles && typeof ctx.particles.burst === 'function') {
    try { ctx.particles.burst(playerPos(ctx), 0xffc300); } catch (e) { /* optional */ }
  }
  updateHud(ctx);
}

function finishDelivery(ctx, fast) {
  S.delivery.active = false;
  S.delivery.dest = null;
  if (S.destBeacon) S.destBeacon.visible = false;
  const pay = fast ? DELIVERY_PAY + DELIVERY_BONUS : DELIVERY_PAY;
  addCash(ctx, pay);
  toast(ctx, fast ? 'Delivery complete — fast bonus! +$' + pay : 'Delivery complete! +$' + pay);
  if (ctx.particles && typeof ctx.particles.burst === 'function') {
    try { ctx.particles.burst(playerPos(ctx), 0x2ecc71); } catch (e) { /* optional */ }
  }
  updateHud(ctx);
}

function updateHud(ctx) {
  if (!S || !S.hudEl) return;
  const taxi = S.taxi.active
    ? (S.taxi.phase === 'pickup' ? 'Taxi: pick up passenger' : 'Taxi: drop off @ ' + S.taxi.destName)
    : 'Taxi: idle (F at Plaza)';
  const del = S.delivery.active
    ? 'Delivery: ' + S.delivery.destName + ' — ' + Math.ceil(S.delivery.timer) + 's'
    : 'Delivery: idle (F at Market)';
  S.hudEl.textContent = 'Orbs ' + S.orbsCollected + '/' + S.orbsTotal + '  ·  ' + taxi + '  ·  ' + del;
}

export function update(dt, ctx) {
  if (!S) return;
  S.time += dt;
  const p = playerPos(ctx);
  const fDown = keyDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;

  // --- orbs: bob, spin, collect ---
  for (const orb of S.orbs) {
    if (orb.userData.taken) continue;
    orb.rotation.y += dt * 1.5;
    orb.position.y = orb.userData.baseY + Math.sin(S.time * 2 + orb.position.x) * 0.25;
    if (p.distanceTo(orb.position) < 2.5) {
      orb.userData.taken = true;
      orb.visible = false;
      S.orbsCollected += 1;
      addCash(ctx, ORB_PAY);
      toast(ctx, 'Orb collected! +$' + ORB_PAY + ' (' + S.orbsCollected + '/' + S.orbsTotal + ')');
      if (ctx.particles && typeof ctx.particles.burst === 'function') {
        try { ctx.particles.burst(orb.position, 0x66e0ff); } catch (e) { /* optional */ }
      }
      updateHud(ctx);
    }
  }

  // --- beacons pulse ---
  for (const b of [S.taxiBeacon, S.deliveryBeacon, S.destBeacon]) {
    if (b && b.visible && b.userData.gem) {
      b.userData.gem.rotation.y += dt * 2;
      b.userData.gem.position.y = 3.2 + Math.sin(S.time * 3) * 0.3;
    }
  }

  // --- taxi job ---
  if (S.taxi.active) {
    if (S.taxi.phase === 'pickup' && S.passengerMesh) {
      if (p.distanceTo(S.passengerMesh.position) < 3) {
        S.taxi.phase = 'dropoff';
        const dest = randomDest(ctx, 'plaza');
        S.taxi.dest = dest.pos;
        S.taxi.destName = dest.name;
        if (S.passengerMesh) S.passengerMesh.visible = false; // passenger aboard
        if (S.destBeacon) { S.destBeacon.position.copy(dest.pos); S.destBeacon.visible = true; }
        toast(ctx, 'Passenger aboard — drive them to ' + dest.name + '.');
        updateHud(ctx);
      }
    } else if (S.taxi.phase === 'dropoff' && S.taxi.dest) {
      if (p.distanceTo(S.taxi.dest) < 7) {
        if (S.passengerMesh && ctx.scene) { ctx.scene.remove(S.passengerMesh); S.passengerMesh = null; }
        finishTaxi(ctx);
      }
    }
  }

  // --- delivery job ---
  if (S.delivery.active) {
    S.delivery.timer -= dt;
    S.delivery.elapsed += dt;
    if (S.delivery.timer <= 0) {
      S.delivery.active = false;
      S.delivery.dest = null;
      if (S.destBeacon) S.destBeacon.visible = false;
      toast(ctx, 'Delivery failed — out of time.');
      updateHud(ctx);
    } else if (S.delivery.dest && p.distanceTo(S.delivery.dest) < 7) {
      finishDelivery(ctx, S.delivery.elapsed < 25);
    } else if (Math.floor(S.time * 2) !== Math.floor((S.time - dt) * 2)) {
      updateHud(ctx); // refresh countdown ~2x/sec
    }
  }

  // --- F to start jobs (skip while another overlay is open) ---
  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;
  if (fPressed && !overlayOpen && !inPlane && !inside) {
    if (!S.taxi.active && p.distanceTo(S.taxiMarkerPos) < 4) {
      startTaxi(ctx);
    } else if (!S.delivery.active && p.distanceTo(S.deliveryMarkerPos) < 4) {
      startDelivery(ctx);
    }
  }

  // --- contextual prompt ---
  let prompt = '';
  if (!overlayOpen && !inPlane && !inside) {
    if (!S.taxi.active && p.distanceTo(S.taxiMarkerPos) < 4) prompt = 'Press F — Start taxi job ($' + TAXI_FARE + '/fare)';
    else if (!S.delivery.active && p.distanceTo(S.deliveryMarkerPos) < 4) prompt = 'Press F — Start delivery job ($' + DELIVERY_PAY + ' + $' + DELIVERY_BONUS + ' fast bonus)';
    else if (S.taxi.active && S.taxi.phase === 'pickup') prompt = 'Taxi: pick up the passenger at the pink marker';
    else if (S.taxi.active) prompt = 'Taxi: drive the passenger to ' + S.taxi.destName;
    else if (S.delivery.active) prompt = 'Delivery: reach ' + S.delivery.destName + ' — ' + Math.ceil(S.delivery.timer) + 's left';
  }
  setPrompt(prompt);
}
