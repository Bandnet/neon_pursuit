// Static game data: vehicles, upgrades, police units, challenges.

export const PAINTS = [0xe8212b, 0x1e6bff, 0xf2c200, 0x19c37d, 0xf5f5f5, 0x1b1b1f, 0xff6a00, 0x9b3bff, 0xff2e88, 0x19e6ff];

/**
 * Handling model parameters (SI-ish units).
 *  power: peak accel m/s^2   vmax: top speed m/s   brake: braking accel   mu: tyre grip
 *  kf/kr: cornering stiffness per unit mass (front/rear)   a/b: CG->front/rear axle distance
 *  drive: 'rwd' | 'awd' | 'fwd'   steer: max steering angle (rad)   dur: durability multiplier
 */
export const VEHICLES = {
  sports: {
    name: 'Apex GT', price: 0, desc: 'Balanced and nimble. A great all-rounder.',
    body: 'sports', mass: 1300, a: 1.25, b: 1.35, mu: 1.35, kf: 62, kr: 70, power: 14, vmax: 52, brake: 24,
    drive: 'rwd', steer: 0.5, dur: 1.0, nitro: 1.0, drag: 0.0011, color: 0,
  },
  muscle: {
    name: 'Bruiser V8', price: 2500, desc: 'Brutal torque, loose rear end, tough as nails.',
    body: 'muscle', mass: 1750, a: 1.4, b: 1.5, mu: 1.2, kf: 56, kr: 56, power: 17, vmax: 55, brake: 21,
    drive: 'rwd', steer: 0.46, dur: 1.35, nitro: 1.0, drag: 0.0012, color: 6,
  },
  suv: {
    name: 'Titan SUV', price: 4000, desc: 'Heavy and stable. Shrugs off hits, slow to turn.',
    body: 'suv', mass: 2300, a: 1.5, b: 1.5, mu: 1.15, kf: 58, kr: 62, power: 8.8, vmax: 44, brake: 22,
    drive: 'awd', steer: 0.46, dur: 1.9, nitro: 0.9, drag: 0.0014, color: 5,
  },
  offroad: {
    name: 'Dune Rover', price: 5500, desc: 'AWD grip and bounce. Perfect for smashing through props.',
    body: 'offroad', mass: 1600, a: 1.35, b: 1.4, mu: 1.25, kf: 54, kr: 58, power: 9.5, vmax: 41, brake: 21,
    drive: 'awd', steer: 0.55, dur: 1.55, nitro: 1.2, drag: 0.0013, color: 2,
  },
  interceptor: {
    name: 'Interceptor Z', price: 9000, desc: 'Police-grade pursuit car. Fast, stable, strong.',
    body: 'interceptor', mass: 1650, a: 1.3, b: 1.4, mu: 1.4, kf: 66, kr: 72, power: 15.5, vmax: 57, brake: 26,
    drive: 'rwd', steer: 0.5, dur: 1.5, nitro: 1.1, drag: 0.001, color: 5,
  },
  super: {
    name: 'Vanta X1', price: 18000, desc: 'Hypercar. Enormous speed and grip. Fragile.',
    body: 'super', mass: 1200, a: 1.2, b: 1.4, mu: 1.6, kf: 74, kr: 82, power: 19, vmax: 68, brake: 30,
    drive: 'awd', steer: 0.46, dur: 0.8, nitro: 1.3, drag: 0.0009, color: 9,
  },

  sedan: {
    name: 'Commuter GT', price: 600, desc: 'Cheap and cheerful family saloon. Forgiving to drive.',
    body: 'sedan', mass: 1400, a: 1.35, b: 1.4, mu: 1.15, kf: 56, kr: 60, power: 10.5, vmax: 44, brake: 21,
    drive: 'fwd', steer: 0.5, dur: 1.0, nitro: 0.9, drag: 0.0013, color: 4,
  },
  hatch: {
    name: 'Pocket Rocket', price: 1200, desc: 'Light hot-hatch. Tiny, grippy and brilliant at weaving through traffic.',
    body: 'hatch', mass: 1050, a: 1.1, b: 1.15, mu: 1.35, kf: 66, kr: 66, power: 13, vmax: 46, brake: 25,
    drive: 'fwd', steer: 0.56, dur: 0.8, nitro: 1.0, drag: 0.0012, color: 8,
  },
  classic: {
    name: 'Retro Coupe', price: 2000, desc: 'Old-school V8 coupe. Loud, loose and made for smoky drifts.',
    body: 'classic', mass: 1500, a: 1.4, b: 1.5, mu: 1.15, kf: 54, kr: 52, power: 14.5, vmax: 50, brake: 20,
    drive: 'rwd', steer: 0.48, dur: 1.2, nitro: 1.0, drag: 0.0012, color: 2,
  },
  pickup: {
    name: 'Hauler 4x4', price: 3500, desc: 'Rugged pickup. Strong, stable and happy off the tarmac.',
    body: 'pickup', mass: 2100, a: 1.6, b: 1.6, mu: 1.15, kf: 54, kr: 58, power: 8.8, vmax: 43, brake: 21,
    drive: 'awd', steer: 0.46, dur: 1.7, nitro: 0.9, drag: 0.0014, color: 4, offroad: true,
  },
  rally: {
    name: 'Rally Fury', price: 4800, desc: 'AWD rally weapon. Grips almost anywhere, including grass.',
    body: 'rally', mass: 1250, a: 1.2, b: 1.3, mu: 1.5, kf: 70, kr: 74, power: 14.5, vmax: 47, brake: 25,
    drive: 'awd', steer: 0.56, dur: 1.2, nitro: 1.1, drag: 0.0012, color: 1, offroad: true,
  },
  monster: {
    name: 'Crusher MT', price: 14000, desc: 'Monster truck. Nearly indestructible, flattens everything in its path.',
    body: 'monster', mass: 3200, a: 1.8, b: 1.8, mu: 1.1, kf: 52, kr: 56, power: 8.2, vmax: 40, brake: 20,
    drive: 'awd', steer: 0.5, dur: 3.0, nitro: 0.8, drag: 0.0016, color: 6, offroad: true,
  },
  swat: {
    name: 'Riot Tank', price: 22000, desc: 'Armoured SWAT truck. Slow to turn, almost unstoppable.',
    body: 'swat', mass: 2800, a: 1.65, b: 1.65, mu: 1.2, kf: 58, kr: 62, power: 8.6, vmax: 45, brake: 23,
    drive: 'awd', steer: 0.45, dur: 3.4, nitro: 1.0, drag: 0.0014, color: 5,
  },
  hyper: {
    name: 'Zenith R', price: 32000, desc: 'Track-bred hypercar. Brutal speed and downforce, but fragile.',
    body: 'hyper', mass: 1150, a: 1.2, b: 1.4, mu: 1.7, kf: 78, kr: 86, power: 21, vmax: 74, brake: 32,
    drive: 'awd', steer: 0.45, dur: 0.7, nitro: 1.4, drag: 0.0008, color: 7,
  },

  // ---------------- extra cars: regular / drift / hyper / meme
  micro: {
    name: 'Bean Mini', price: 0, desc: 'Absurdly tiny city car. Slips through any gap, folds in any crash.',
    body: 'micro', mass: 800, a: 0.95, b: 0.95, mu: 1.2, kf: 60, kr: 60, power: 8.5, vmax: 36, brake: 20,
    drive: 'fwd', steer: 0.6, dur: 0.6, nitro: 0.8, drag: 0.0012, color: 3,
  },
  kei: {
    name: 'Kei Flatbed', price: 0, desc: 'Little farm truck. Slow, light and surprisingly sturdy.',
    body: 'kei', mass: 950, a: 1.2, b: 1.2, mu: 1.15, kf: 56, kr: 56, power: 8.2, vmax: 37, brake: 19,
    drive: 'rwd', steer: 0.55, dur: 1.1, nitro: 0.8, drag: 0.0013, color: 4,
  },
  wagon: {
    name: 'Family Wagon', price: 0, desc: 'Roomy estate with a roof rack. Calm, stable and quicker than it looks.',
    body: 'wagon', mass: 1550, a: 1.4, b: 1.5, mu: 1.2, kf: 58, kr: 62, power: 11.5, vmax: 47, brake: 22,
    drive: 'awd', steer: 0.5, dur: 1.2, nitro: 0.9, drag: 0.0013, color: 1,
  },
  taxi: {
    name: 'Downtown Cab', price: 0, desc: 'Checkered yellow cab. Tough, tireless and always in a hurry.',
    body: 'taxi', mass: 1500, a: 1.35, b: 1.45, mu: 1.15, kf: 56, kr: 60, power: 10.8, vmax: 45, brake: 21,
    drive: 'rwd', steer: 0.5, dur: 1.5, nitro: 0.9, drag: 0.0013, color: 2,
  },
  minivan: {
    name: 'Soccer Van', price: 0, desc: 'Tall family minivan. Wallows in corners but takes a beating.',
    body: 'minivan', mass: 1900, a: 1.5, b: 1.5, mu: 1.1, kf: 52, kr: 56, power: 9.5, vmax: 42, brake: 20,
    drive: 'fwd', steer: 0.48, dur: 1.5, nitro: 0.8, drag: 0.0015, color: 4,
  },
  compact: {
    name: 'Hachi Eight', price: 0, desc: 'Light, balanced rear-drive hatch. The classic cheap drift starter.',
    body: 'compact', mass: 1000, a: 1.15, b: 1.2, mu: 1.3, kf: 62, kr: 56, power: 12, vmax: 46, brake: 22,
    drive: 'rwd', steer: 0.58, dur: 0.85, nitro: 1.0, drag: 0.0012, color: 4,
  },
  coupe: {
    name: 'Slider 180', price: 0, desc: 'Turbo drift coupe. Predictable, loud and built to hang the tail out.',
    body: 'coupe', mass: 1250, a: 1.3, b: 1.35, mu: 1.35, kf: 64, kr: 60, power: 15, vmax: 51, brake: 24,
    drive: 'rwd', steer: 0.58, dur: 0.9, nitro: 1.1, drag: 0.0011, color: 8,
  },
  jdm: {
    name: 'Touge Spec R', price: 0, desc: 'Full-fat drift weapon. Huge power, wing, wide tyres: a mountain pass monster.',
    body: 'jdm', mass: 1350, a: 1.3, b: 1.4, mu: 1.5, kf: 70, kr: 66, power: 18, vmax: 56, brake: 27,
    drive: 'rwd', steer: 0.6, dur: 1.0, nitro: 1.2, drag: 0.001, color: 1,
  },
  wedge: {
    name: 'Aeon Wedge', price: 0, desc: 'Low-slung mid-engine wedge hypercar. Stunning grip, glass-jaw body.',
    body: 'wedge', mass: 1150, a: 1.2, b: 1.4, mu: 1.65, kf: 76, kr: 84, power: 20, vmax: 71, brake: 31,
    drive: 'awd', steer: 0.45, dur: 0.75, nitro: 1.35, drag: 0.0008, color: 2,
  },
  longtail: {
    name: 'Phantom LT', price: 0, desc: 'Long-tail track special. The fastest thing on four wheels. Barely road legal.',
    body: 'longtail', mass: 1100, a: 1.25, b: 1.5, mu: 1.75, kf: 80, kr: 88, power: 22, vmax: 77, brake: 33,
    drive: 'awd', steer: 0.44, dur: 0.65, nitro: 1.5, drag: 0.0007, color: 5,
  },
  cart: {
    name: 'Shopping Kart', price: 0, desc: 'A motorised shopping trolley. Why? Nobody knows. It is very funny.',
    body: 'cart', mass: 400, a: 0.8, b: 0.8, mu: 1.0, kf: 50, kr: 50, power: 6.5, vmax: 30, brake: 16,
    drive: 'fwd', steer: 0.65, dur: 0.4, nitro: 1.6, drag: 0.0013, color: 5,
  },
  icecream: {
    name: 'Mister Frosty', price: 0, desc: 'Ice cream van with a giant cone. Slow, sturdy and tragically cheerful.',
    body: 'icecream', mass: 2100, a: 1.6, b: 1.6, mu: 1.05, kf: 50, kr: 54, power: 8.4, vmax: 40, brake: 19,
    drive: 'rwd', steer: 0.46, dur: 1.9, nitro: 1.2, drag: 0.0016, color: 9,
  },
  bus: {
    name: 'City Bus', price: 0, desc: 'Eight metres of public transport. Unstoppable wall of metal, turns like a ship.',
    body: 'bus', mass: 6500, a: 2.4, b: 2.1, mu: 1.0, kf: 48, kr: 52, power: 6.8, vmax: 34, brake: 17,
    drive: 'rwd', steer: 0.4, dur: 4.0, nitro: 0.7, drag: 0.002, color: 2,
  },
  pizza: {
    name: 'Pizza Express', price: 0, desc: 'Delivery car with a pizza sign on the roof. Thirty minutes or it is free!',
    body: 'pizza', mass: 1100, a: 1.2, b: 1.25, mu: 1.3, kf: 62, kr: 62, power: 13.5, vmax: 48, brake: 23,
    drive: 'fwd', steer: 0.58, dur: 0.8, nitro: 1.3, drag: 0.0012, color: 0,
  },
};
const _oldOrder = ['sports', 'sedan', 'hatch', 'classic', 'muscle', 'pickup', 'suv', 'rally', 'offroad', 'interceptor', 'monster', 'super', 'swat', 'hyper'];

