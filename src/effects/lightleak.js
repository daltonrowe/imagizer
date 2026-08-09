import { screenLight } from './glow.js';
import { hexToRgb } from './shared.js';
import { smoothstep } from './falloff.js';

/**
 * Light that got to the film without going through the lens.
 *
 * A leaky back door, a cracked cassette, the last frame on the roll — the
 * exposure is strongest where the light got in and falls away across the frame,
 * and it is warm because it came through the felt or the plastic rather than
 * the glass.
 *
 * It is screened on like every other light in the set, so it brightens without
 * ever going past white, and leaves alpha alone so a cutout is not fogged into
 * the shape of the leak.
 *
 * The seed jitters where the leak sits and how far it reaches, which is what
 * keeps two chains with the same settings from looking stamped.
 */

const ORIGINS = [
  { value: 'left', label: 'Left edge', x: 0, y: 0.5 },
  { value: 'right', label: 'Right edge', x: 1, y: 0.5 },
  { value: 'top', label: 'Top edge', x: 0.5, y: 0 },
  { value: 'bottom', label: 'Bottom edge', x: 0.5, y: 1 },
  { value: 'topleft', label: 'Top left', x: 0, y: 0 },
  { value: 'topright', label: 'Top right', x: 1, y: 0 },
  { value: 'bottomleft', label: 'Bottom left', x: 0, y: 1 },
  { value: 'bottomright', label: 'Bottom right', x: 1, y: 1 },
];

export default {
  id: 'lightleak',
  label: 'Light Leak',
  stage: 3,
  params: [
    { key: 'origin', label: 'From', type: 'select', default: 'topright', options: ORIGINS },
    { key: 'color', label: 'Colour', type: 'color', default: '#ff9e5e' },
    { key: 'size', label: 'Size', type: 'range', min: 10, max: 150, step: 1, default: 55, unit: '%', random: [25, 110] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 70, unit: '%', random: [35, 100] },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 200, step: 5, default: 90, unit: '%', random: [40, 150] },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const intensity = params.intensity / 100;
    if (intensity <= 0 || width < 1 || height < 1) return image;

    const origin = ORIGINS.find((o) => o.value === params.origin) ?? ORIGINS[0];
    const [r, g, b] = hexToRgb(params.color);

    // A tenth of the frame of wander, so the same settings never stamp twice.
    const wander = rng.fork('place');
    const ox = (origin.x + (wander.noiseAt(1, 0) - 0.5) * 0.2) * (width - 1);
    const oy = (origin.y + (wander.noiseAt(0, 1) - 0.5) * 0.2) * (height - 1);

    const spread = Math.hypot(width, height);
    const reach = (params.size / 100) * spread * (0.85 + wander.noiseAt(2, 2) * 0.3);
    const inner = reach * (1 - params.softness / 100);

    const light = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
      const dy = y - oy;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // 1 at the source, easing to nothing at the edge of its reach.
        const fade = 1 - smoothstep(inner, reach, Math.hypot(x - ox, dy));
        if (fade <= 0) continue;
        light[i] = r * fade;
        light[i + 1] = g * fade;
        light[i + 2] = b * fade;
      }
    }
    return screenLight(image, light, intensity);
  },
};
