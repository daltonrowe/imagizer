import { blurPremultiplied } from './boxblur.js';
import { highlightWeight, screenLight } from './glow.js';
import { luma } from './shared.js';

/**
 * Bloom: the halo a bright source spills into everything around it.
 *
 * Highlights above the threshold are copied into a separate layer, blurred, and
 * screened back on. Doing it on a layer rather than in place is what makes it
 * bloom instead of blur — the sharp image survives underneath, and only the
 * light around it is soft.
 *
 * Radius is a share of the shorter side rather than a pixel count, so the halo
 * covers the same part of the picture in the preview as in the full-size export.
 *
 * The layer is blurred premultiplied, so a highlight at the edge of a cutout
 * spreads its own colour rather than dragging in the transparent black beyond.
 */
export default {
  id: 'bloom',
  label: 'Bloom',
  // With colorize: it works on real tones, before anything quantises them, but
  // after the geometry has settled.
  stage: 3,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 65, unit: '%', random: [45, 85] },
    { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 30, step: 0.5, default: 6, unit: '%', random: [3, 14] },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 300, step: 5, default: 140, unit: '%', random: [60, 220] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const intensity = params.intensity / 100;
    if (intensity <= 0 || width < 1 || height < 1) return image;

    const radius = ((params.radius / 100) * Math.min(width, height)) / 2;
    if (radius < 0.5) return image;

    const threshold = (params.threshold / 100) * 255;
    const light = new Float32Array(data.length);

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha <= 0) continue;
      const weight = highlightWeight(luma(data[i], data[i + 1], data[i + 2]), threshold);
      if (weight <= 0) continue;
      // Premultiplied, and scaled by how far past the threshold the tone is.
      const scale = weight * alpha;
      light[i] = data[i] * scale;
      light[i + 1] = data[i + 1] * scale;
      light[i + 2] = data[i + 2] * scale;
      light[i + 3] = 255 * scale;
    }

    blurPremultiplied(light, width, height, radius);
    return screenLight(image, light, intensity);
  },
};
