import { highlightWeight } from './glow.js';
import { luma } from './shared.js';

/**
 * Drawing light out in straight lines, shared by Anamorphic Streak and Star
 * Filter.
 *
 * Both take the highlights, smear them along one or more directions, and screen
 * the result back.
 *
 * The smear scatters rather than gathers: it walks the *lit* pixels and pushes
 * their light outward, instead of walking every pixel and pulling light in. The
 * two produce the same image — the weight depends only on the distance, so the
 * sum transposes — but the layer is mostly zeros, and a threshold that keeps a
 * few percent of the frame makes scattering an order of magnitude cheaper. On a
 * 1080² export that is the difference between a two-second star filter and a
 * tenth of a second.
 *
 * Taps are spread across the length rather than being one per pixel, so cost
 * does not grow with how long the streak is; at these falloffs the gaps between
 * them do not show.
 */

/** The highlight layer both effects start from, premultiplied by alpha. */
export function highlightLayer(image, threshold) {
  const { data } = image;
  const layer = new Float32Array(data.length);
  const cut = (threshold / 100) * 255;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha <= 0) continue;
    const weight = highlightWeight(luma(data[i], data[i + 1], data[i + 2]), cut);
    if (weight <= 0) continue;
    const scale = weight * alpha;
    layer[i] = data[i] * scale;
    layer[i + 1] = data[i + 1] * scale;
    layer[i + 2] = data[i + 2] * scale;
  }
  return layer;
}

/**
 * Add `layer` smeared along `angle` into `out`, both directions.
 *
 * `length` is in pixels; `taps` is how many samples span it. Weights fall off
 * linearly from the source, so the streak fades rather than ending.
 */
export function smear(layer, out, width, height, angle, length, taps) {
  if (length < 1) return out;
  const radians = (angle * Math.PI) / 180;
  const stepX = (Math.cos(radians) * length) / taps;
  const stepY = (Math.sin(radians) * length) / taps;

  const norm = 2 / taps;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = layer[i];
      const g = layer[i + 1];
      const b = layer[i + 2];
      // The layer is mostly dark; skipping it is where the saving is.
      if (r === 0 && g === 0 && b === 0) continue;

      for (let t = 1; t <= taps; t++) {
        const falloff = (1 - t / (taps + 1)) * norm;
        // Both ways along the line, so a highlight throws a spike from each end
        // rather than trailing off in one direction.
        for (let sign = -1; sign <= 1; sign += 2) {
          const tx = Math.round(x + stepX * t * sign);
          const ty = Math.round(y + stepY * t * sign);
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
          const o = (ty * width + tx) * 4;
          out[o] += r * falloff;
          out[o + 1] += g * falloff;
          out[o + 2] += b * falloff;
        }
      }
    }
  }
  return out;
}

/** Taps enough to keep a streak continuous without paying for every pixel. */
export const tapsFor = (length) => Math.max(4, Math.min(28, Math.round(length / 3)));
