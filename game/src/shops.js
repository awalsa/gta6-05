// shops.js — Clothes shop + weapon shop for ISLA BRASA 3D (worker W7).
// Clothes: 4 outfits (street, suit, beach, biker) — buying calls
// ctx.player.setOutfit(name) when available, else records state.outfit and
// recolours the player mesh by material name. Weapons: Sniper $6,000 and
// RPG $9,000 — buying adds to state.weaponsOwned (usable from the weapon
// wheel once bought). Open the shop overlay (DOM id overlay-shop, guarded)
// with G near the market, or F at the shop door.
// Three.js ES module. Exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.

import * as THREE from 'three';
import { LANDMARKS, SNIPER_PRICE as CFG_SNIPER, RPG_PRICE as CFG_RPG, MOTORBIKE_PRICE as CFG_BIKE, BOAT_PRICE as CFG_BOAT } from './config.js';

// Short names used in this file -> real LANDMARKS keys in config.js.
const LM = { market: 'feriaMarket' };

const FALLBACK = { market: { x: 0, z: -80 } };

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
  console.log('[shops]', msg);
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

const OUTFITS = [
  { name: 'street', label: 'Street', price: 0, colors: { shirt: 0x2e86c1, pants: 0x222222 } },
  { name: 'suit', label: 'Suit', price: 800, colors: { shirt: 0x1a1a1a, pants: 0x111111 } },
  { name: 'beach', label: 'Beach', price: 400, colors: { shirt: 0xff8c42, pants: 0xffe066 } },
  { name: 'biker', label: 'Biker', price: 1200, colors: { shirt: 0x8b0000, pants: 0x222222 } },
];

const WEAPONS = [
  { name: 'sniper', label: 'Sniper', price: typeof CFG_SNIPER === 'number' ? CFG_SNIPER : 6000, damage: 100, range: 120 },
  { name: 'rpg', label: 'RPG', price: typeof CFG_RPG === 'number' ? CFG_RPG : 9000, damage: 150, range: 80 },
];

// Vehicles (feature 9): motorbike and boat. Buying one spends the cash, adds
// the type to state.carsOwned (so it persists and spawns at boot), and spawns
// it right away — bike beside the player, boat at the Marina Docks.
const VEHICLES = [
  { name: 'motorbike', label: 'Motorbike', price: typeof CFG_BIKE === 'number' ? CFG_BIKE : 1500, desc: 'Fast, nimble — top speed 38' },
  { name: 'boat', label: 'Brasa Boat', price: typeof CFG_BOAT === 'number' ? CFG_BOAT : 4500, desc: 'Drives on the water by the pier/marina' },
];

let S = null;

export function init(ctx) {
  const shopPos = lmPos('market').add(new THREE.Vector3(8, 0, 0));
  S = {
    ctx,
    open: false,
    tab: 'clothes',
    shopPos,
    overlay: null,
    balanceEl: null,
    listEl: null,
    ownedOutfits: ['street'],
    ownedWeapons: [],
    prevG: false,
    prevF: false,
    prevEsc: false,
  };

  // Restore owned items from a loaded save, if present.
  if (ctx.state) {
    if (Array.isArray(ctx.state.outfitsOwned)) S.ownedOutfits = ctx.state.outfitsOwned.slice();
    if (Array.isArray(ctx.state.weaponsOwned)) S.ownedWeapons = ctx.state.weaponsOwned.slice();
    if (!ctx.state.weaponsOwned) ctx.state.weaponsOwned = S.ownedWeapons;
    if (!ctx.state.outfitsOwned) ctx.state.outfitsOwned = S.ownedOutfits;
  }

  if (ctx.scene) {
    // Shop sign: a small awning + glowing sign box at the market.
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xe84393 })
    );
    awning.position.set(shopPos.x, 3.1, shopPos.z);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 1.0, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xe84393, emissive: 0xe84393, emissiveIntensity: 0.6 })
    );
    sign.position.set(shopPos.x, 3.9, shopPos.z);
    const stall = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 1.1, 2),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
    );
    stall.position.set(shopPos.x, 0.55, shopPos.z);
    ctx.scene.add(awning, sign, stall);
  }

  if (typeof document !== 'undefined') buildOverlay(ctx);

  const api = {
    outfits: OUTFITS,
    weapons: WEAPONS,
    vehicles: VEHICLES,
    ownedOutfits: S.ownedOutfits,
    ownedWeapons: S.ownedWeapons,
    buyOutfit(name) { return buyOutfit(ctx, name); },
    buyWeapon(name) { return buyWeapon(ctx, name); },
    buyVehicle(name) { return buyVehicle(ctx, name); },
    open() { openShop(ctx); },
    close() { closeShop(ctx); },
    get isOpen() { return S.open; },
  };
  ctx.shops = api;
  return api;
}

