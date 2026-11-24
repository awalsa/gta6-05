// properties.js — Buyable properties for ISLA BRASA 3D (worker W7).
// Safehouse $5,000 (+$100/day), shop $12,000 (+$300/day),
// nightclub $25,000 (+$800/day). Income accrues daily: when state.day
// increments (day/night cycle), owned properties pay out.
// Buy by pressing F at the property landmark, or via ctx.properties.buy(id)
// (e.g. from the shop overlay).
// Three.js ES module. Exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.

import * as THREE from 'three';
import { LANDMARKS, PROPERTIES as CFG_PROPERTIES } from './config.js';

// Short names used in this file -> real LANDMARKS keys in config.js.
const LM = {
  motel: 'motelVela', market: 'feriaMarket', casino: 'coralCasino',
};

const FALLBACK = {
  motel: { x: -40, z: 40 },
  market: { x: 0, z: -80 },
  casino: { x: 120, z: 120 },
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
  console.log('[properties]', msg);
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

const PROPERTIES = [
  { id: 'safehouse', name: (CFG_PROPERTIES && CFG_PROPERTIES.safehouse && CFG_PROPERTIES.safehouse.name) || 'Safehouse', price: (CFG_PROPERTIES && CFG_PROPERTIES.safehouse && CFG_PROPERTIES.safehouse.price) || 5000, income: (CFG_PROPERTIES && CFG_PROPERTIES.safehouse && CFG_PROPERTIES.safehouse.income) || 100, landmark: 'motel', offset: [8, 0, 0], color: 0x2ecc71 },
  { id: 'shop', name: (CFG_PROPERTIES && CFG_PROPERTIES.shop && CFG_PROPERTIES.shop.name) || 'Corner Shop', price: (CFG_PROPERTIES && CFG_PROPERTIES.shop && CFG_PROPERTIES.shop.price) || 12000, income: (CFG_PROPERTIES && CFG_PROPERTIES.shop && CFG_PROPERTIES.shop.income) || 300, landmark: 'market', offset: [8, 0, 8], color: 0x3498db },
  { id: 'nightclub', name: (CFG_PROPERTIES && CFG_PROPERTIES.nightclub && CFG_PROPERTIES.nightclub.name) || 'Nightclub', price: (CFG_PROPERTIES && CFG_PROPERTIES.nightclub && CFG_PROPERTIES.nightclub.price) || 25000, income: (CFG_PROPERTIES && CFG_PROPERTIES.nightclub && CFG_PROPERTIES.nightclub.income) || 800, landmark: 'casino', offset: [-8, 0, 8], color: 0xe84393 },
];

let S = null;

export function init(ctx) {
  S = {
    ctx,
    owned: [],
    markers: [], // { def, pos, beacon }
    lastDay: (ctx.state && typeof ctx.state.day === 'number') ? ctx.state.day : 0,
    prevF: false,
    time: 0,
  };

  // Restore owned properties from a loaded save, if present.
  if (ctx.state && Array.isArray(ctx.state.propertiesOwned)) {
    S.owned = ctx.state.propertiesOwned.slice();
  }

  if (ctx.scene) {
    for (const def of PROPERTIES) {
      const base = lmPos(def.landmark);
      const pos = new THREE.Vector3(base.x + def.offset[0], 0, base.z + def.offset[2]);
      // "For sale" marker: beacon pillar + floating sign box.
      const beacon = new THREE.Group();
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 24, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      cyl.position.y = 12;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.6, 24),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.0, 0.15),
        new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.55 })
      );
      sign.position.y = 3.4;
      beacon.add(cyl, ring, sign);
      beacon.position.copy(pos);
      beacon.userData.sign = sign;
      ctx.scene.add(beacon);
      S.markers.push({ def, pos, beacon });
    }
  } else {
    for (const def of PROPERTIES) {
      const base = lmPos(def.landmark);
      S.markers.push({ def, pos: new THREE.Vector3(base.x + def.offset[0], 0, base.z + def.offset[2]), beacon: null });
    }
  }

  const api = {
    owned: S.owned,
    list: PROPERTIES,
    buy(id) { return buy(ctx, id); },
    dailyIncome() { return dailyIncome(); },
  };
  ctx.properties = api;
  return api;
}

function dailyIncome() {
  if (!S) return 0;
  let sum = 0;
  for (const id of S.owned) {
    const def = PROPERTIES.find((d) => d.id === id);
    if (def) sum += def.income;
  }
  return sum;
}

function buy(ctx, id) {
  if (!S) return false;
  const def = PROPERTIES.find((d) => d.id === id);
  if (!def) { toast(ctx, 'No such property: ' + id); return false; }
  if (S.owned.includes(id)) { toast(ctx, 'You already own the ' + def.name + '.'); return false; }
  const cash = getCash(ctx);
  if (cash < def.price) {
    toast(ctx, 'Not enough cash for the ' + def.name + ' ($' + def.price.toLocaleString() + ' — you have $' + cash.toLocaleString() + ').');
    return false;
  }
  addCash(ctx, -def.price);
  S.owned.push(id);
  if (ctx.state) {
    ctx.state.propertiesOwned = S.owned.slice();
    if (typeof ctx.state.saveGame === 'function') {
      try { ctx.state.saveGame(); } catch (e) { /* save is best-effort here */ }
    }
  }
  // Hide the for-sale marker once bought.
  const m = S.markers.find((x) => x.def.id === id);
  if (m && m.beacon) m.beacon.visible = false;
  toast(ctx, 'You bought the ' + def.name + ' for $' + def.price.toLocaleString() + '! It earns $' + def.income + '/day.');
  return true;
}

export function update(dt, ctx) {
  if (!S) return;
  S.time += dt;
  const p = playerPos(ctx);

  // --- daily income on day change ---
  const day = (ctx.state && typeof ctx.state.day === 'number') ? ctx.state.day : S.lastDay;
  if (day > S.lastDay) {
    const days = day - S.lastDay;
    S.lastDay = day;
    const income = dailyIncome() * days;
    if (income > 0) {
      addCash(ctx, income);
      toast(ctx, 'Property income: +$' + income.toLocaleString() + ' (' + days + ' day' + (days > 1 ? 's' : '') + ').');
    }
  } else if (day < S.lastDay) {
    S.lastDay = day; // day counter reset (e.g. loaded save) — don't pay
  }

  // --- marker sign bob ---
  for (const m of S.markers) {
    if (m.beacon && m.beacon.visible && m.beacon.userData.sign) {
      m.beacon.userData.sign.position.y = 3.4 + Math.sin(S.time * 2 + m.pos.x) * 0.15;
      m.beacon.userData.sign.rotation.y += dt * 0.8;
    }
  }

  // --- F to buy at a property marker ---
  const fDown = keyDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;
  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;

  let near = null;
  if (!overlayOpen && !inPlane && !inside) {
    for (const m of S.markers) {
      if (!S.owned.includes(m.def.id) && p.distanceTo(m.pos) < 5) { near = m; break; }
    }
  }
  if (fPressed && near) buy(ctx, near.def.id);

  if (near) {
    setPrompt('Press F — Buy ' + near.def.name + ' ($' + near.def.price.toLocaleString() + ', earns $' + near.def.income + '/day)');
  }
}