/** Rating 0-100 from the numbers that actually matter on the road. */
const handlingOf = (s) => Math.min(100, (s.mu / 1.6) * 50 + (s.steer / 0.55) * 30 + ((s.kf + s.kr) / 160) * 20);
export const rating = (s) => 100 * (0.30 * s.vmax / 74 + 0.24 * s.power / 21 + 0.22 * handlingOf(s) / 100 + 0.10 * s.brake / 32 + 0.14 * Math.min(s.dur, 3.4) / 3.4);

export const CATS = { regular: 'Regular', sport: 'Sport', drift: 'Drift', hyper: 'Hyper', heavy: 'Heavy', meme: 'Meme' };
const CAT = {
  regular: ['micro', 'kei', 'sedan', 'hatch', 'wagon', 'taxi', 'minivan', 'pickup', 'suv'],
  sport: ['sports', 'classic', 'muscle', 'rally', 'interceptor'],
  drift: ['compact', 'coupe', 'jdm'],
  hyper: ['super', 'wedge', 'hyper', 'longtail'],
  heavy: ['offroad', 'monster', 'swat'],
  meme: ['cart', 'pizza', 'icecream', 'bus'],
};
/** Novelty multiplier: meme cars cost a bit extra for being silly, nothing else is adjusted by hand. */
const NOVELTY = { cart: 1.0, pizza: 1.4, icecream: 1.4, bus: 1.2 };
export const VEHICLE_ORDER = [];
for (const [cat, ids] of Object.entries(CAT)) for (const id of ids) { VEHICLES[id].cat = cat; VEHICLE_ORDER.push(id); }
// Price follows rating on one exponential curve, so a car is never much dearer than a similarly rated one.
for (const [id, v] of Object.entries(VEHICLES)) {
  v.rating = Math.round(rating(v));
  v.price = id === 'sports' ? 0 : Math.max(100, Math.round(150 * Math.exp(0.1376 * (rating(v) - 50)) * (NOVELTY[id] || 1) / 50) * 50);
}


