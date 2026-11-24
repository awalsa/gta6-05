// economy.js — ISLA BRASA 3D: cash, respect ranks, crew, garage.
// Worker W5 (HUD + economy + dialogue). Built from the design specs only.
// Shared contract: exports init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }.
// Cash / respect live in ctx.state so save/load (another module) sees them.
import * as CFG from './config.js';

export const RESPECT_RANKS = ['Nobody', 'Hustler', 'Dealer', 'Boss', 'Kingpin', 'Legend'];
// Rank thresholds; Legend is reached at 35,000 total respect (design spec).
export const RESPECT_THRESHOLDS = [0, 1000, 5000, 12000, 22000, 35000];
export const TOTAL_RESPECT = 35000;

export const CREW = {
  rico: {
    id: 'rico', name: 'Rico Vega', role: 'Driver', cost: 1500,
    desc: 'Driver — faster getaway car in missions.',
  },
  marta: {
    id: 'marta', name: 'Marta Solis', role: 'Gunman', cost: 2000,
    desc: 'Gunman — fights beside you in missions.',
  },
  ghost: {
    id: 'ghost', name: 'Ghost', role: 'Hacker', cost: 2500,
    desc: 'Hacker — +15s per level on timed missions.',
  },
};
export const CREW_MAX_LEVEL = 3;

// Garage: 4 cars, $2,800–$12,000 (design spec). Names are fresh for this build.
export const CARS = {
  runner: { type: 'runner', name: 'Brasa Runner', price: 2800, speed: 22, handling: 0.7, desc: 'Cheap, cheerful, everywhere.' },
  cruiser: { type: 'cruiser', name: 'Vela Cruiser', price: 5000, speed: 27, handling: 0.8, desc: 'Solid all-rounder.' },
  gt: { type: 'gt', name: 'Coral GT', price: 8000, speed: 33, handling: 0.9, desc: 'Fast sports coupe.' },
  phantom: { type: 'phantom', name: 'Isla Phantom', price: 12000, speed: 40, handling: 1.0, desc: 'Top-tier supercar.' },
};
export const UPGRADE_PARTS = ['engine', 'armor', 'handling'];
export const UPGRADE_MAX_TIER = 3;
// Upgrade tier cost = base price * factor for that tier (increasing cost).
const UPGRADE_FACTORS = [0.25, 0.45, 0.7];

function stateOf(ctx) {
  if (!ctx) return {};
  if (!ctx.state) ctx.state = {};
  return ctx.state;
}

function ensureEconomyState(ctx) {
  const s = stateOf(ctx);
  if (typeof s.cash !== 'number' || Number.isNaN(s.cash)) {
    s.cash = typeof CFG.STARTING_CASH === 'number' ? CFG.STARTING_CASH : 500;
  }
  if (typeof s.respect !== 'number' || Number.isNaN(s.respect)) s.respect = 0;
  if (!s.crew || typeof s.crew !== 'object') s.crew = {};
  // crew: { [id]: { hired: true, level: 0..3 } }
  if (!s.garage || typeof s.garage !== 'object') s.garage = {};
  // garage: { owned: { [type]: { upgrades: {engine,armor,handling}, spent } }, current: type|null }
  if (!s.garage.owned || typeof s.garage.owned !== 'object') s.garage.owned = {};
  if (!('current' in s.garage)) s.garage.current = null;
  if (!Array.isArray(s.ownedWeapons)) s.ownedWeapons = ['fists', 'pistol'];
  return s;
}

function persist(ctx) {
  try {
    if (ctx && typeof ctx.save === 'function') ctx.save();
    else if (ctx && typeof ctx.saveGame === 'function') ctx.saveGame();
  } catch (e) { /* save is best-effort; never break gameplay */ }
}

function rankIndexFor(respect) {
  let r = 0;
  for (let i = 0; i < RESPECT_THRESHOLDS.length; i++) {
    if (respect >= RESPECT_THRESHOLDS[i]) r = i;
  }
  return r;
}

export function upgradeCost(type, part, tier) {
  const car = CARS[type];
  if (!car || !UPGRADE_PARTS.includes(part)) return 0;
  if (tier < 1 || tier > UPGRADE_MAX_TIER) return 0;
  return Math.round(car.price * UPGRADE_FACTORS[tier - 1]);
}

