// ISLA BRASA 3D — player state and save/load. The state object is the single
// source of truth for cash, respect, wanted level, health, inventory and progress;
// every system module reads and writes it through the ctx passed to init/update.

import { SAVE_KEY } from './config.js';

// Fresh-game defaults. A new player starts with $500, a pistol and a sedan.
export const DEFAULT_STATE = {
  cash: 500,
  respect: 0,
  wanted: 0,
  health: 100,
  armor: 0,
  weaponsOwned: ['fists', 'pistol'],
  currentWeapon: 'fists',
  carsOwned: ['sedan'],
  currentCar: null,
  crew: {},
  missionsCompleted: [],
  // Mission progress lives here: the missions module records finished mission
  // ids in state.completedMissions, and loadGame only restores keys listed in
  // DEFAULT_STATE — so this field must be declared here or progress is lost
  // on reload (found by the round-5 verification harness).
  completedMissions: [],
  currentMission: 0,
  day: 1,
  timeOfDay: 0.3,
  raining: false,
  outfitsOwned: ['default'],
  currentOutfit: 'default',
  propertiesOwned: [],
  orbsCollected: 0,
  playerPos: [0, 0, 10],
};

export const state = { ...DEFAULT_STATE };

// Deep-copy the array fields so DEFAULT_STATE is never mutated through state.
state.weaponsOwned = [...DEFAULT_STATE.weaponsOwned];
state.carsOwned = [...DEFAULT_STATE.carsOwned];
state.crew = { ...DEFAULT_STATE.crew };
state.missionsCompleted = [...DEFAULT_STATE.missionsCompleted];
state.completedMissions = [...DEFAULT_STATE.completedMissions];
state.outfitsOwned = [...DEFAULT_STATE.outfitsOwned];
state.propertiesOwned = [...DEFAULT_STATE.propertiesOwned];
state.playerPos = [...DEFAULT_STATE.playerPos];

// Write the current state to localStorage. Never throws: a failed save (private
// mode, full storage) must not crash the game loop.
export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Load a saved game into state. Returns true when a save was found and applied,
// false when there is no save or it is unreadable (the game keeps fresh defaults).
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;
    for (const key of Object.keys(DEFAULT_STATE)) {
      if (saved[key] !== undefined) state[key] = saved[key];
    }
    // Keep array/object fields as fresh copies so later edits stay local.
    if (Array.isArray(state.weaponsOwned)) state.weaponsOwned = [...state.weaponsOwned];
    if (Array.isArray(state.carsOwned)) state.carsOwned = [...state.carsOwned];
    if (Array.isArray(state.missionsCompleted)) state.missionsCompleted = [...state.missionsCompleted];
    if (Array.isArray(state.completedMissions)) state.completedMissions = [...state.completedMissions];
    if (Array.isArray(state.outfitsOwned)) state.outfitsOwned = [...state.outfitsOwned];
    if (Array.isArray(state.propertiesOwned)) state.propertiesOwned = [...state.propertiesOwned];
    if (Array.isArray(state.playerPos)) state.playerPos = [...state.playerPos];
    if (state.crew && typeof state.crew === 'object') state.crew = { ...state.crew };
    return true;
  } catch {
    return false;
  }
}

export default state;
