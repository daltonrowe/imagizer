/**
 * The effect registry and the chain that runs them.
 *
 * A chain is plain data — `[{ id, params }, ...]` — which is what makes it
 * serialisable to JSON, storable, and shareable. The output of each effect is
 * the input of the next; they mutate the image in place, so a five-stage chain
 * costs no more memory than a one-stage one — unless an effect asks to look
 * back at an earlier stage, which is what `needsSource` and `historyDepth` are
 * for.
 *
 * Every effect draws from its own stream, `rng.fork('<id>#<position>')`. Keying
 * on position as well as id means two Pixel Sorts in one chain get different
 * randomness, while re-running the same chain reproduces both exactly.
 */

import { clamp, hslToRgb, rgbToHex } from './shared.js';
import blur from './blur.js';
import chromatic from './chromatic.js';
import huerotate from './huerotate.js';
import greyscale from './greyscale.js';
import colorize from './colorize.js';
import bloom from './bloom.js';
import bokeh from './bokeh.js';
import pixelsort from './pixelsort.js';
import channelsort from './channelsort.js';
import channelshift from './channelshift.js';
import slicer from './slicer.js';
import vignette from './vignette.js';
import spotlight from './spotlight.js';
import posterize from './posterize.js';
import threshold from './threshold.js';
import channelthreshold from './channelthreshold.js';
import gridgate from './gridgate.js';
import atkinson from './atkinson.js';
import bayer from './bayer.js';
import randomdither from './randomdither.js';
import reblend from './reblend.js';
import reblendprevious from './reblendprevious.js';

export const EFFECTS = [
  blur,
  chromatic,
  huerotate,
  greyscale,
  colorize,
  bloom,
  bokeh,
  pixelsort,
  channelsort,
  channelshift,
  slicer,
  vignette,
  spotlight,
  posterize,
  threshold,
  channelthreshold,
  gridgate,
  atkinson,
  bayer,
  randomdither,
  reblend,
  reblendprevious,
];

const BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]));

export const getEffect = (id) => BY_ID.get(id);

/** How many effects the randomiser puts in a chain. */
export const RANDOM_MIN = 2;
export const RANDOM_MAX = 5;

export const CHAIN_FORMAT = 'imagizer.chain';
/**
 * 2: Pixel Sort's `maxLength` (pixels) became `maxRun` (a percentage of the
 *    line). The rename is deliberate — a stored 200 read as a percentage would
 *    clamp to "no cap at all", so dropping the old key and falling back to the
 *    default degrades an old preset far more gracefully than reinterpreting it.
 *    Presets written at version 1 still load; they just lose that one setting.
 * 3: Grid Gate's `cellWidth` and `cellHeight` (a percentage per axis) became a
 *    single `cell` (a percentage of the shorter side). Two keys cannot merge
 *    into one without guessing which the user meant, and either guess changes
 *    the other axis, so an older preset falls back to the default cell size.
 */
export const CHAIN_VERSION = 3;

/** Fill in defaults and clamp anything out of range or unrecognised. */
export function normalizeParams(effect, params = {}) {
  const out = {};
  for (const spec of effect.params) {
    const value = params[spec.key];
    if (spec.type === 'toggle') {
      out[spec.key] = typeof value === 'boolean' ? value : spec.default;
    } else if (spec.type === 'color') {
      out[spec.key] = /^#[0-9a-f]{6}$/i.test(value) ? String(value).toLowerCase() : spec.default;
    } else if (spec.type === 'select') {
      const allowed = spec.options.some((option) => option.value === value);
      out[spec.key] = allowed ? value : spec.default;
    } else {
      const number = Number(value);
      out[spec.key] = Number.isFinite(number)
        ? clamp(quantise(number, spec), spec.min, spec.max)
        : spec.default;
    }
  }
  return out;
}

function quantise(value, spec) {
  if (!spec.step) return value;
  return Math.round((value - spec.min) / spec.step) * spec.step + spec.min;
}

/** Drop unknown effects and repair partial params — used for storage and imports. */
export function normalizeChain(raw) {
  if (!Array.isArray(raw)) return [];
  const chain = [];
  for (const item of raw) {
    const effect = getEffect(item?.id);
    if (!effect) continue;
    chain.push({
      id: effect.id,
      enabled: item.enabled !== false,
      params: normalizeParams(effect, item.params),
    });
  }
  return chain;
}

export function createItem(id, params) {
  const effect = getEffect(id);
  if (!effect) throw new Error(`Unknown effect: ${id}`);
  return { id, enabled: true, params: normalizeParams(effect, params) };
}

/**
 * Run the chain. `image` is mutated in place and returned.
 *
 * Effects that declare `needsSource` also receive the image as it entered the
 * chain, which is what lets one composite the original back over the processed
 * result. Effects that declare `historyDepth(params)` instead receive
 * `frameAt(steps)`, reaching back that many applied effects for an intermediate
 * image.
 *
 * Both are opt-in, and the history is trimmed to the deepest reach any effect
 * in the chain actually declares: a snapshot is the size of the whole crop, so
 * a chain that cannot use one should not pay for it, and a long chain should
 * not hold every stage it has ever produced.
 */
