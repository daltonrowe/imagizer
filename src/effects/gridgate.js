import { hexToRgb } from './shared.js';

/**
 * Masks the image behind a regular grid of apertures: pixels inside an aperture
 * pass through untouched, everything else is blocked.
 *
 * The grid is fixed — anchored to the top-left corner, evenly spaced, no
 * randomness at all, so it ignores the seed. Cell size is a percentage of the
 * shorter side and the aperture a percentage of the cell, which keeps the
 * pattern the same shape whatever size the crop is rendered at.
 *
 * One size for both axes, measured against the shorter side, is what makes the
 * cells actually square on a crop that isn't: a percentage per axis would
 * stretch them with the frame, and stretched cells make the square aperture a
 * rectangle and the circle an ellipse.
 *
 * Square apertures give a window grid; circular ones give dots, and at 100% a
 * circle still blocks the cell corners because it is inscribed in the cell.
 * Blocked pixels either punch through to transparency, which a PNG export
 * keeps, or take a colour.
 */
export default {
  id: 'gridgate',
  label: 'Grid Gate',
  // Late: gating the finished image cuts crisp holes in it, where gating early
  // would just hand a threshold or dither some flat blocks to chew on.
  stage: 6,
  params: [
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      default: 'square',
      options: [
        { value: 'square', label: 'Square' },
        { value: 'circle', label: 'Circle' },
      ],
    },
    { key: 'cell', label: 'Cell size', type: 'range', min: 1, max: 50, step: 1, default: 6, unit: '%', random: [2, 16] },
    { key: 'aperture', label: 'Aperture', type: 'range', min: 5, max: 100, step: 1, default: 60, unit: '%', random: [30, 85] },
    { key: 'transparent', label: 'Gaps transparent', type: 'toggle', default: true },
    { key: 'background', label: 'Gap colour', type: 'color', default: '#000000', showWhen: (p) => !p.transparent },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;

    const cell = Math.max(2, Math.round((Math.min(width, height) * params.cell) / 100));
    const open = params.aperture / 100;
    const circle = params.shape === 'circle';

    const [fillR, fillG, fillB] = hexToRgb(params.background);
    const fillA = params.transparent ? 0 : 255;

    for (let y = 0; y < height; y++) {
      // Position within the cell, as -0.5..0.5 from its centre.
      const fy = ((y % cell) + 0.5) / cell - 0.5;
      const fySq = fy * fy;

      for (let x = 0; x < width; x++) {
        const fx = ((x % cell) + 0.5) / cell - 0.5;

        // Doubled so the test reads directly against `open`: 100% square fills
        // the cell edge to edge, 100% circle is the one inscribed in it.
        const reach = circle
          ? Math.sqrt(fx * fx + fySq) * 2
          : Math.max(Math.abs(fx), Math.abs(fy)) * 2;
        if (reach <= open) continue;

        const i = (y * width + x) * 4;
        data[i] = fillR;
        data[i + 1] = fillG;
        data[i + 2] = fillB;
        data[i + 3] = fillA;
      }
    }
    return image;
  },
};
