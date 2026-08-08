import { clamp } from './shared.js';

/**
 * Shared core for the two light effects.
 *
 * Both pick the brightest parts of the image, spread them — Bloom by blurring
 * them, Bokeh by splatting them as discs — and put the result back as light
 * rather than as paint. "As light" means two things:
 *
 *   The layer is screened on, so it can only brighten, and stacking more glow
 *   approaches white instead of overshooting past it.
 *
 *   Alpha is left alone. Glow that spread past a cutout's edge would have to
 *   invent opacity there, quietly growing the silhouette; instead the subject's
 *   own shape clips its glow, which is what the vignette and the aberration do
 *   with the crop's alpha too.
 */

/**
 * How strongly a tone contributes to the glow: nothing at or below the
 * threshold, ramping to full at white. A hard in/out test would band the sky.
 */
export function highlightWeight(value, threshold) {
  if (value <= threshold) return 0;
  return (value - threshold) / Math.max(255 - threshold, 1);
}

/**
 * Screen an RGBA-strided light buffer onto the image. Only the colour channels
 * are read; alpha is neither read nor written, and fully transparent pixels are
 * skipped so no colour is left stranded behind an invisible cutout.
 */
export function screenLight(image, light, intensity) {
  const { data } = image;
  if (intensity <= 0) return image;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const glow = clamp(light[i + c] * intensity, 0, 255);
      if (glow <= 0) continue;
      data[i + c] = 255 - ((255 - data[i + c]) * (255 - glow)) / 255;
    }
  }
  return image;
}
