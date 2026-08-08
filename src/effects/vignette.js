import { halfExtent, radialDarken } from './falloff.js';

/**
 * Darkens the edges, heaviest in the corners.
 *
 * Distance is measured per axis against that axis's half-size, so the clear
 * region is an ellipse matching the frame: on a wide crop the vignette reaches
 * in further from the sides than from the top, which is what keeps it looking
 * like a lens falloff rather than a circle pasted on.
 *
 * Size and softness are scaled so their full range is useful — 1.0 in these
 * units is an edge midpoint and √2 is a corner, so at size 100 the falloff only
 * starts at the very corners.
 */
export default {
  id: 'vignette',
  label: 'Vignette',
  // With the tonal effects: dark edges should be there for a threshold or
  // dither to pick up, rather than painted over the top of one.
  stage: 4,
  params: [
    { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 100, step: 1, default: 65, unit: '%', random: [40, 95] },
    { key: 'size', label: 'Size', type: 'range', min: 0, max: 100, step: 1, default: 55, unit: '%', random: [30, 70] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 45, unit: '%', random: [20, 70] },
  ],

  apply(image, { params }) {
    return radialDarken(image, {
      strength: params.strength / 100,
      inner: (params.size / 100) * Math.SQRT2,
      feather: (params.softness / 100) * Math.SQRT2,
      scaleX: 1 / halfExtent(image.width),
      scaleY: 1 / halfExtent(image.height),
    });
  },
};
