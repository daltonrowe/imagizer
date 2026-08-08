/**
 * Helpers shared by the effect modules.
 *
 * Effects operate on a plain `{ data, width, height }` image — the same shape as
 * an ImageData, but not requiring the constructor, so the whole effect stack can
 * run under `node --test` without a DOM. They mutate `data` in place and return
 * the image, which also keeps the pipeline allocation-free between stages.
 */

/** Rec. 709 luminance, the perceptual weighting for greyscale and thresholds. */
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
