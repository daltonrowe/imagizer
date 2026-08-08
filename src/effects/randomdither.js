import { DITHER_PARAMS, lumaGrid, writeGrid } from './dither.js';
import { quantise, stepFor } from './shared.js';

/**
 * Dithering against a random threshold per cell — grain rather than pattern.
 *
 * The threshold comes from `rng.noiseAt(gx, gy)`, which depends only on the
 * cell's coordinate and not on how many draws came before it. That keeps the
 * result identical however the work is ordered, and makes it reproducible from
 * the seed: the same seed gives the same grain, a new seed reshuffles it.
 */
export default {
  id: 'randomdither',
  label: 'Random Dither',
  stage: 6,
  params: [
    ...DITHER_PARAMS,
    { key: 'amount', label: 'Noise', type: 'range', min: 0, max: 200, step: 5, default: 100, unit: '%', random: [60, 160] },
  ],

  apply(image, { params, rng }) {
    const scale = Math.max(1, Math.round(params.scale));
    const step = stepFor(params.levels);
    const amount = params.amount / 100;

    const { grid, gridW, gridH } = lumaGrid(image, scale);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const index = gy * gridW + gx;
        // Centred on zero so the noise pushes each cell either side of the
        // nearest tone rather than brightening the image overall.
        const bias = (rng.noiseAt(gx, gy) - 0.5) * amount;
        grid[index] = quantise(grid[index] + bias * step, step);
      }
    }

    return writeGrid(image, grid, gridW, scale);
  },
};
