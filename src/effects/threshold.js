import { luma } from './shared.js';

export default {
  id: 'threshold',
  label: 'Threshold BW',
  // Late: hard black-and-white is usually the finishing move, not the base.
  stage: 3,
  params: [
    { key: 'level', label: 'Level', type: 'range', min: 0, max: 255, step: 1, default: 128, random: [70, 190] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 128, step: 1, default: 0, random: [0, 40] },
    { key: 'invert', label: 'Invert', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data } = image;
    const { level, softness, invert } = params;

    for (let i = 0; i < data.length; i += 4) {
      const value = luma(data[i], data[i + 1], data[i + 2]);

      // Softness fades the cut into a ramp instead of a hard edge; at 0 this is
      // a plain comparison.
      let out;
      if (softness === 0) {
        out = value >= level ? 255 : 0;
      } else {
        out = ((value - level) / (softness * 2) + 0.5) * 255;
        out = out < 0 ? 0 : out > 255 ? 255 : out;
      }
      if (invert) out = 255 - out;

      data[i] = out;
      data[i + 1] = out;
      data[i + 2] = out;
    }
    return image;
  },
};
