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

// ---------- tone quantisation ----------

/** Gap between output tones for a given number of levels. */
export const stepFor = (levels) => 255 / (Math.max(2, Math.round(levels)) - 1);

/** Snap a value to the nearest of `levels` evenly spaced tones. */
export const quantise = (value, step) => clamp(Math.round(value / step) * step, 0, 255);

// ---------- colour ----------

/** `#rrggbb` to [r, g, b] in 0-255. Falls back to black on anything else. */
export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!match) return [0, 0, 0];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(r, g, b) {
  const hex = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** [r, g, b] in 0-255 to [hue 0-360, saturation 0-1, lightness 0-1]. */
export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return [h, s, l];
}

/** [hue 0-360, saturation 0-1, lightness 0-1] to [r, g, b] in 0-255. */
export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;

  const channel = (t) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };

  return [channel(hk + 1 / 3) * 255, channel(hk) * 255, channel(hk - 1 / 3) * 255];
}
