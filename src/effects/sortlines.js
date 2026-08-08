import { luma, clamp } from './shared.js';

/**
 * Shared machinery for the two sorting effects.
 *
 * Both walk each line looking for runs above a threshold and sort them; they
 * differ in what they read and what they move:
 *
 *   Pixel Sort    keys on luminance and moves whole pixels, so colours stay
 *                 intact and only their order changes.
 *   Channel Sort  keys on one channel and moves only that channel, leaving the
 *                 other two where they were. Pixels are torn apart rather than
 *                 rearranged, which is what produces the colour fringing.
 */

export const DIRECTION_PARAM = {
  key: 'direction',
  label: 'Direction',
  type: 'select',
  default: 'horizontal',
  options: [
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'vertical', label: 'Vertical' },
  ],
};

/** Threshold, run cap, coverage and order — identical for both effects. */
export const RUN_PARAMS = [
  { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, step: 1, default: 110, random: [60, 180] },
  { key: 'maxRun', label: 'Max run', type: 'range', min: 1, max: 100, step: 1, default: 25, unit: '%', random: [5, 60] },
  { key: 'coverage', label: 'Coverage', type: 'range', min: 5, max: 100, step: 5, default: 100, unit: '%', random: [40, 100] },
  { key: 'reverse', label: 'Reverse', type: 'toggle', default: false },
];

/**
 * Sort runs along every line. `channel` picks the mode: null keys on luminance
 * and moves whole pixels, 0/1/2 keys on that channel and moves only it.
 */
export function sortLines(image, { params, rng, channel = null }) {
  const { data, width, height } = image;
  const vertical = params.direction === 'vertical';

  // One code path for both axes: `step` walks along the line being sorted,
  // `lineStep` moves to the next line.
  const lines = vertical ? width : height;
  const length = vertical ? height : width;
  const step = vertical ? width * 4 : 4;
  const lineStep = vertical ? 4 : width * 4;

  const coverage = params.coverage / 100;
  // A share of the line rather than a pixel count, so the preview and the
  // full-size export break into the same number of streaks.
  const maxRun = Math.max(2, Math.round((length * params.maxRun) / 100));
  const sign = params.reverse ? -1 : 1;

  const valueAt = channel === null
    ? (offset) => luma(data[offset], data[offset + 1], data[offset + 2])
    : (offset) => data[offset + channel];

  for (let line = 0; line < lines; line++) {
    // Skipping whole lines is what keeps the effect from looking uniform.
    if (!rng.bool(coverage)) continue;

    const base = line * lineStep;
    // A little per-line wobble in the threshold breaks up banding.
    const level = clamp(params.threshold + rng.int(-12, 12), 0, 255);

    let start = 0;
    while (start < length) {
      while (start < length && valueAt(base + start * step) < level) start++;
      if (start >= length) break;

      let end = start;
      while (end < length && valueAt(base + end * step) >= level && end - start < maxRun) end++;

      if (end - start > 1) sortRun(data, base, start, end, step, sign, valueAt, channel);
      start = end;
    }
  }
  return image;
}

function sortRun(data, base, start, end, step, sign, valueAt, channel) {
  if (channel !== null) {
    // Only this channel moves; the others keep their positions.
    const run = [];
    for (let i = start; i < end; i++) run.push(data[base + i * step + channel]);
    run.sort((a, b) => (a - b) * sign);
    for (let i = start; i < end; i++) data[base + i * step + channel] = run[i - start];
    return;
  }

  const run = [];
  for (let i = start; i < end; i++) {
    const offset = base + i * step;
    run.push([valueAt(offset), data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
  }
  run.sort((a, b) => (a[0] - b[0]) * sign);

  for (let i = start; i < end; i++) {
    const pixel = run[i - start];
    const offset = base + i * step;
    data[offset] = pixel[1];
    data[offset + 1] = pixel[2];
    data[offset + 2] = pixel[3];
    data[offset + 3] = pixel[4];
  }
}