function buildOverlay(ctx) {
  let ov = document.getElementById('overlay-shop');
  if (ov) {
    S.overlay = ov;
    S.balanceEl = ov.querySelector('#shop-balance');
    S.listEl = ov.querySelector('#shop-list');
    const closeBtn = ov.querySelector('#shop-close');
    if (closeBtn) closeBtn.onclick = () => closeShop(ctx);
    renderList(ctx);
    return;
  }

  ov = document.createElement('div');
  ov.id = 'overlay-shop';
  ov.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,10,20,0.8);z-index:10000;align-items:center;justify-content:center;font-family:sans-serif;';
  ov.innerHTML =
    '<div style="background:#14141f;border:2px solid #e84393;border-radius:12px;padding:20px 24px;width:min(520px,92vw);color:#f5f5f5;max-height:88vh;overflow:auto;">' +
    '<h2 style="margin:0 0 4px;color:#ff8fb3;">🛍️ Feria Market — Shops</h2>' +
    '<div style="margin-bottom:10px;">Your cash: <b id="shop-balance" style="color:#7CFC00;">$0</b></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button data-tab="clothes" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e84393;background:#3a1a2a;color:#ffe9f2;cursor:pointer;">👕 Clothes</button>' +
    '<button data-tab="weapons" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e84393;background:#3a1a2a;color:#ffe9f2;cursor:pointer;">🔫 Weapons</button>' +
    '</div>' +
    '<div id="shop-list"></div>' +
    '<button id="shop-close" style="width:100%;margin-top:12px;padding:10px;border-radius:6px;border:none;background:#e84393;color:#fff;font-weight:bold;cursor:pointer;">Close (Esc)</button>' +
    '</div>';
  document.body.appendChild(ov);
  S.overlay = ov;
  S.balanceEl = ov.querySelector('#shop-balance');
  S.listEl = ov.querySelector('#shop-list');
  ov.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => { S.tab = btn.getAttribute('data-tab'); renderList(ctx); };
  });
  ov.querySelector('#shop-close').onclick = () => closeShop(ctx);
  renderList(ctx);
}

function refreshBalance(ctx) {
  if (S.balanceEl) S.balanceEl.textContent = '$' + getCash(ctx).toLocaleString();
}

