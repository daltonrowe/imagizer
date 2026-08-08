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
 */
const VERSION = 2;

export const MIN_SIZE = 16;
export const MAX_SIZE = 8192;

const DEFAULTS = {
  cropW: 1080,
  cropH: 1080,
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
    return { ...DEFAULTS, seed: randomSeed(), version: VERSION };
  }

  // Settings saved before the default changed adopt the new one; a format
  // picked since then is the person's own choice and is left alone.
  const stale = Number(stored.version || 1) < VERSION;

  return {
    cropW: clampSize(stored.cropW, DEFAULTS.cropW),
    cropH: clampSize(stored.cropH, DEFAULTS.cropH),
    format: !stale && stored.format === 'image/jpeg' ? 'image/jpeg' : DEFAULTS.format,
    seed: normalizeSeed(stored.seed) || randomSeed(),
    version: VERSION,
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode, quota) — settings just won't persist */
  }
}

export { clampSize };
