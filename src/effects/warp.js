import { EDGE_PARAMS, edgeFill, writeFill } from './edges.js';
import { samplePixel } from './sampling.js';

/**
 * Displaces every pixel by a smooth noise field — heat haze, melting glass,
 * the liquify brush without the brush.
 *
 * The field is value noise: random values on a coarse lattice, smoothly
 * interpolated between. What makes it read as flowing rather than as static is
 * that neighbouring pixels get nearly the same displacement, which only happens
 * because the lattice is coarse and the interpolation is eased.
 *
 * Detail stacks octaves — each one half the scale and half the strength of the
 * last. One octave is a slow swell; three add the fine creases that make it
 * look like a material rather than a wobble.
 *
 * The lattice is measured in cells across the image rather than in pixels, so a
 * cell has the same index at any size and the same seed warps the preview and
 * the export identically.
 */
export default {
  id: 'warp',
  label: 'Noise Warp',
  stage: 4,
  params: [
    { key: 'scale', label: 'Scale', type: 'range', min: 2, max: 60, step: 1, default: 18, unit: '%', random: [8, 40] },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 30, step: 0.5, default: 5, unit: '%', random: [2, 14] },
    { key: 'detail', label: 'Detail', type: 'range', min: 1, max: 4, step: 1, default: 2, random: [1, 3] },
    ...EDGE_PARAMS,
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const minor = Math.min(width, height);
    const amount = (params.amount / 100) * minor;
    if (amount <= 0 || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const { stretch, fill } = edgeFill(params);

    // Cells across the shorter side, so the field is the same shape at any size.
    const cells = Math.max(1, 100 / params.scale);
    const fieldX = rng.fork('x');
    const fieldY = rng.fork('y');
    const octaves = Math.round(params.detail);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Normalised position, so the lattice does not stretch with the frame.
        const u = (x / minor) * cells;
        const v = (y / minor) * cells;

        let dx = 0;
        let dy = 0;
        let frequency = 1;
        let weight = 1;
        let total = 0;
        for (let octave = 0; octave < octaves; octave++) {
          dx += (valueNoise(fieldX, u * frequency, v * frequency, octave) - 0.5) * weight;
          dy += (valueNoise(fieldY, u * frequency, v * frequency, octave) - 0.5) * weight;
          total += weight;
          frequency *= 2;
          weight *= 0.5;
        }

        const sx = x + (dx / total) * 2 * amount;
        const sy = y + (dy / total) * 2 * amount;

        if (!stretch && (sx < 0 || sx > width - 1 || sy < 0 || sy > height - 1)) {
          writeFill(data, i, fill);
          continue;
        }
        samplePixel(src, width, height, sx, sy, data, i);
      }
    }
    return image;
  },
};

/** Smoothstep-interpolated value noise on the integer lattice, in [0, 1). */
function valueNoise(stream, x, y, octave) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  // Eased, not linear: linear interpolation leaves visible creases along every
  // lattice line, because the displacement's slope jumps at each one.
  const ex = tx * tx * (3 - 2 * tx);
  const ey = ty * ty * (3 - 2 * ty);
  // Octaves are offset so they cannot line up and reinforce into a grid.
  const shift = octave * 8191;

  const n00 = stream.noiseAt(x0 + shift, y0 + shift);
  const n10 = stream.noiseAt(x0 + 1 + shift, y0 + shift);
  const n01 = stream.noiseAt(x0 + shift, y0 + 1 + shift);
  const n11 = stream.noiseAt(x0 + 1 + shift, y0 + 1 + shift);

  const top = n00 + (n10 - n00) * ex;
  const bottom = n01 + (n11 - n01) * ex;
  return top + (bottom - top) * ey;
}
