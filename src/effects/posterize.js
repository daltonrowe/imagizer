import { luma, quantise, stepFor } from './shared.js';

/**
 * Reduces the image to a small number of tones — the same quantisation the
 * dithers do, without the dithering, so the bands stay flat and hard-edged.
 *
 * Two ways to apply it, which look quite different:
 *
 *   Per channel  snaps red, green and blue independently, giving levels³
 *                possible colours. New hues appear that were not in the photo,
 *                which is the classic screen-print look.
 *   Luminance    snaps brightness and scales the channels to match, so every
 *                pixel keeps its hue and saturation and only the tone steps.
 *                Fewer, truer colours; more like a tonal separation.
 *
 * Scaling a bright saturated colour up to its level can push a channel past 255,
 * where it clips and the hue shifts a little — a saturated red brightened to the
 * next step comes back slightly orange. Avoiding that would mean landing short
 * of the level and breaking the tone count, so it clips, as every implementation
 * of this does.
 */
export default {
  id: 'posterize',
  label: 'Posterize',
  // With the thresholds: a threshold is this with two levels and no colour.
  stage: 5,
  params: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'channel',
      options: [
        { value: 'channel', label: 'Per channel' },
        { value: 'luma', label: 'Luminance' },
      ],
    },
    { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 16, step: 1, default: 5, random: [2, 8] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const step = stepFor(params.levels);

    if (params.mode === 'luma') {
      for (let i = 0; i < data.length; i += 4) {
        const light = luma(data[i], data[i + 1], data[i + 2]);
        const stepped = quantise(light, step);
        if (light < 1) {
          // Near-black has no hue to preserve; scaling it would divide by ~0.
          data[i] = stepped;
          data[i + 1] = stepped;
          data[i + 2] = stepped;
          continue;
        }
        // Scaling keeps the ratios between channels, so hue survives the step.
        const gain = stepped / light;
        data[i] *= gain;
        data[i + 1] *= gain;
        data[i + 2] *= gain;
      }
      return image;
    }

    for (let i = 0; i < data.length; i += 4) {
      data[i] = quantise(data[i], step);
      data[i + 1] = quantise(data[i + 1], step);
      data[i + 2] = quantise(data[i + 2], step);
    }
    return image;
  },
};
