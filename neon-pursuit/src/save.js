// Persistent progress (localStorage). Everything is defensive: private windows may throw.
const KEY = 'neon-pursuit-save-v1';

const DEFAULTS = () => ({
  money: 500,
  owned: ['sports'],
  selected: 'sports',
  upgrades: {},        // { carId: {engine:0,tires:0,armor:0,nitro:0} }
  colors: {},          // { carId: paintIndex }
  scores: { chase: { score: 0, time: 0, level: 0 }, free: { distance: 0 }, challenge: { score: 0 } },
  done: {},            // completed challenges
  stats: { runs: 0, distance: 0, takedowns: 0, escapes: 0, smashed: 0, playTime: 0 },
  settings: { quality: 'high', sfx: 0.8, music: 0.4, sens: 1.0, time: 'cycle', fov: 62 },
});

let data = DEFAULTS();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const d = DEFAULTS();
      data = { ...d, ...p, settings: { ...d.settings, ...(p.settings || {}) }, scores: { ...d.scores, ...(p.scores || {}) }, stats: { ...d.stats, ...(p.stats || {}) } };
    }
  } catch (e) { data = DEFAULTS(); }
  return data;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
}
export const getSave = () => data;
export function resetSave() { data = DEFAULTS(); save(); }
export const upgradesOf = (id) => (data.upgrades[id] ||= { engine: 0, tires: 0, armor: 0, nitro: 0 });
