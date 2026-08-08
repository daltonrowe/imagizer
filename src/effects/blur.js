import { blurPremultiplied, toPremultiplied } from './boxblur.js';

/**
 * Box blur, run three times to approximate a gaussian.
 *
 * The blur itself lives in boxblur.js, which Bloom also uses; all this does is
 * hand the image over premultiplied and write the result back.
 */
export default {
  id: 'blur',
  label: 'Blur',
  // First: softening the source feeds every other effect well.
  stage: 0,
  params: [
    { key: 'radius', label: 'Radius', type: 'range', min: 0, max: 40, step: 1, default: 6, unit: 'px', random: [2, 14] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const radius = Math.round(params.radius);
    // A single-row or single-column image still blurs along its other axis;
    // blurAxis clamps a length-1 pass into a plain copy.
    if (radius < 1 || width < 1 || height < 1) return image;

    // Each pass is narrower than the requested radius; three of them stack up
    // to roughly the same visual spread as one wide box.
    const blurred = blurPremultiplied(toPremultiplied(image), width, height, radius / 2);

    for (let o = 0; o < data.length; o += 4) {
      const alpha = blurred[o + 3];
      data[o + 3] = alpha;
      if (alpha <= 0) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        continue;
      }
      const scale = 255 / alpha;
      data[o] = blurred[o] * scale;
      data[o + 1] = blurred[o + 1] * scale;
      data[o + 2] = blurred[o + 2] * scale;
    }
    return image;
  },
};
