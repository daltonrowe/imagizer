import { inscribedRadius, radialDarken } from './falloff.js';

/**
 * Darkens everything outside a circle in the middle of the crop.
 *
 * The same falloff as Vignette, measured differently: both axes share one
 * scale, so the lit region is a true circle rather than an ellipse following
 * the frame. On a wide crop that is the visible difference — a vignette hugs
 * the sides, a spotlight stays round and leaves broad dark bands left and
 * right.
 *
 * Radius is a share of the largest circle that fits, so 100% touches the
 * nearest edges and the corners stay outside it.
 */
export default {
  id: 'spotlight',
  label: 'Spotlight',
  stage: 4,
  params: [
    { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 100, step: 1, default: 80, unit: '%', random: [55, 100] },
    { key: 'radius', label: 'Radius', type: 'range', min: 0, max: 100, step: 1, default: 45, unit: '%', random: [25, 65] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 40, unit: '%', random: [15, 60] },
  ],

  apply(image, { params }) {
    const scale = 1 / inscribedRadius(image.width, image.height);
    return radialDarken(image, {
      strength: params.strength / 100,
      inner: params.radius / 100,
      feather: params.softness / 100,
      scaleX: scale,
      scaleY: scale,
    });
  },
};