// Tuning ranges used for the stat bars in the garage.
export const STAT_MAX = { vmax: 72, power: 20, handling: 100, brake: 32, dur: 2.4 };

export const UPGRADES = {
  engine: { name: 'Engine', desc: '+4% power & top speed per level', base: 350 },
  tires: { name: 'Tires', desc: '+4% grip & braking per level', base: 300 },
  armor: { name: 'Armor', desc: '+15% durability per level', base: 400 },
  nitro: { name: 'Nitro', desc: '+20% tank & faster refill per level', base: 250 },
};
export const MAX_UPGRADE = 5;
export const upgradeCost = (id, lvl) => Math.round(UPGRADES[id].base * Math.pow(lvl + 1, 1.6) / 10) * 10;

/** Cars used by the police. `spd` / `aggr` are further scaled by wanted level. */
export const POLICE_TYPES = {
  patrol: { body: 'patrol', mass: 1500, a: 1.3, b: 1.4, mu: 1.25, kf: 58, kr: 62, power: 12.5, vmax: 46, brake: 22, drive: 'rwd', steer: 0.5, dur: 1.0, drag: 0.0012, nitro: 0 },
  interceptor: { body: 'interceptor', mass: 1650, a: 1.3, b: 1.4, mu: 1.4, kf: 66, kr: 72, power: 15, vmax: 54, brake: 25, drive: 'rwd', steer: 0.5, dur: 1.3, drag: 0.001, nitro: 0 },
  swat: { body: 'swat', mass: 2600, a: 1.6, b: 1.6, mu: 1.2, kf: 58, kr: 64, power: 12, vmax: 44, brake: 22, drive: 'awd', steer: 0.45, dur: 2.6, drag: 0.0014, nitro: 0 },
};

