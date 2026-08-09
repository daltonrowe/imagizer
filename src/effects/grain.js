import { clamp, luma } from './shared.js';

/**
 * Film grain: silver halide crystals, not television static.
 *
 * Two things separate the two. Real grain is normally distributed rather than
 * uniform, so most of it is subtle and the occasional speck is not — hence
 * Box-Muller over two noise streams rather than a flat random offset. And it is
 * strongest in the midtones, because a fully exposed or fully unexposed patch
 * of film has no partly-developed crystals left to vary; Midtones dials that
 * from "even everywhere" up to "only where the tone is uncommitted".
 *
 * The noise comes from `noiseAt` on a cell index rather than a running draw, so
 * the same seed grains the preview and the export identically instead of
 * rearranging itself on download. Size is a share of the shorter side for the
 * same reason.
 */
export default {
  id: 'grain',
  label: 'Film Grain',
  // Late, with the dithers: it is the last thing to happen to a photograph, and
  // putting it before a threshold would just get quantised away.
  stage: 6,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 25, unit: '%', random: [10, 55] },
    { key: 'size', label: 'Size', type: 'range', min: 0.1, max: 3, step: 0.1, default: 0.2, unit: '%', random: [0.1, 1] },
    { key: 'midtones', label: 'Midtones', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%', random: [30, 90] },
    { key: 'mono', label: 'Monochrome', type: 'toggle', default: true },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const amount = params.amount / 100;
    if (amount <= 0 || width < 1 || height < 1) return image;

    const cell = Math.max(1, Math.round((params.size / 100) * Math.min(width, height)));
    const bias = params.midtones / 100;
    const strength = amount * 110;

    // Box-Muller needs two independent uniforms per draw; a third stream gives
    // the other two channels something of their own in colour mode.
    const u1 = rng.fork('u1');
    const u2 = rng.fork('u2');
    const chroma = rng.fork('chroma');

    const gaussianAt = (gx, gy, offset) => {
      // Never exactly zero: log(0) is -Infinity.
      const a = Math.max(1e-6, u1.noiseAt(gx + offset, gy));
      const b = u2.noiseAt(gx, gy + offset);
      return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
    };

    for (let y = 0; y < height; y++) {
      const gy = (y / cell) | 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 0) continue;
        const gx = (x / cell) | 0;

        // 1 at mid grey, 0 at either end, mixed against a flat 1 by `bias`.
        const tone = luma(data[i], data[i + 1], data[i + 2]) / 255;
        const weight = 1 - bias * Math.abs(2 * tone - 1);
        if (weight <= 0) continue;

        const base = gaussianAt(gx, gy, 0) * strength * weight;
        if (params.mono) {
          data[i] = clamp(data[i] + base, 0, 255);
          data[i + 1] = clamp(data[i + 1] + base, 0, 255);
          data[i + 2] = clamp(data[i + 2] + base, 0, 255);
          continue;
        }
        for (let c = 0; c < 3; c++) {
          const offset = 977 * (c + 1);
          const noise = base * 0.5 + gaussianAt(gx, gy, offset) * strength * weight * 0.5
            * (0.6 + chroma.noiseAt(gx + offset, gy));
          data[i + c] = clamp(data[i + c] + noise, 0, 255);
        }
      }
    }
    return image;
  },
};
