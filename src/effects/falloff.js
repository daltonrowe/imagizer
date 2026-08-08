/**
 * Shared core for the two lighting effects.
 *
 * Both darken the image outside a clear region, and differ only in how distance
 * from the centre is measured — which is expressed here as a scale per axis:
 *
 *   Vignette  scales each axis by its own half-size, so the clear region is an
 *             ellipse that follows the frame. Every edge midpoint darkens
 *             equally whatever the aspect ratio.
 *   Spotlight scales both axes by the same half-size, so the clear region stays
 *             a true circle however wide or tall the crop is.
 */

/** Hermite ramp: 0 below `from`, 1 above `to`, eased in between. */
export function smoothstep(from, to, value) {
  if (value <= from) return 0;
  if (value >= to) return 1;
  const t = (value - from) / (to - from);
  return t * t * (3 - 2 * t);
}

/**
 * Multiply pixels toward black by how far they lie past `inner`, reaching full
 * `strength` at `inner + feather`. Alpha is untouched, so a vignette over a
 * cutout darkens the cutout rather than filling its surroundings.
 */
export function radialDarken(image, { strength, inner, feather, scaleX, scaleY }) {
  const { data, width, height } = image;
  if (strength <= 0) return image;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  // A hair of feather always, so `inner` alone still gives a clean hard edge
  // instead of a divide-by-zero.
  const outer = inner + Math.max(feather, 1e-4);

  for (let y = 0; y < height; y++) {
    const dy = (y - cy) * scaleY;
    const dySq = dy * dy;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) * scaleX;
      const t = smoothstep(inner, outer, Math.sqrt(dx * dx + dySq));
      if (t <= 0) continue;

      const factor = 1 - strength * t;
      const i = (y * width + x) * 4;
      data[i] *= factor;
      data[i + 1] *= factor;
      data[i + 2] *= factor;
    }
  }
  return image;
}

/** Half of the shorter side — the radius of the largest circle that fits. */
export const inscribedRadius = (width, height) => Math.max(Math.min(width, height) / 2, 0.5);

/** Half of each side, floored so a 1px image cannot divide by zero. */
export const halfExtent = (size) => Math.max((size - 1) / 2, 0.5);
