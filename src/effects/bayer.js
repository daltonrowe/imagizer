import { DITHER_PARAMS, lumaGrid, quantise, stepFor, writeGrid } from './dither.js';

/**
 * Ordered dithering against a Bayer matrix.
 *
 * Where Atkinson diffuses error to its neighbours and Random Dither rolls a
 * threshold per cell, this compares each cell against a fixed repeating matrix.
 * That is what gives it the recognisable woven crosshatch — and it is entirely
 * position-based, so it uses no randomness at all and ignores the seed.
 */

/**
 * The recursive Bayer construction: each level quadruples the previous matrix
 * and offsets the quadrants by 0, 2, 3, 1.
 */
function bayerMatrix(size) {
  if (size <= 1) return [[0]];
  const half = bayerMatrix(size / 2);
  const n = size / 2;
  const out = Array.from({ length: size }, () => new Array(size));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const base = half[y][x] * 4;
      out[y][x] = base;
      out[y][x + n] = base + 2;
      out[y + n][x] = base + 3;
      out[y + n][x + n] = base + 1;
    }
  }
  return out;
}

// Built once: these never change.
const MATRICES = { 2: bayerMatrix(2), 4: bayerMatrix(4), 8: bayerMatrix(8) };

export default {
  id: 'bayer',
  label: 'Bayer Dither',
  stage: 6,
  params: [
    {
      key: 'matrix',
      label: 'Matrix',
      type: 'select',
      default: '4',
      options: [
        { value: '2', label: '2 × 2' },
        { value: '4', label: '4 × 4' },
        { value: '8', label: '8 × 8' },
      ],
    },
    ...DITHER_PARAMS,
  ],

  apply(image, { params }) {
    const scale = Math.max(1, Math.round(params.scale));
    const step = stepFor(params.levels);
    const matrix = MATRICES[params.matrix] ?? MATRICES[4];
    const size = matrix.length;
    const cells = size * size;

    const { grid, gridW, gridH } = lumaGrid(image, scale);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        // Matrix values spread evenly over -0.5..+0.5 of one tone step, so the
        // cell is nudged either side of the nearest level by its position.
        const bias = (matrix[gy % size][gx % size] + 0.5) / cells - 0.5;
        const index = gy * gridW + gx;
        grid[index] = quantise(grid[index] + bias * step, step);
      }
    }

    return writeGrid(image, grid, gridW, scale);
  },
};