export function init(ctx) {
  const s = ensureEconomyState(ctx);

  const api = {
    // Live cash / respect (getters proxy ctx.state so they never go stale).
    get cash() { return ensureEconomyState(ctx).cash; },
    set cash(v) { ensureEconomyState(ctx).cash = Math.max(0, Math.floor(Number(v) || 0)); },
    get respect() { return ensureEconomyState(ctx).respect; },
    set respect(v) { ensureEconomyState(ctx).respect = Math.max(0, Math.floor(Number(v) || 0)); },

    addCash(n) {
      const st = ensureEconomyState(ctx);
      st.cash = Math.max(0, st.cash + Math.floor(Number(n) || 0));
      persist(ctx);
      return st.cash;
    },

    spend(n) {
      const st = ensureEconomyState(ctx);
      const amount = Math.floor(Number(n) || 0);
      if (amount <= 0) return true;
      if (st.cash < amount) return false;
      st.cash -= amount;
      persist(ctx);
      return true;
    },

    addRespect(n) {
      const st = ensureEconomyState(ctx);
      const before = rankIndexFor(st.respect);
      st.respect = Math.min(TOTAL_RESPECT, Math.max(0, st.respect + Math.floor(Number(n) || 0)));
      const after = rankIndexFor(st.respect);
      persist(ctx);
      if (after > before && ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
        ctx.hud.showMessage(`Respect up! You are now ${RESPECT_RANKS[after]}. Payouts +${after * 5}%.`);
      }
      return st.respect;
    },

    rank() { return rankIndexFor(ensureEconomyState(ctx).respect); },
    rankName() { return RESPECT_RANKS[rankIndexFor(ensureEconomyState(ctx).respect)]; },
    // +5% payout per rank: Nobody x1.00 … Legend x1.25.
    payoutMultiplier() { return 1 + rankIndexFor(ensureEconomyState(ctx).respect) * 0.05; },

    // --- Crew -------------------------------------------------------------
    hireCrew(id) {
      const def = CREW[id];
      if (!def) return false;
      const st = ensureEconomyState(ctx);
      if (st.crew[id] && st.crew[id].hired) return false; // already hired; use levelCrew
      if (!api.spend(def.cost)) return false;
      st.crew[id] = { hired: true, level: 0 };
      persist(ctx);
      if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
        ctx.hud.showMessage(`${def.name} joined your crew! (level 0 — pay again to level up)`);
      }
      return true;
    },

    levelCrew(id) {
      const def = CREW[id];
      if (!def) return false;
      const st = ensureEconomyState(ctx);
      const member = st.crew[id];
      if (!member || !member.hired) return false;
      if (member.level >= CREW_MAX_LEVEL) return false;
      if (!api.spend(def.cost)) return false;
      member.level += 1;
      persist(ctx);
      if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
        ctx.hud.showMessage(`${def.name} reached level ${member.level}!`);
      }
      return true;
    },

    crewLevel(id) {
      const st = ensureEconomyState(ctx);
      const member = st.crew[id];
      return member && member.hired ? member.level : -1; // -1 = not hired
    },
    isCrewHired(id) {
      const st = ensureEconomyState(ctx);
      return !!(st.crew[id] && st.crew[id].hired);
    },
    // Ghost: +15s per level on timed missions.
    hackerBonusSeconds() {
      const st = ensureEconomyState(ctx);
      const g = st.crew.ghost;
      return g && g.hired ? g.level * 15 : 0;
    },
    // Rico: getaway car speed bonus, +4% per level.
    getawaySpeedMultiplier() {
      const st = ensureEconomyState(ctx);
      const r = st.crew.rico;
      return r && r.hired ? 1 + r.level * 0.04 : 1;
    },
    // Marta: fights beside you (gunman present if hired).
    hasGunman() {
      const st = ensureEconomyState(ctx);
      return !!(st.crew.marta && st.crew.marta.hired);
    },

    // --- Garage -----------------------------------------------------------
    buyCar(type) {
      const car = CARS[type];
      if (!car) return false;
      const st = ensureEconomyState(ctx);
      if (st.garage.owned[type]) return false;
      if (!api.spend(car.price)) return false;
      st.garage.owned[type] = {
        upgrades: { engine: 0, armor: 0, handling: 0 },
        spent: 0,
      };
      if (!st.garage.current) st.garage.current = type;
      persist(ctx);
      if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
        ctx.hud.showMessage(`You bought the ${car.name} for $${car.price.toLocaleString('en-US')}.`);
      }
      return true;
    },

    upgradeCar(type, part) {
      const car = CARS[type];
      if (!car || !UPGRADE_PARTS.includes(part)) return false;
      const st = ensureEconomyState(ctx);
      const owned = st.garage.owned[type];
      if (!owned) return false;
      const tier = owned.upgrades[part] + 1;
      if (tier > UPGRADE_MAX_TIER) return false;
      const cost = upgradeCost(type, part, tier);
      if (!api.spend(cost)) return false;
      owned.upgrades[part] = tier;
      owned.spent += cost;
      persist(ctx);
      return true;
    },

    // Sell for 60% of base price + 40% of upgrades spent (design spec).
    sellCar(type) {
      const car = CARS[type];
      if (!car) return 0;
      const st = ensureEconomyState(ctx);
      const owned = st.garage.owned[type];
      if (!owned) return 0;
      const value = Math.round(car.price * 0.6 + owned.spent * 0.4);
      delete st.garage.owned[type];
      if (st.garage.current === type) {
        const remaining = Object.keys(st.garage.owned);
        st.garage.current = remaining.length ? remaining[0] : null;
      }
      api.addCash(value);
      if (ctx && ctx.hud && typeof ctx.hud.showMessage === 'function') {
        ctx.hud.showMessage(`Sold the ${car.name} for $${value.toLocaleString('en-US')}.`);
      }
      return value;
    },

    carStats(type) {
      const car = CARS[type];
      if (!car) return null;
      const st = ensureEconomyState(ctx);
      const owned = st.garage.owned[type];
      const up = owned ? owned.upgrades : { engine: 0, armor: 0, handling: 0 };
      return {
        ...car,
        owned: !!owned,
        upgrades: { ...up },
        spent: owned ? owned.spent : 0,
        // Each engine tier +8% top speed; handling tier +0.05 grip; armor tier +25 HP.
        speed: car.speed * (1 + up.engine * 0.08),
        handling: Math.min(1.2, car.handling + up.handling * 0.05),
        armor: up.armor * 25,
      };
    },
  };

  if (ctx) ctx.economy = api;
  return api;
}

export function update(dt, ctx) {
  // Economy has no per-frame work: cash/respect change only via the API.
  // Keep state valid in case another module replaced ctx.state.
  if (ctx) ensureEconomyState(ctx);
}

export default { init, update, RESPECT_RANKS, RESPECT_THRESHOLDS, TOTAL_RESPECT, CREW, CARS };
