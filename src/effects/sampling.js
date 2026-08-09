import { clamp } from './shared.js';

/**
 * Bilinear sampling, shared by the effects that move pixels to fractional
 * positions — Chromatic Aberration and Lens Distortion.
 *
 * Both samplers work on premultiplied colour and divide the alpha back out, so
 * a sample that straddles the edge of a cutout picks up the colour that is
 * actually there rather than mixing in the transparent black beyond it. Without
 * that, every geometric effect leaves a dark rim around a cutout.
 *
 * Coordinates outside the image clamp to the edge. Callers that need to know
 * they went outside — the lens does, to decide what to put there — should test
 * before sampling.
 */

/** The four texel offsets and weights around (x, y), clamped to the image. */
function corners(width, height, x, y) {
  const fx = clamp(x, 0, width - 1);
  const fy = clamp(y, 0, height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;

  return {
    o00: (row0 + x0) * 4, o10: (row0 + x1) * 4,
    o01: (row1 + x0) * 4, o11: (row1 + x1) * 4,
    w00: (1 - tx) * (1 - ty), w10: tx * (1 - ty),
    w01: (1 - tx) * ty, w11: tx * ty,
  };
}

/** One colour channel, weighted by alpha so transparent neighbours don't bleed. */
export function sampleChannel(src, width, height, x, y, channel) {
  const { o00, o10, o01, o11, w00, w10, w01, w11 } = corners(width, height, x, y);

  const a00 = (src[o00 + 3] / 255) * w00;
  const a10 = (src[o10 + 3] / 255) * w10;
  const a01 = (src[o01 + 3] / 255) * w01;
  const a11 = (src[o11 + 3] / 255) * w11;

  const alpha = a00 + a10 + a01 + a11;
  if (alpha <= 0) return 0;

  return (
    src[o00 + channel] * a00
    + src[o10 + channel] * a10
    + src[o01 + channel] * a01
    + src[o11 + channel] * a11
  ) / alpha;
}

/** A whole RGBA pixel, written into `data` at `out`. */
export function samplePixel(src, width, height, x, y, data, out) {
  const { o00, o10, o01, o11, w00, w10, w01, w11 } = corners(width, height, x, y);

  const a00 = (src[o00 + 3] / 255) * w00;
  const a10 = (src[o10 + 3] / 255) * w10;
  const a01 = (src[o01 + 3] / 255) * w01;
  const a11 = (src[o11 + 3] / 255) * w11;

  const alpha = a00 + a10 + a01 + a11;
  data[out + 3] = alpha * 255;

  if (alpha <= 0) {
    data[out] = 0;
    data[out + 1] = 0;
    data[out + 2] = 0;
    return;
  }

  for (let c = 0; c < 3; c++) {
    data[out + c] = (
      src[o00 + c] * a00
      + src[o10 + c] * a10
      + src[o01 + c] * a01
      + src[o11 + c] * a11
    ) / alpha;
  }
}