function renderList(ctx) {
  if (!S.listEl) return;
  refreshBalance(ctx);
  const cash = getCash(ctx);
  let html = '';
  if (S.tab === 'clothes') {
    for (const o of OUTFITS) {
      const owned = S.ownedOutfits.includes(o.name);
      const worn = ctx.state && ctx.state.outfit === o.name;
      const swatch = '#' + o.colors.shirt.toString(16).padStart(6, '0');
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #333;">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:' + swatch + ';border:2px solid #fff;display:inline-block;"></span>' +
        '<span style="flex:1;"><b>' + o.label + '</b>' + (worn ? ' <span style="color:#7CFC00;">(wearing)</span>' : '') + '<br><span style="font-size:12px;color:#aaa;">$' + o.price.toLocaleString() + '</span></span>' +
        '<button data-outfit="' + o.name + '" ' + (cash < o.price && !owned ? 'disabled' : '') + ' style="padding:6px 14px;border-radius:6px;border:none;background:' + (owned ? '#2ecc71' : '#e84393') + ';color:#fff;font-weight:bold;cursor:pointer;">' + (owned ? (worn ? 'Worn' : 'Wear') : 'Buy') + '</button>' +
        '</div>';
    }
  } else {
    for (const w of WEAPONS) {
      const owned = S.ownedWeapons.includes(w.name);
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #333;">' +
        '<span style="flex:1;"><b>' + w.label + '</b><br><span style="font-size:12px;color:#aaa;">Damage ' + w.damage + ' · Range ' + w.range + ' · $' + w.price.toLocaleString() + '</span></span>' +
        '<button data-weapon="' + w.name + '" ' + (owned || cash < w.price ? 'disabled' : '') + ' style="padding:6px 14px;border-radius:6px;border:none;background:' + (owned ? '#2ecc71' : '#e84393') + ';color:#fff;font-weight:bold;cursor:pointer;">' + (owned ? 'Owned' : 'Buy') + '</button>' +
        '</div>';
    }
    html += '<div style="font-size:12px;color:#aaa;margin-top:6px;">Bought weapons appear in the weapon wheel (hold Q).</div>';
  }
  S.listEl.innerHTML = html;
  S.listEl.querySelectorAll('[data-outfit]').forEach((btn) => {
    btn.onclick = () => { buyOutfit(ctx, btn.getAttribute('data-outfit')); renderList(ctx); };
  });
  S.listEl.querySelectorAll('[data-weapon]').forEach((btn) => {
    btn.onclick = () => { buyWeapon(ctx, btn.getAttribute('data-weapon')); renderList(ctx); };
  });
}

function wearOutfit(ctx, name) {
  const o = OUTFITS.find((x) => x.name === name);
  if (!o) return false;
  if (ctx.player && typeof ctx.player.setOutfit === 'function') {
    try { ctx.player.setOutfit(name); } catch (e) { /* fall through to mesh recolour */ }
  }
  if (ctx.state) ctx.state.outfit = name;
  // Fallback: recolour the player mesh by material name (shirt/pants).
  if (ctx.player && ctx.player.mesh) {
    ctx.player.mesh.traverse((child) => {
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const n = (m.name || '').toLowerCase();
        if (n.includes('shirt') && o.colors.shirt !== undefined) m.color.setHex(o.colors.shirt);
        if (n.includes('pants') && o.colors.pants !== undefined) m.color.setHex(o.colors.pants);
      }
    });
  }
  return true;
}

function buyOutfit(ctx, name) {
  if (!S) return false;
  const o = OUTFITS.find((x) => x.name === name);
  if (!o) { toast(ctx, 'No such outfit: ' + name); return false; }
  if (S.ownedOutfits.includes(name)) {
    wearOutfit(ctx, name);
    toast(ctx, 'Wearing the ' + o.label + ' outfit.');
    return true;
  }
  if (getCash(ctx) < o.price) {
    toast(ctx, 'Not enough cash for the ' + o.label + ' outfit ($' + o.price + ').');
    return false;
  }
  addCash(ctx, -o.price);
  S.ownedOutfits.push(name);
  if (ctx.state) ctx.state.outfitsOwned = S.ownedOutfits.slice();
  wearOutfit(ctx, name);
  toast(ctx, 'Bought the ' + o.label + ' outfit for $' + o.price + ' — now wearing it.');
  return true;
}

function buyWeapon(ctx, name) {
  if (!S) return false;
  const w = WEAPONS.find((x) => x.name === name);
  if (!w) { toast(ctx, 'No such weapon: ' + name); return false; }
  if (S.ownedWeapons.includes(name)) { toast(ctx, 'You already own the ' + w.label + '.'); return false; }
  if (getCash(ctx) < w.price) {
    toast(ctx, 'Not enough cash for the ' + w.label + ' ($' + w.price.toLocaleString() + ').');
    return false;
  }
  addCash(ctx, -w.price);
  S.ownedWeapons.push(name);
  if (ctx.state) {
    if (!Array.isArray(ctx.state.weaponsOwned)) ctx.state.weaponsOwned = [];
    if (!ctx.state.weaponsOwned.includes(name)) ctx.state.weaponsOwned.push(name);
  }
  toast(ctx, 'Bought the ' + w.label + ' for $' + w.price.toLocaleString() + '! Hold Q to open the weapon wheel.');
  return true;
}