export function chainNeedsSource(chain) {
  return chain.some((item) => item.enabled !== false && getEffect(item.id)?.needsSource === true);
}

/** How many applied effects back the chain can reach; 0 when nothing reaches. */
export function chainHistoryDepth(chain) {
  let depth = 0;
  for (const item of chain) {
    if (item.enabled === false) continue;
    const effect = getEffect(item.id);
    if (typeof effect?.historyDepth !== 'function') continue;
    const want = effect.historyDepth(normalizeParams(effect, item.params));
    if (Number.isFinite(want)) depth = Math.max(depth, want);
  }
  return depth;
}

const snapshot = (image) => ({
  data: Uint8ClampedArray.from(image.data),
  width: image.width,
  height: image.height,
});

export function runChain(image, chain, rng) {
  const depth = chainHistoryDepth(chain);
  // `frames[k]` is the image as it stood before the k-th applied effect ran, so
  // `frames[0]` is the chain input — the same thing `needsSource` asks for.
  const frames = depth > 0 || chainNeedsSource(chain) ? [snapshot(image)] : null;
  const source = frames ? frames[0] : null;

  let applied = 0;
  // The oldest frame still held above the chain input.
  let oldest = 1;

  chain.forEach((item, index) => {
    if (item.enabled === false) return;
    const effect = getEffect(item.id);
    if (!effect) return;

    if (depth > 0 && applied > 0) {
      frames[applied] = snapshot(image);
      // Release anything past the deepest reach. Frame 0 always stays: it is
      // where a step count that runs off the front of the chain lands.
      while (oldest < applied - depth) frames[oldest++] = null;
    }

    const at = applied;
    effect.apply(image, {
      params: normalizeParams(effect, item.params),
      rng: rng.fork(`${item.id}#${index}`),
      source,
      // Never the current image: 1 step back is the image before the previous
      // effect ran, and anything deeper than the chain clamps to its input.
      frameAt: frames
        ? (steps) => frames[Math.max(0, at - Math.max(1, Math.round(steps)))] ?? frames[0]
        : null,
    });
    applied += 1;
  });
  return image;
}

/**
 * A chain of 2–5 distinct effects with randomised settings.
 *
 * Settings are drawn from each param's `random` hint rather than its full
 * range: a slider can go to a radius of 40, but a random chain that reaches for
 * it just returns mush. Effects are ordered by their declared `stage` so the
 * result reads as a deliberate stack — blur before sorting, threshold and
 * dither last — instead of an arbitrary shuffle.
 */
export function randomChain(rng, { min = RANDOM_MIN, max = RANDOM_MAX } = {}) {
  const count = clamp(rng.int(min, max), 1, EFFECTS.length);
  const chosen = rng.shuffle(EFFECTS).slice(0, count);
  chosen.sort((a, b) => a.stage - b.stage);

  return chosen.map((effect) => ({
    id: effect.id,
    enabled: true,
    params: randomParams(effect, rng),
  }));
}

function randomParams(effect, rng) {
  const params = {};
  for (const spec of effect.params) {
    if (spec.type === 'toggle') {
      params[spec.key] = rng.bool(0.3);
    } else if (spec.type === 'color') {
      // Drawn in HSL so random colours are vivid and mid-toned rather than the
      // muddy greys that uniform RGB mostly produces.
      params[spec.key] = rgbToHex(...hslToRgb(rng.int(0, 359), rng.int(45, 90) / 100, rng.int(38, 68) / 100));
    } else if (spec.type === 'select') {
      params[spec.key] = rng.pick(spec.options).value;
    } else {
      const [low, high] = spec.random ?? [spec.min, spec.max];
      params[spec.key] = clamp(quantise(rng.int(low, high), spec), spec.min, spec.max);
    }
  }
  return params;
}

// ---------- JSON ----------

/** Serialise a look — chain, seed and crop — as a shareable preset. */
export function chainToJSON({ chain, seed, crop }) {
  return JSON.stringify(
    {
      format: CHAIN_FORMAT,
      version: CHAIN_VERSION,
      seed,
      crop: crop ? { width: crop.w, height: crop.h } : undefined,
      effects: normalizeChain(chain).map((item) => ({
        id: item.id,
        ...(item.enabled ? {} : { enabled: false }),
        params: item.params,
      })),
    },
    null,
    2,
  );
}

/**
 * Parse a preset. Throws with a readable message on anything unusable, and
 * reports effects it had to drop rather than silently shortening the chain.
 */
export function chainFromJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like valid JSON.");
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object.');
  if (parsed.format && parsed.format !== CHAIN_FORMAT) {
    throw new Error('That JSON is not an Imagizer chain.');
  }
  if (!Array.isArray(parsed.effects)) throw new Error('No "effects" array in that JSON.');

  const chain = normalizeChain(parsed.effects);
  const dropped = parsed.effects.length - chain.length;

  const crop = parsed.crop && Number(parsed.crop.width) && Number(parsed.crop.height)
    ? { w: Number(parsed.crop.width), h: Number(parsed.crop.height) }
    : null;

  return {
    chain,
    seed: typeof parsed.seed === 'string' ? parsed.seed : null,
    crop,
    dropped,
  };
}
