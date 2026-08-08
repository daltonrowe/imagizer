import { DITHER_PARAMS, lumaGrid, writeGrid } from './dither.js';
import { quantise, stepFor } from './shared.js';

/** Atkinson diffuses only 6/8 of the error, which is what gives it its bite. */
const NEIGHBOURS = [
  [1, 0], [2, 0],
  [-1, 1], [0, 1], [1, 1],
  [0, 2],
];

/**
 * Error-diffusion dithering: each cell is rounded to the nearest tone and the
 * rounding error is pushed onto cells not yet visited, so the pattern follows
 * the image rather than a fixed grid.
 */
export default {
  id: 'atkinson',
  label: 'Atkinson Dither',
  // Last: dithering wants to quantise the final tones, after any blur or sort.
  stage: 6,
  params: DITHER_PARAMS,

  apply(image, { params }) {
    const scale = Math.max(1, Math.round(params.scale));
    const step = stepFor(params.levels);
    const { grid, gridW, gridH } = lumaGrid(image, scale);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const index = gy * gridW + gx;
        const old = grid[index];
        const quantised = quantise(old, step);
        grid[index] = quantised;

        const error = (old - quantised) / 8;
        if (error === 0) continue;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= gridW || ny >= gridH) continue;
          grid[ny * gridW + nx] += error;
        }
      }
    }

    return writeGrid(image, grid, gridW, scale);
  },
};
