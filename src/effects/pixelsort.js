import { luma, clamp } from './shared.js';

/**
 * The glitch-art staple: find runs of pixels brighter than a threshold and sort
 * them by luminance, which smears them into clean gradient streaks.
 *
 * This is the effect that leans hardest on the seed — which lines get sorted and
 * how the threshold wobbles per line both come from the generator, so the same
 * seed reproduces the same streaks exactly.
 */
export default {
  id: 'pixelsort',
  label: 'Pixel Sort',
  // Middle: wants real tones to sort, but before a threshold flattens them.
  stage: 2,
  params: [
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, step: 1, default: 110, random: [60, 180] },
    { key: 'maxLength', label: 'Max run', type: 'range', min: 4, max: 600, step: 4, default: 200, unit: 'px', random: [40, 400] },
    { key: 'coverage', label: 'Coverage', type: 'range', min: 5, max: 100, step: 5, default: 100, unit: '%', random: [40, 100] },
    { key: 'reverse', label: 'Reverse', type: 'toggle', default: false },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const vertical = params.direction === 'vertical';

    // One code path for both axes: `step` walks along the line being sorted,
    // `lineStep` moves to the next line.
    const lines = vertical ? width : height;
    const length = vertical ? height : width;
    const step = vertical ? width * 4 : 4;
    const lineStep = vertical ? 4 : width * 4;

    const coverage = params.coverage / 100;
    const maxRun = Math.max(2, Math.round(params.maxLength));
    const sign = params.reverse ? -1 : 1;
    const brightness = (offset) => luma(data[offset], data[offset + 1], data[offset + 2]);

    for (let line = 0; line < lines; line++) {
      // Skipping whole lines is what keeps the effect from looking uniform.
      if (!rng.bool(coverage)) continue;

      const base = line * lineStep;
      // A little per-line wobble in the threshold breaks up banding.
      const level = clamp(params.threshold + rng.int(-12, 12), 0, 255);

      let start = 0;
      while (start < length) {
        while (start < length && brightness(base + start * step) < level) start++;
        if (start >= length) break;

        let end = start;
        while (end < length && brightness(base + end * step) >= level && end - start < maxRun) end++;

        if (end - start > 1) sortRun(data, base, start, end, step, sign, brightness);
        start = end;
      }
    }
    return image;
  },
};

function sortRun(data, base, start, end, step, sign, brightness) {
  const run = [];
  for (let i = start; i < end; i++) {
    const o = base + i * step;
    run.push([brightness(o), data[o], data[o + 1], data[o + 2], data[o + 3]]);
  }

  run.sort((a, b) => (a[0] - b[0]) * sign);

  for (let i = start; i < end; i++) {
    const pixel = run[i - start];
    const o = base + i * step;
    data[o] = pixel[1];
    data[o + 1] = pixel[2];
    data[o + 2] = pixel[3];
    data[o + 3] = pixel[4];
  }
}
