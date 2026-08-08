import { clamp, hexToRgb } from './shared.js';

/**
 * Cuts the image into bands and slides each one along its own length.
 *
 * Bands run across the image and are displaced perpendicular to how they are
 * stacked: horizontal bands are rows shifted left and right, vertical bands are
 * columns shifted up and down. Every measurement is a percentage — band size of
 * the axis they stack along, shift of the length they travel — so a look holds
 * at any crop size, and the preview matches the export.
 *
 * Shifting does not wrap: a band leaves a gap behind it. What fills that gap is
 * the point of the transparency toggle — leave it on and the gaps punch through
 * to nothing, which a PNG export keeps; turn it off to lay them on a colour.
 */
export default {
  id: 'slicer',
  label: 'Slicer',
  // With the other displacement effects: bands should be there for a threshold
  // or dither to work over, not painted on afterwards.
  stage: 4,
  params: [
    {
      key: 'direction',
      label: 'Bands',
      type: 'select',
      default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    { key: 'size', label: 'Band size', type: 'range', min: 1, max: 50, step: 1, default: 8, unit: '%', random: [2, 20] },
    { key: 'jitter', label: 'Size jitter', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [0, 90] },
    { key: 'shift', label: 'Shift', type: 'range', min: 0, max: 100, step: 1, default: 15, unit: '%', random: [5, 45] },
    { key: 'transparent', label: 'Gaps transparent', type: 'toggle', default: true },
    { key: 'background', label: 'Gap colour', type: 'color', default: '#000000' },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const vertical = params.direction === 'vertical';

    // `lines` are stacked across the band axis; each line runs `length` pixels
    // with `step` between them, and `lineStep` moves to the next line.
    const lines = vertical ? width : height;
    const length = vertical ? height : width;
    const step = vertical ? width * 4 : 4;
    const lineStep = vertical ? 4 : width * 4;

    const bandSize = Math.max(1, Math.round((lines * params.size) / 100));
    const jitter = params.jitter / 100;
    const maxShift = (length * params.shift) / 100;

    const [fillR, fillG, fillB] = hexToRgb(params.background);
    const fillA = params.transparent ? 0 : 255;

    // One scratch line, reused: a band's pixels have to be read before any are
    // overwritten, and reallocating per line would dominate the cost.
    const scratch = new Uint8ClampedArray(length * 4);

    let line = 0;
    while (line < lines) {
      // Thickness varies either side of the nominal size, never below 1.
      const wobble = jitter > 0 ? 1 + jitter * (rng.next() * 2 - 1) : 1;
      const thickness = clamp(Math.round(bandSize * wobble), 1, lines - line);
      const offset = Math.round(maxShift * (rng.next() * 2 - 1));

      if (offset !== 0) {
        for (let l = line; l < line + thickness; l++) {
          const base = l * lineStep;

          for (let i = 0; i < length; i++) {
            const from = base + i * step;
            const to = i * 4;
            scratch[to] = data[from];
            scratch[to + 1] = data[from + 1];
            scratch[to + 2] = data[from + 2];
            scratch[to + 3] = data[from + 3];
          }

          for (let i = 0; i < length; i++) {
            const source = i - offset;
            const to = base + i * step;
            if (source < 0 || source >= length) {
              data[to] = fillR;
              data[to + 1] = fillG;
              data[to + 2] = fillB;
              data[to + 3] = fillA;
            } else {
              const from = source * 4;
              data[to] = scratch[from];
              data[to + 1] = scratch[from + 1];
              data[to + 2] = scratch[from + 2];
              data[to + 3] = scratch[from + 3];
            }
          }
        }
      }

      line += thickness;
    }
    return image;
  },
};
