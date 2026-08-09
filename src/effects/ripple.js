import { EDGE_PARAMS, edgeFill, writeFill } from './edges.js';
import { samplePixel } from './sampling.js';

/**
 * Sinusoidal displacement — water, heat, glass.
 *
 * Rings send the waves out from the centre, which is a stone in a pond. Rows
 * and columns displace along one axis with the wave running across the other,
 * which is the flag or the CRT tearing. The distinction is only in what feeds
 * the sine: distance from the centre, or one coordinate.
 *
 * Wavelength and amplitude are both shares of the shorter side, so a look holds
 * at any crop size. Phase moves the waves without changing them, which is what
 * makes the same seed and settings produce a different frame rather than a
 * different effect.
 */

const MODES = [
  { value: 'rings', label: 'Rings' },
  { value: 'rows', label: 'Rows' },
  { value: 'columns', label: 'Columns' },
];

export default {
  id: 'ripple',
  label: 'Ripple',
  stage: 4,
  params: [
    { key: 'mode', label: 'Pattern', type: 'select', default: 'rings', options: MODES },
    { key: 'wavelength', label: 'Wavelength', type: 'range', min: 1, max: 50, step: 0.5, default: 12, unit: '%', random: [4, 25] },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 25, step: 0.5, default: 3, unit: '%', random: [1, 8] },
    { key: 'phase', label: 'Phase', type: 'range', min: 0, max: 360, step: 5, default: 0, unit: '°', random: [0, 360] },
    ...EDGE_PARAMS,
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const minor = Math.min(width, height);
    const amplitude = (params.amplitude / 100) * minor;
    if (amplitude <= 0 || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const wavelength = Math.max(1, (params.wavelength / 100) * minor);
    const frequency = (2 * Math.PI) / wavelength;
    const phase = (params.phase * Math.PI) / 180;
    const { stretch, fill } = edgeFill(params);

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const rings = params.mode === 'rings';
    const rows = params.mode === 'rows';

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let sx = x;
        let sy = y;

        if (rings) {
          const dx = x - cx;
          const radius = Math.hypot(dx, dy);
          if (radius > 0) {
            // Along the radius, so the rings stay circular however far out.
            const offset = Math.sin(radius * frequency + phase) * amplitude;
            sx = x + (dx / radius) * offset;
            sy = y + (dy / radius) * offset;
          }
        } else if (rows) {
          // Rows slide sideways, and the wave runs down the image.
          sx = x + Math.sin(y * frequency + phase) * amplitude;
        } else {
          sy = y + Math.sin(x * frequency + phase) * amplitude;
        }

        if (!stretch && (sx < 0 || sx > width - 1 || sy < 0 || sy > height - 1)) {
          writeFill(data, i, fill);
          continue;
        }
        samplePixel(src, width, height, sx, sy, data, i);
      }
    }
    return image;
  },
};
