import { clamp } from './shared.js';

/**
 * Composites the original crop back over the processed image.
 *
 * The "original" is the image as it entered the chain, not the previous stage's
 * output — that is the whole point. Threshold the photo to hard black and white,
 * then reblend the original at 40% and you get the graphic shape with the real
 * colour pushed back through it. Reading from the previous stage instead would
 * make the effect a no-op.
 *
 * Blending follows the W3C compositing spec rather than a plain cross-fade, so
 * the modes match what Photoshop and CSS `mix-blend-mode` produce, and alpha
 * composites correctly instead of the source punching a hole in a cutout.
 */

/** Separable blend functions, on backdrop and source channels in [0, 1]. */
const BLEND = {
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

const MODES = [
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

export default {
  id: 'reblend',
  label: 'Reblend Original',
  // Last: it exists to bring the photo back over whatever came before.
  stage: 7,
  // Asks the chain runner to keep a copy of the image as it came in.
  needsSource: true,
  params: [
    { key: 'mode', label: 'Blend mode', type: 'select', default: 'normal', options: MODES },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [25, 85] },
  ],

  apply(image, { params, source }) {
    // Without the original there is nothing to blend; leave the image alone
    // rather than inventing something.
    if (!source) return image;

    const { data } = image;
    const src = source.data;
    const opacity = params.opacity / 100;
    if (opacity <= 0) return image;

    const blend = BLEND[params.mode] ?? BLEND.normal;

    for (let i = 0; i < data.length; i += 4) {
      const backdropAlpha = data[i + 3] / 255;
      const sourceAlpha = (src[i + 3] / 255) * opacity;
      if (sourceAlpha <= 0) continue;

      const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }

      for (let c = 0; c < 3; c++) {
        const cb = data[i + c] / 255;
        const cs = src[i + c] / 255;
        // W3C source-over with a blend function: the source shows plainly where
        // the backdrop is transparent, and blends where both are present.
        const co = sourceAlpha * (1 - backdropAlpha) * cs
          + sourceAlpha * backdropAlpha * clamp(blend(cb, cs), 0, 1)
          + (1 - sourceAlpha) * backdropAlpha * cb;
        data[i + c] = (co / outAlpha) * 255;
      }
      data[i + 3] = outAlpha * 255;
    }
    return image;
  },
};
