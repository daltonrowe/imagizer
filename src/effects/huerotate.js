/**
 * Rotates every hue by a fixed angle.
 *
 * Uses the same matrix as CSS `filter: hue-rotate()` and the SVG filter spec, so
 * the result matches what browsers and design tools produce for the same angle.
 *
 * It is a linear approximation of a true HSL rotation, not an exact one: it
 * only roughly preserves luminance, and on fully saturated colours the matrix
 * pushes channels below zero where they clip, which shifts brightness for real.
 * Red at 120° lands on (0, 113, 0), a good deal lighter than the red it came
 * from. That is the standard behaving as specified rather than a bug, and
 * matching it is the point — greys still come through untouched.
 */
export default {
  id: 'huerotate',
  label: 'Hue Rotate',
  // Early: a colour adjustment on the real photo, before anything flattens it.
  stage: 1,
  params: [
    { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, default: 90, unit: '°', random: [20, 340] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const radians = (params.angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    // The SVG feColorMatrix hue-rotate coefficients.
    const m = [
      0.213 + cos * 0.787 - sin * 0.213,
      0.715 - cos * 0.715 - sin * 0.715,
      0.072 - cos * 0.072 + sin * 0.928,

      0.213 - cos * 0.213 + sin * 0.143,
      0.715 + cos * 0.285 + sin * 0.140,
      0.072 - cos * 0.072 - sin * 0.283,

      0.213 - cos * 0.213 - sin * 0.787,
      0.715 - cos * 0.715 + sin * 0.715,
      0.072 + cos * 0.928 + sin * 0.072,
    ];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      data[i] = r * m[0] + g * m[1] + b * m[2];
      data[i + 1] = r * m[3] + g * m[4] + b * m[5];
      data[i + 2] = r * m[6] + g * m[7] + b * m[8];
    }
    return image;
  },
};
