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
 * Cross shift displaces a band across the stack as well as along it, so bands
 * land on top of their neighbours and leave their own row empty.
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
    { key: 'crossShift', label: 'Cross shift', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: '%', random: [0, 15] },
    { key: 'transparent', label: 'Gaps transparent', type: 'toggle', default: true },
    { key: 'background', label: 'Gap colour', type: 'color', default: '#000000', showWhen: (p) => !p.transparent },
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
    const maxCross = (lines * params.crossShift) / 100;

    const [fillR, fillG, fillB] = hexToRgb(params.background);
    const fillA = params.transparent ? 0 : 255;

    // Read from a copy and paint into a cleared image: a band moved across the
    // stack lands on its neighbours, so the originals must survive being
    // overwritten, and any row nothing lands on is left as gap.
    const source = Uint8ClampedArray.from(data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fillR;
      data[i + 1] = fillG;
      data[i + 2] = fillB;
      data[i + 3] = fillA;
    }

    let line = 0;
    while (line < lines) {
      // Thickness varies either side of the nominal size, never below 1.
      const wobble = jitter > 0 ? 1 + jitter * (rng.next() * 2 - 1) : 1;
      const thickness = clamp(Math.round(bandSize * wobble), 1, lines - line);
      const offset = Math.round(maxShift * (rng.next() * 2 - 1));
      // Only drawn when it can do something, so leaving cross shift at zero
      // reproduces exactly what a seed rendered before it existed.
      const cross = maxCross > 0 ? Math.round(maxCross * (rng.next() * 2 - 1)) : 0;

      for (let l = line; l < line + thickness; l++) {
        const target = l + cross;
        if (target < 0 || target >= lines) continue;

        const from = l * lineStep;
        const to = target * lineStep;
        for (let i = 0; i < length; i++) {
          const take = i - offset;
          if (take < 0 || take >= length) continue;   // stays gap
          const src = from + take * step;
          const dst = to + i * step;
          data[dst] = source[src];
          data[dst + 1] = source[src + 1];
          data[dst + 2] = source[src + 2];
          data[dst + 3] = source[src + 3];
        }
      }

      line += thickness;
    }
    return image;
  },
};
