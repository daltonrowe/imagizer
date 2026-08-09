import { smoothstep } from './falloff.js';
import { luma } from './shared.js';

/**
 * The Sabattier effect: everything past a threshold comes back as its negative.
 *
 * A darkroom accident before it was a technique — flash the paper mid-develop
 * and the parts already exposed reverse, leaving a bright line where the two
 * directions cross. That line is the point of it, and Softness is how wide it
 * runs: at zero the switch is instant and the boundary is a hard seam, and
 * opening it up spreads the crossover into the halo the print actually has.
 *
 * Keying on luminance rather than per channel keeps the reversal coherent, so a
 * bright red flips to a dark one instead of the three channels each deciding
 * separately and scattering the hue.
 */
export default {
  id: 'solarize',
  label: 'Solarize',
  // With the thresholds and posterize: a tone mapping applied to finished
  // colour, before anything screens or dithers it.
  stage: 5,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [25, 75] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 20, unit: '%', random: [0, 60] },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [50, 100] },
    { key: 'below', label: 'Reverse shadows instead', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data } = image;
    const amount = params.amount / 100;
    if (amount <= 0) return image;

    const threshold = (params.threshold / 100) * 255;
    const feather = Math.max((params.softness / 100) * 255, 1e-4);
    const from = threshold - feather / 2;
    const to = threshold + feather / 2;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;

      const tone = luma(data[i], data[i + 1], data[i + 2]);
      const above = smoothstep(from, to, tone);
      const mix = (params.below ? 1 - above : above) * amount;
      if (mix <= 0) continue;

      for (let c = 0; c < 3; c++) {
        data[i + c] = data[i + c] + (255 - 2 * data[i + c]) * mix;
      }
    }
    return image;
  },
};
