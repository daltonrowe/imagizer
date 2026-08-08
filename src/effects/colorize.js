import { hexToRgb, hslToRgb, luma, rgbToHsl } from './shared.js';

/**
 * Tints the image with a single colour, keeping its luminance.
 *
 * Each pixel takes the hue and saturation of the chosen colour and keeps its
 * own lightness, so shadows stay dark and highlights stay bright — a duotone
 * wash rather than a flat overlay. `amount` mixes back toward the original,
 * so partway settings desaturate toward the tint instead of jumping to it.
 */
export default {
  id: 'colorize',
  label: 'Colorize',
  stage: 3,
  params: [
    { key: 'color', label: 'Colour', type: 'color', default: '#4f9dff' },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [55, 100] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const amount = params.amount / 100;
    if (amount <= 0) return image;

    const [h, s] = rgbToHsl(...hexToRgb(params.color));

    // Only lightness varies per pixel, so the 256 possible results are worth
    // computing once rather than a full HSL conversion per pixel.
    const lut = new Float32Array(256 * 3);
    for (let v = 0; v < 256; v++) {
      const [r, g, b] = hslToRgb(h, s, v / 255);
      lut[v * 3] = r;
      lut[v * 3 + 1] = g;
      lut[v * 3 + 2] = b;
    }

    for (let i = 0; i < data.length; i += 4) {
      const light = Math.round(luma(data[i], data[i + 1], data[i + 2]));
      const base = (light < 0 ? 0 : light > 255 ? 255 : light) * 3;
      data[i] += (lut[base] - data[i]) * amount;
      data[i + 1] += (lut[base + 1] - data[i + 1]) * amount;
      data[i + 2] += (lut[base + 2] - data[i + 2]) * amount;
    }
    return image;
  },
};