// Wanted-level tuning. heat thresholds -> stars.
export const WANTED = {
  thresholds: [5, 25, 45, 65, 85],       // heat needed for wanted level 1..5
  units: [0, 2, 3, 5, 6, 8],              // desired police cars per level
  speed: [0, 0.8, 0.88, 0.95, 1.0, 1.06], // police speed scale
  aggr: [0, 0.2, 0.4, 0.65, 0.85, 1.0],   // ramming / flank aggressiveness
};

export const CHALLENGES = [
  { id: 'c_escape1', name: 'Slip Away', type: 'escape', level: 1, start: 14, desc: 'Escape a 1-star wanted level.', reward: 400 },
  { id: 'c_escape2', name: 'Heat Dodger', type: 'escape', level: 2, start: 34, desc: 'Escape a 2-star wanted level.', reward: 900 },
  { id: 'c_escape3', name: 'Ghost in the City', type: 'escape', level: 3, start: 58, desc: 'Escape a 3-star wanted level.', reward: 1800 },
  { id: 'c_survive90', name: 'Endurance', type: 'survive', target: 90, start: 14, desc: 'Survive 90 seconds of police chase.', reward: 600 },
  { id: 'c_survive240', name: 'Marathon', type: 'survive', target: 240, start: 14, desc: 'Survive 4 minutes. Heat keeps rising.', reward: 2200 },
  { id: 'c_dist3', name: 'Road Trip', type: 'distance', target: 3000, start: 0, noPolice: true, desc: 'Drive 3 km in free roam.', reward: 450 },
  { id: 'c_dist6', name: 'Grand Tour', type: 'distance', target: 6000, start: 14, desc: 'Drive 6 km with police on your tail.', reward: 1500 },
  { id: 'c_drift', name: 'Sideways', type: 'drift', target: 1500, start: 0, noPolice: true, desc: 'Score 1,500 drift points in one run.', reward: 500 },
  { id: 'c_drift2', name: 'Drift King', type: 'drift', target: 6000, start: 0, noPolice: true, desc: 'Score 6,000 drift points in one run.', reward: 1600 },
  { id: 'c_clean2', name: 'Clean Getaway', type: 'clean', level: 2, start: 34, maxDmg: 6, desc: 'Escape 2 stars with less than 6% damage.', reward: 1500 },
  { id: 'c_takedown', name: 'Bad Cop Down', type: 'takedown', target: 5, start: 55, desc: 'Wreck 5 police cars.', reward: 1700 },
  { id: 'c_clean3', name: 'Untouchable', type: 'clean', level: 3, start: 58, maxDmg: 10, desc: 'Escape 3 stars with less than 10% damage.', reward: 3000 },
];

