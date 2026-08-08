import { luma, clamp } from './shared.js';

/** Atkinson diffuses only 6/8 of the error, which is what gives it its bite. */
const NEIGHBOURS = [
  [1, 0], [2, 0],
  [-1, 1], [0, 1], [1, 1],
  [0, 2],
];

export default {
  id: 'atkinson',
  label: 'Atkinson Dither',
  // Last: dithering wants to quantise the final tones, after any blur or sort.
  stage: 4,
  params: [
    { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 8, step: 1, default: 2, random: [2, 4] },
    { key: 'scale', label: 'Pixel size', type: 'range', min: 1, max: 8, step: 1, default: 1, unit: 'px', random: [1, 4] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const scale = Math.max(1, Math.round(params.scale));
    const levels = Math.max(2, Math.round(params.levels));
    const step = 255 / (levels - 1);

    // Work at 1/scale resolution so "pixel size" gives chunky, retro dots
    // rather than a fine dither that disappears at export size.
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

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const index = gy * gridW + gx;
        const old = grid[index];
        const quantised = clamp(Math.round(old / step) * step, 0, 255);
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
  },
};
