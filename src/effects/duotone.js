import { clamp, hexToRgb, luma } from './shared.js';

/**
 * Maps luminance onto a two-colour ramp — the Blue Note sleeve, the risograph,
 * the duotone print.
 *
 * Not the same thing as Colorize, which keeps every pixel's own luminance and
 * pushes its hue toward one colour. This throws the original hue away entirely
 * and re-reads brightness as a position between two chosen ends, so two pixels
 * with the same luminance come out identical however different they started.
 *
 * Midpoint bends the ramp rather than shifting it, so both ends stay pinned and
 * only the crossover moves — pushing it up holds more of the picture in the
 * shadow colour, which is usually what a duotone wants.
 */
export default {
  id: 'duotone',
  label: 'Duotone',
  // With colorize: a recolouring that keeps the image's structure intact.
  stage: 3,
  params: [
    { key: 'shadow', label: 'Shadows', type: 'color', default: '#1b1b3a' },
    { key: 'highlight', label: 'Highlights', type: 'color', default: '#ffd166' },
    { key: 'midpoint', label: 'Midpoint', type: 'range', min: 10, max: 90, step: 1, default: 50, unit: '%', random: [30, 70] },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [60, 100] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const amount = params.amount / 100;
    if (amount <= 0) return image;

    const [sr, sg, sb] = hexToRgb(params.shadow);
    const [hr, hg, hb] = hexToRgb(params.highlight);
    // Midpoint 50 is the straight ramp; above it the curve holds tones down.
    const power = Math.log(0.5) / Math.log(clamp(params.midpoint, 1, 99) / 100);

    // 256 entries is the whole ramp — luminance is all that goes in.
    const ramp = new Float64Array(256 * 3);
    for (let v = 0; v < 256; v++) {
      const t = (v / 255) ** power;
      ramp[v * 3] = sr + (hr - sr) * t;
      ramp[v * 3 + 1] = sg + (hg - sg) * t;
      ramp[v * 3 + 2] = sb + (hb - sb) * t;
    }

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      const tone = Math.round(clamp(luma(data[i], data[i + 1], data[i + 2]), 0, 255));
      for (let c = 0; c < 3; c++) {
        data[i + c] = data[i + c] + (ramp[tone * 3 + c] - data[i + c]) * amount;
      }
    }
    return image;
  },
};