function buyVehicle(ctx, name) {
  if (!S) return false;
  const v = VEHICLES.find((x) => x.name === name);
  if (!v) { toast(ctx, 'No such vehicle: ' + name); return false; }
  if (ctx.state && Array.isArray(ctx.state.carsOwned) && ctx.state.carsOwned.includes(name)) {
    toast(ctx, 'You already own the ' + v.label + '.');
    return false;
  }
  // Spend through the economy when it offers spend(), else state cash.
  let paid = false;
  if (ctx.economy && typeof ctx.economy.spend === 'function') paid = ctx.economy.spend(v.price);
  else if (ctx.state && (ctx.state.cash || 0) >= v.price) {
    ctx.state.cash -= v.price;
    paid = true;
  }
  if (!paid) {
    toast(ctx, 'Not enough cash for the ' + v.label + ' ($' + v.price.toLocaleString() + ').');
    return false;
  }
  if (ctx.state) {
    if (!Array.isArray(ctx.state.carsOwned)) ctx.state.carsOwned = [];
    if (!ctx.state.carsOwned.includes(name)) ctx.state.carsOwned.push(name);
  }
  // Spawn it now: bike beside the player, boat at the Marina Docks (on water).
  if (ctx.cars && typeof ctx.cars.spawnCar === 'function') {
    let spawned = null;
    if (name === 'boat') spawned = ctx.cars.spawnCar('boat', -120, 178, 0);
    else {
      const p = playerPos(ctx);
      spawned = ctx.cars.spawnCar('motorbike', p.x + 3, p.z + 3, 0);
    }
    if (spawned) spawned._owned = true;
  }
  if (typeof ctx.save === 'function') { try { ctx.save(); } catch (e) { /* best-effort */ } }
  else if (typeof ctx.saveGame === 'function') { try { ctx.saveGame(); } catch (e) { /* best-effort */ } }
  toast(ctx, 'Bought the ' + v.label + ' for $' + v.price.toLocaleString() + '! Press E near it to ride.');
  return true;
}

function openShop(ctx) {
  if (!S || S.open) return;
  if (!S.overlay) buildOverlay(ctx);
  if (!S.overlay) return;
  S.open = true;
  renderList(ctx);
  S.overlay.style.display = 'flex';
  if (ctx.state) ctx.state.uiOpen = true;
}

function closeShop(ctx) {
  if (!S || !S.open) return;
  S.open = false;
  if (S.overlay) S.overlay.style.display = 'none';
  if (ctx.state) ctx.state.uiOpen = false;
}

export function update(dt, ctx) {
  if (!S) return;
  const p = playerPos(ctx);

  const gDown = keyDown(ctx, 'KeyG');
  const gPressed = gDown && !S.prevG;
  S.prevG = gDown;
  const fDown = keyDown(ctx, 'KeyF');
  const fPressed = fDown && !S.prevF;
  S.prevF = fDown;
  const escDown = keyDown(ctx, 'Escape');
  const escPressed = escDown && !S.prevEsc;
  S.prevEsc = escDown;

  if (escPressed && S.open) { closeShop(ctx); return; }

  const overlayOpen = ctx.state && ctx.state.uiOpen;
  const inPlane = ctx.plane && ctx.plane.inPlane;
  const inside = ctx.interiors && ctx.interiors.inside;
  const nearShop = p.distanceTo(S.shopPos) < 10;

  if (!S.open && !overlayOpen && !inPlane && !inside) {
    // G near the market opens the shop. F at the shop door opens it too,
    // unless the player is standing on the delivery marker (sidejobs owns F there).
    const delPos = ctx.sidejobs && ctx.sidejobs.deliveryMarkerPos;
    const onDeliveryMarker = delPos ? p.distanceTo(delPos) < 4 : false;
    if (gPressed && nearShop) openShop(ctx);
    else if (fPressed && p.distanceTo(S.shopPos) < 4 && !onDeliveryMarker) openShop(ctx);
  }

  if (!S.open && !overlayOpen && !inPlane && !inside && nearShop) {
    setPrompt('Press G — Shops (clothes & weapons) · F at the stall also works');
  }
}
