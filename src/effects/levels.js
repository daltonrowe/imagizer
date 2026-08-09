import { clamp, luma } from './shared.js';

/**
 * Brightness, contrast, gamma and saturation — the tonal groundwork.
 *
 * Everything else in the chain reacts to tone: a threshold cuts where the
 * luminance is, a pixel sort walks the runs that clear it, a bloom picks the
 * highlights. A flat photo therefore gives flat results, and this is the stage
 * that fixes that rather than fighting each effect's own controls.
 *
 * Brightness, contrast and gamma are pure per-channel functions of the input,
 * so they collapse into a 256-entry lookup table built once and read per pixel.
 * Saturation cannot: it needs the pixel's own luminance, so it happens after.
 *
 * The order is brightness, then contrast about mid grey, then gamma — the same
 * order a darkroom would: expose, develop, then print.
 */
export default {
  id: 'levels',
  label: 'Levels',
  // Early: everything downstream reads tone, so it should read the corrected one.
  stage: 1,
  params: [
    { key: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, step: 1, default: 0, unit: '%', random: [-25, 25] },
    { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, step: 1, default: 0, unit: '%', random: [-20, 60] },
    { key: 'gamma', label: 'Gamma', type: 'range', min: 20, max: 300, step: 1, default: 100, unit: '%', random: [70, 160] },
    { key: 'saturation', label: 'Saturation', type: 'range', min: 0, max: 200, step: 1, default: 100, unit: '%', random: [0, 180] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const saturation = params.saturation / 100;
    const flat = params.brightness === 0 && params.contrast === 0
      && params.gamma === 100 && saturation === 1;
    if (flat) return image;

    const brightness = (params.brightness / 100) * 255;
    // The usual contrast curve: a slope about mid grey that goes vertical as
    // the control approaches its ends.
    const c = (params.contrast / 100) * 255;
    const slope = (259 * (c + 255)) / (255 * (259 - c));
    const power = 100 / params.gamma;

    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const lit = v + brightness;
      const contrasted = slope * (lit - 128) + 128;
      lut[v] = clamp(255 * (clamp(contrasted, 0, 255) / 255) ** power, 0, 255);
    }

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      const r = lut[data[i]];
      const g = lut[data[i + 1]];
      const b = lut[data[i + 2]];

      if (saturation === 1) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        continue;
      }
      // Past 100% this pushes away from grey rather than toward it, which is
      // the same line extended — no separate branch needed.
      const grey = luma(r, g, b);
      data[i] = clamp(grey + (r - grey) * saturation, 0, 255);
      data[i + 1] = clamp(grey + (g - grey) * saturation, 0, 255);
      data[i + 2] = clamp(grey + (b - grey) * saturation, 0, 255);
    }
    return image;
  },
};
