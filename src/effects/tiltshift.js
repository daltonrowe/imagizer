import { blurPremultiplied, toPremultiplied } from './boxblur.js';
import { smoothstep } from './falloff.js';

/**
 * A band of sharpness across the frame, blurred either side of it.
 *
 * The trick it imitates is a tilted lens, which puts the plane of focus at an
 * angle to the sensor instead of parallel to it. The reason the result reads as
 * a model railway is that a real photograph only has depth of field this
 * shallow when the subject is a few centimetres away, so the brain concludes
 * the buildings must be tiny.
 *
 * The blur is done once over the whole image and then mixed back in by the
 * mask, rather than blurring each pixel by its own radius. That costs one blur
 * instead of one per band and is what the effect actually looks like — a lens
 * has one out-of-focus radius, not a gradient of them.
 */
export default {
  id: 'tiltshift',
  label: 'Tilt Shift',
  // With blur, whose job it is doing selectively.
  stage: 0,
  params: [
    { key: 'position', label: 'Position', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [30, 70] },
    { key: 'width', label: 'Band width', type: 'range', min: 1, max: 80, step: 1, default: 25, unit: '%', random: [10, 45] },
    { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 180, step: 1, default: 0, unit: '°', random: [0, 180] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 50, unit: '%', random: [20, 90] },
    { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 20, step: 0.5, default: 3, unit: '%', random: [1, 8] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const radius = ((params.blur / 100) * Math.min(width, height)) / 2;
    if (radius < 0.5 || width < 2 || height < 2) return image;

    const blurred = blurPremultiplied(toPremultiplied(image), width, height, radius);

    const radians = (params.angle * Math.PI) / 180;
    // The band runs along `angle`, so distance is measured across it.
    const nx = -Math.sin(radians);
    const ny = Math.cos(radians);

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const span = Math.abs(nx) * width + Math.abs(ny) * height;
    const centre = (params.position / 100 - 0.5) * span;
    const half = (params.width / 100) * span * 0.5;
    const feather = Math.max((params.softness / 100) * span * 0.5, 1e-4);

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const distance = Math.abs((x - cx) * nx + dy * ny - centre);
        const mix = smoothstep(half, half + feather, distance);
        if (mix <= 0) continue;

        const alpha = blurred[i + 3];
        const scale = alpha > 0 ? 255 / alpha : 0;
        data[i] += (blurred[i] * scale - data[i]) * mix;
        data[i + 1] += (blurred[i + 1] * scale - data[i + 1]) * mix;
        data[i + 2] += (blurred[i + 2] * scale - data[i + 2]) * mix;
        data[i + 3] += (alpha - data[i + 3]) * mix;
      }
    }
    return image;
  },
};
