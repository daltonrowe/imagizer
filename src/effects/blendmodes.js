import { clamp } from './shared.js';

/**
 * Blend modes and the compositing loop that lays one image over another.
 *
 * Shared by the two reblend effects: one reaches for the chain input, the other
 * for an earlier stage, but what they do with the image they find is identical.
 *
 * Blending follows the W3C compositing spec rather than a plain cross-fade, so
 * the modes match what Photoshop and CSS `mix-blend-mode` produce, and alpha
 * composites correctly instead of the source punching a hole in a cutout.
 */

/** Separable blend functions, on backdrop and source channels in [0, 1]. */
export const BLEND = {
  normal: (cb, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)),
  darken: (cb, cs) => Math.min(cb, cs),
  lighten: (cb, cs) => Math.max(cb, cs),
  'color-dodge': (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard-light': (cb, cs) => (cs <= 0.5 ? 2 * cs * cb : 1 - 2 * (1 - cs) * (1 - cb)),
  'soft-light': (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  },
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
};

/** Options for a `select` param, in the order the UI lists them. */
export const MODES = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

/** Which of the two images ends up on top of the stack. */
export const ORDERS = [
  { value: 'over', label: 'Incoming on top' },
  { value: 'under', label: 'Incoming underneath' },
];

export const BLEND_PARAMS = [
  { key: 'mode', label: 'Blend mode', type: 'select', default: 'normal', options: MODES },
  { key: 'order', label: 'Order', type: 'select', default: 'over', options: ORDERS },
  { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [25, 85] },
];

/**
 * Composite `source` with `image`, writing the result into `image`. Both must
 * be the same size; a mismatch is left alone rather than smeared across the
 * wrong rows.
 *
 * `order` decides which one is the backdrop and which is the layer on top of
 * it. The blend function always takes the pair as (backdrop, top), so switching
 * the order really does swap the arguments rather than just reversing an
 * opacity — for an asymmetric mode like Color Dodge or Soft Light those are
 * entirely different pictures.
 *
 * Opacity always belongs to the incoming image, whichever end of the stack it
 * is at: it is the layer being added, so zero is a no-op either way.
 *
 * Underneath has a consequence worth knowing: where the current image is opaque
 * and the mode is Normal, an image behind it is hidden completely, and the
 * effect looks broken when it is doing exactly what it says. It shows through
 * where the current image is transparent, and everywhere if the mode is one
 * that actually mixes the two.
 */
export function composite(image, source, { mode, opacity: percent, order = 'over' }) {
  if (!source) return image;

  const { data } = image;
  const src = source.data;
  if (src.length !== data.length) return image;

  const opacity = percent / 100;
  if (opacity <= 0) return image;

  const blend = BLEND[mode] ?? BLEND.normal;
  const under = order === 'under';

  for (let i = 0; i < data.length; i += 4) {
    const currentAlpha = data[i + 3] / 255;
    const incomingAlpha = (src[i + 3] / 255) * opacity;
    // Nothing arriving means nothing to composite, at either end of the stack.
    if (incomingAlpha <= 0) continue;

    const backdropAlpha = under ? incomingAlpha : currentAlpha;
    const topAlpha = under ? currentAlpha : incomingAlpha;

    const outAlpha = topAlpha + backdropAlpha * (1 - topAlpha);
    if (outAlpha <= 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }

    for (let c = 0; c < 3; c++) {
      const cb = (under ? src[i + c] : data[i + c]) / 255;
      const cs = (under ? data[i + c] : src[i + c]) / 255;
      // W3C source-over with a blend function: the top layer shows plainly
      // where the backdrop is transparent, and blends where both are present.
      const co = topAlpha * (1 - backdropAlpha) * cs
        + topAlpha * backdropAlpha * clamp(blend(cb, cs), 0, 1)
        + (1 - topAlpha) * backdropAlpha * cb;
      data[i + c] = (co / outAlpha) * 255;
    }
    data[i + 3] = outAlpha * 255;
  }
  return image;
}
