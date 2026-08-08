import { luma } from './shared.js';

/**
 * Scaffolding the three dithering effects share.
 *
 * All of them do the same three things and differ only in the middle step:
 * average the image down to a grid of luminance cells, decide a value for each
 * cell, then paint the cells back as blocks. Working on a grid is what makes
 * "pixel size" give chunky retro dots rather than a fine dither that disappears
 * at export size.
 */

/** Average the image into a luminance grid at 1/scale resolution. */
export function lumaGrid(image, scale) {
  const { data, width, height } = image;
  const gridW = Math.ceil(width / scale);
  const gridH = Math.ceil(height / scale);
  const grid = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0;
      let count = 0;
      for (let y = gy * scale; y < Math.min((gy + 1) * scale, height); y++) {
        for (let x = gx * scale; x < Math.min((gx + 1) * scale, width); x++) {
          const i = (y * width + x) * 4;
          sum += luma(data[i], data[i + 1], data[i + 2]);
          count++;
        }
      }
      grid[gy * gridW + gx] = count ? sum / count : 0;
    }
  }
  return { grid, gridW, gridH };
}

/** Paint a grid back over the image as solid blocks, leaving alpha alone. */
export function writeGrid(image, grid, gridW, scale) {
  const { data, width, height } = image;
  for (let y = 0; y < height; y++) {
    const gy = (y / scale) | 0;
    for (let x = 0; x < width; x++) {
      const value = grid[gy * gridW + ((x / scale) | 0)];
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }
  return image;
}

/** Shared params: every dither effect offers the same tone count and cell size. */
export const DITHER_PARAMS = [
  { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 8, step: 1, default: 2, random: [2, 4] },
  { key: 'scale', label: 'Pixel size', type: 'range', min: 1, max: 8, step: 1, default: 1, unit: 'px', random: [1, 4] },
];
