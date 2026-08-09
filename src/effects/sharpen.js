import { blurPremultiplied, toPremultiplied } from './boxblur.js';
import { clamp } from './shared.js';

/**
 * Unsharp mask: the image plus its own difference from a blurred copy.
 *
 * The name is backwards on purpose — the "unsharp" part is the blur, and
 * subtracting it leaves only what the blur destroyed, which is the detail. Add
 * that back on top and edges gain the light and dark piping that reads as
 * sharpness.
 *
 * Threshold is what keeps it from being a noise amplifier: a difference smaller
 * than it is left alone, so flat sky and film grain stay put while real edges
 * still get the treatment. Radius is a share of the shorter side, so the same
 * setting bites the same detail in the preview and the export.
 */
export default {
  id: 'sharpen',
  label: 'Sharpen',
  // With blur, at the front: it is the same operation with the sign flipped,
  // and both belong to the photo rather than to the stack on top of it.
  stage: 0,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 300, step: 5, default: 100, unit: '%', random: [50, 200] },
    { key: 'radius', label: 'Radius', type: 'range', min: 0.1, max: 10, step: 0.1, default: 0.5, unit: '%', random: [0.2, 2] },
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 60, step: 1, default: 4, random: [0, 20] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const amount = params.amount / 100;
    if (amount <= 0 || width < 2 || height < 2) return image;

    const radius = ((params.radius / 100) * Math.min(width, height)) / 2;
    if (radius < 0.5) return image;

    const blurred = blurPremultiplied(toPremultiplied(image), width, height, radius);

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha <= 0) continue;

      for (let c = 0; c < 3; c++) {
        // The blurred layer is premultiplied; divide back out to compare like
        // with like, or every semi-transparent pixel reads as a huge edge.
        const soft = blurred[i + 3] > 0 ? (blurred[i + c] * 255) / blurred[i + 3] : data[i + c];
        const detail = data[i + c] - soft;
        if (Math.abs(detail) <= params.threshold) continue;
        data[i + c] = clamp(data[i + c] + detail * amount, 0, 255);
      }
    }
    return image;
  },
};