/** Touge Pass challenges (drift-focused). `spawn: 'park'` starts in the drift park. */
export const TOUGE_CHALLENGES = [
  { id: 't_first', map: 'touge', name: 'First Slides', type: 'drift', target: 1500, desc: 'Bank 1,500 drift points anywhere on the pass.', reward: 400 },
  { id: 't_clip', map: 'touge', name: 'Apex Hunter', type: 'clips', target: 6, desc: 'Drift through 6 orange apex markers.', reward: 700 },
  { id: 't_chain', map: 'touge', name: 'Link Master', type: 'chain', target: 2500, desc: 'Build a single drift chain worth 2,500 points without crashing.', reward: 900 },
  { id: 't_angle', map: 'touge', name: 'Sideways Sam', type: 'angle', angle: 0.7, hold: 2.5, desc: 'Hold a drift angle of 40° or more for 2.5 seconds in a row.', reward: 800 },
  { id: 't_fast', map: 'touge', name: 'Speed Demon', type: 'fast', speed: 27.8, hold: 3, desc: 'Keep drifting above 100 km/h for 3 seconds in a row.', reward: 1100 },
  { id: 't_donut', map: 'touge', spawn: 'park', name: 'Donut Master', type: 'zone', target: 3000, desc: 'Drift park: earn 3,000 points inside the painted donut zones.', reward: 900 },
  { id: 't_lap', map: 'touge', name: 'Mountain Lap', type: 'lap', maxTime: 420, desc: 'Complete a full lap of the pass in under 7 minutes.', reward: 1500 },
  { id: 't_style', map: 'touge', name: 'Style Points', type: 'lap', minPts: 6000, desc: 'Finish a lap with at least 6,000 banked drift points.', reward: 2500 },
  { id: 't_clean', map: 'touge', name: 'Clean Lines', type: 'lap', maxDmg: 6, desc: 'Finish a lap with less than 6% damage.', reward: 2000 },
  { id: 't_king', map: 'touge', name: 'King of the Pass', type: 'drift', target: 15000, desc: 'Bank 15,000 drift points in a single run.', reward: 3200 },
];
export const ALL_CHALLENGES = [...CHALLENGES, ...TOUGE_CHALLENGES];

export const MAPS = {
  city: { id: 'city', name: 'Neon City', tag: 'Open city', desc: 'A sprawling city with traffic, bridges and a relentless police force.' },
  touge: { id: 'touge', name: 'Touge Pass', tag: 'Drift mountain', desc: 'A mountain road of hairpins and sweepers with a drift park in the valley. No police, no traffic: just drifting.' },
};

export const COLORS_TRAFFIC = [0xb8bcc4, 0x2a2e38, 0xd8d8d8, 0x7a1f2a, 0x1f4d7a, 0x2f6b46, 0xc9a227, 0x8a8f99, 0xe0e0e0, 0x4a3a2a];
