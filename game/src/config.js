// ISLA BRASA 3D — shared constants. Every system module reads these values so
// the world, missions, economy and vehicles all agree on one set of numbers.
// World coordinates: x east, z south, y up, ground at y = 0.

export const WORLD_SIZE = 400;
// Playable x/z range is [-200, 200]. Roads form a grid every 40 units.
export const ROAD_SPACING = 40;
export const ROAD_LINES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
export const ROAD_WIDTH = 8;

export const LANDMARKS = {
  plazaTower: [0, 0],
  feriaMarket: [0, -80],
  oldPier: [-160, 170],
  marinaDocks: [-120, 175],
  brasaGarage: [80, -40],
  rookArcade: [40, 80],
  coralCasino: [120, 120],
  coastTunnel: [-80, -160],
  motelVela: [-40, 40],
  underpass: [0, 150],
  oldChurch: [-120, -120],
  beachfront: [160, 170],
};

// Water strip along the south edge (beach, pier, marina).
export const WATER_Z_MIN = 165;
export const WATER_Z_MAX = 200;
// Runway strip along the north edge for the Brasa Air plane.
export const RUNWAY_Z = -195;
export const RUNWAY_X_MIN = -150;
export const RUNWAY_X_MAX = 150;

// Garage cars (buy prices, cheapest first). Names match state.carsOwned.
export const GARAGE_CARS = [
  { id: 'sedan', name: 'Brasa Sedan', price: 2800, topSpeed: 26, accel: 10, handling: 1.0 },
  { id: 'coupe', name: 'Vela Coupe', price: 5000, topSpeed: 32, accel: 13, handling: 1.1 },
  { id: 'sport', name: 'Coral Sport', price: 8000, topSpeed: 38, accel: 16, handling: 1.25 },
  { id: 'supercar', name: 'Isla GT', price: 12000, topSpeed: 46, accel: 20, handling: 1.4 },
];
export const GARAGE_CAR_PRICES = [2800, 5000, 8000, 12000];
// Selling a car returns 60% of its price plus 40% of what upgrades cost.
export const SELL_BACK_RATE = 0.6;
export const SELL_UPGRADE_RATE = 0.4;

// Crew for hire: driver, gunman, hacker. Each levels 0-3 in missions.
export const CREW = {
  rico: { id: 'rico', name: 'Rico Vega', role: 'driver', price: 1500 },
  marta: { id: 'marta', name: 'Marta Solis', role: 'gunman', price: 2000 },
  ghost: { id: 'ghost', name: 'Ghost', role: 'hacker', price: 2500 },
};

// Extra vehicles and heavy weapons (buy prices).
export const MOTORBIKE_PRICE = 1500;
export const BOAT_PRICE = 4500;
export const SNIPER_PRICE = 6000;
export const RPG_PRICE = 9000;

// Properties: buy once, income accrues every in-game day.
export const PROPERTIES = {
  safehouse: { id: 'safehouse', name: 'Vela Safehouse', price: 5000, income: 100 },
  shop: { id: 'shop', name: 'Feria Shop', price: 12000, income: 300 },
  nightclub: { id: 'nightclub', name: 'Coral Nightclub', price: 25000, income: 800 },
};

// Side jobs.
export const SIDE_JOBS = {
  taxi: 120, // dollars per taxi fare
  delivery: 100, // dollars per delivery
  deliveryFastBonus: 50, // bonus for a fast delivery
  orb: 50, // dollars per collectible orb
};
export const ORB_COUNT = 10;

// Weapons on the wheel (hold Q). Sniper and RPG are bought in the weapon shop.
export const WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rpg'];
export const WEAPON_STATS = {
  fists: { damage: 10, range: 2, rate: 2.0 },
  pistol: { damage: 20, range: 40, rate: 2.5 },
  smg: { damage: 12, range: 32, rate: 8.0 },
  shotgun: { damage: 45, range: 16, rate: 1.0 },
  rifle: { damage: 35, range: 70, rate: 4.0 },
  sniper: { damage: 90, range: 120, rate: 0.8 },
  rpg: { damage: 150, range: 80, rate: 0.5 },
};

// Street races: beat the clock through the checkpoints for a prize.
export const RACES = ['Malecon Sprint', 'Old Town Circuit', 'Beachfront Dash'];

// Respect ranks. 35,000 respect reaches Legend; each rank adds +5% mission payout.
export const RESPECT_RANKS = ['Nobody', 'Hustler', 'Dealer', 'Boss', 'Kingpin', 'Legend'];
export const RESPECT_TOTAL = 35000;
export const RESPECT_PAYOUT_BONUS_PER_RANK = 0.05;

// Day/night cycle length in seconds; rain makes car grip drop to this factor.
export const DAY_LENGTH_SECONDS = 360;
export const RAIN_GRIP = 0.75;

// Brasa Air plane: needs this speed to take off, cannot climb past this height.
export const PLANE_TAKEOFF_SPEED = 22;
export const PLANE_CEILING = 120;

// Police.
export const WANTED_MAX = 5;
export const ROADBLOCK_WANTED = 3; // roadblocks + CONDOR-1 helicopter at 3+ stars

// Save key shared by state.js.
export const SAVE_KEY = 'islaBrasaSave';

// One object with everything, for modules that prefer a single import.
export const CONFIG = {
  WORLD_SIZE,
  ROAD_SPACING,
  ROAD_LINES,
  ROAD_WIDTH,
  LANDMARKS,
  WATER_Z_MIN,
  WATER_Z_MAX,
  RUNWAY_Z,
  RUNWAY_X_MIN,
  RUNWAY_X_MAX,
  GARAGE_CARS,
  GARAGE_CAR_PRICES,
  SELL_BACK_RATE,
  SELL_UPGRADE_RATE,
  CREW,
  MOTORBIKE_PRICE,
  BOAT_PRICE,
  SNIPER_PRICE,
  RPG_PRICE,
  PROPERTIES,
  SIDE_JOBS,
  ORB_COUNT,
  WEAPONS,
  WEAPON_STATS,
  RACES,
  RESPECT_RANKS,
  RESPECT_TOTAL,
  RESPECT_PAYOUT_BONUS_PER_RANK,
  DAY_LENGTH_SECONDS,
  RAIN_GRIP,
  PLANE_TAKEOFF_SPEED,
  PLANE_CEILING,
  WANTED_MAX,
  ROADBLOCK_WANTED,
  SAVE_KEY,
};

export default CONFIG;
