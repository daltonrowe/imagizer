/**
 * Small localStorage wrapper. Safari in private mode throws on setItem, and
 * the app must keep working without persistence, so every access is guarded.
 */

import { normalizeSeed, randomSeed } from './random.js';

const KEY = 'imagizer.settings.v1';

export const MIN_SIZE = 16;
export const MAX_SIZE = 8192;

const DEFAULTS = {
  cropW: 1080,
  cropH: 1080,
  format: 'image/jpeg',
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
  if (!stored || typeof stored !== 'object') return { ...DEFAULTS, seed: randomSeed() };

  return {
    cropW: clampSize(stored.cropW, DEFAULTS.cropW),
    cropH: clampSize(stored.cropH, DEFAULTS.cropH),
    format: stored.format === 'image/png' ? 'image/png' : DEFAULTS.format,
    seed: normalizeSeed(stored.seed) || randomSeed(),
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
