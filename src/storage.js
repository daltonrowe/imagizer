/**
 * Small localStorage wrapper. Safari in private mode throws on setItem, and
 * the app must keep working without persistence, so every access is guarded.
 */

import { normalizeSeed, randomSeed } from './random.js';

const KEY = 'imagizer.settings.v1';

/**
 * Bumped when a default changes in a way that should reach people who already
 * have settings stored. Only the affected field is dropped — crop size and seed
 * survive, so a migration never costs someone their setup.
 *
 * 2: PNG became the default export format.
 * 3: `cropW`/`cropH` became a `crops` list, so several sizes can be framed,
 *    previewed and exported together. A stored single crop becomes the first
 *    entry rather than being dropped — there is nothing to guess.
 *
 * Only the sizes are stored. A framing is a point in one particular photo, and
 * the photo itself is never persisted, so a centre restored onto a different
 * image would land somewhere arbitrary. Sizes are worth remembering between
 * visits; where you had the crop sitting on last week's photo is not.
 */
const VERSION = 3;

/** More than this and the preview grid stops being readable on a phone. */
export const MAX_CROPS = 6;

export const MIN_SIZE = 16;
export const MAX_SIZE = 8192;

const DEFAULTS = {
  crops: [{ w: 1080, h: 1080 }],
  format: 'image/png',
};

function clampSize(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

export function loadSettings() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    stored = null;
  }
  // A first-time visitor gets their own seed rather than everyone's shared one.
  if (!stored || typeof stored !== 'object') {
    return {
      crops: DEFAULTS.crops.map((crop) => ({ ...crop })),
      active: 0,
      format: DEFAULTS.format,
      seed: randomSeed(),
      chain: [],
      version: VERSION,
    };
  }

  // Settings saved before the default changed adopt the new one; a format
  // picked since then is the person's own choice and is left alone.
  const stale = Number(stored.version || 1) < VERSION;

  const crops = normalizeCrops(stored);
  return {
    crops,
    active: Math.min(Math.max(Math.round(Number(stored.active) || 0), 0), crops.length - 1),
    format: !stale && stored.format === 'image/jpeg' ? 'image/jpeg' : DEFAULTS.format,
    seed: normalizeSeed(stored.seed) || randomSeed(),
    // Validated by the effect registry on load, which is the only thing that
    // knows which effects and params currently exist.
    chain: Array.isArray(stored.chain) ? stored.chain : [],
    version: VERSION,
  };
}

export function saveSettings(settings) {
  try {
    // Framing is stripped rather than written: it lives in memory for as long
    // as the photo it was made against is loaded, and no longer.
    const crops = (settings.crops ?? []).map(({ w, h }) => ({ w, h }));
    localStorage.setItem(KEY, JSON.stringify({ ...settings, crops }));
  } catch {
    /* storage unavailable (private mode, quota) — settings just won't persist */
  }
}

/** Read the crop list, accepting a version 2 single crop as a list of one. */
function normalizeCrops(stored) {
  const raw = Array.isArray(stored.crops) && stored.crops.length
    ? stored.crops
    : [{ w: stored.cropW, h: stored.cropH }];

  const crops = [];
  for (const item of raw.slice(0, MAX_CROPS)) {
    const w = clampSize(item?.w, DEFAULTS.crops[0].w);
    const h = clampSize(item?.h, DEFAULTS.crops[0].h);
    crops.push({ w, h });
  }
  return crops.length ? crops : DEFAULTS.crops.map((crop) => ({ ...crop }));
}

export { clampSize };
