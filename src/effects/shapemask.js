import { smoothstep } from './falloff.js';
import { hexToRgb } from './shared.js';

/**
 * Cuts the frame to a shape.
 *
 * The crop is a rectangle and always will be, because an export has pixel
 * dimensions; this is how the *picture* stops being one. With a PNG export the
 * outside is genuinely transparent, so the result drops onto a page as a circle
 * or an arch rather than as a rectangle containing one.
 *
 * Every shape is measured as a signed distance from its edge, which is what
 * lets Softness feather all of them with the same code and gives round corners
 * for free — a rounded rectangle is just a rectangle whose distance is taken
 * from an inset outline.
 *
 * Inset is a share of the shorter side, so the margin is even on all four
 * sides rather than following the aspect ratio.
 */

const SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'arch', label: 'Arch' },
];

export default {
  id: 'shapemask',
  label: 'Shape Mask',
  // Late: it frames the finished picture, so whatever the chain did happens
  // inside the shape rather than being cut by it halfway through.
  stage: 6,
  params: [
    { key: 'shape', label: 'Shape', type: 'select', default: 'circle', options: SHAPES },
    { key: 'inset', label: 'Inset', type: 'range', min: 0, max: 40, step: 0.5, default: 0, unit: '%', random: [0, 15] },
    { key: 'corner', label: 'Corner radius', type: 'range', min: 0, max: 50, step: 1, default: 15, unit: '%', random: [5, 45], showWhen: (p) => p.shape === 'rounded' },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 25, step: 0.5, default: 0.5, unit: '%', random: [0, 8] },
    { key: 'transparent', label: 'Outside transparent', type: 'toggle', default: true },
    { key: 'background', label: 'Outside colour', type: 'color', default: '#000000', showWhen: (p) => !p.transparent },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    if (width < 1 || height < 1) return image;

    const minor = Math.min(width, height);
    const inset = (params.inset / 100) * minor;
    const feather = Math.max((params.softness / 100) * minor, 1e-4);

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const halfW = Math.max(width / 2 - inset, 0.5);
    const halfH = Math.max(height / 2 - inset, 0.5);
    const radius = Math.max(Math.min(halfW, halfH), 0.5);
    const corner = Math.min((params.corner / 100) * minor, halfW, halfH);

    const [fillR, fillG, fillB] = hexToRgb(params.background);
    const fillA = params.transparent ? 0 : 255;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const i = (y * width + x) * 4;

        // Positive outside the shape, negative in, zero on the edge.
        let distance;
        switch (params.shape) {
          case 'rounded': {
            const qx = Math.abs(dx) - (halfW - corner);
            const qy = Math.abs(dy) - (halfH - corner);
            distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
              + Math.min(Math.max(qx, qy), 0) - corner;
            break;
          }
          case 'diamond':
            distance = (Math.abs(dx) / halfW + Math.abs(dy) / halfH - 1) * radius;
            break;
          case 'arch': {
            // A rectangle below the springing line, a semicircle above it.
            const spring = -halfH + halfW;
            distance = dy > spring
              ? Math.max(Math.abs(dx) - halfW, dy - halfH)
              : Math.hypot(dx, dy - spring) - halfW;
            break;
          }
          default:
            distance = Math.hypot(dx, dy) - radius;
        }

        const outside = smoothstep(-feather / 2, feather / 2, distance);
        if (outside <= 0) continue;

        if (fillA === 0) {
          data[i + 3] *= 1 - outside;
          continue;
        }
        data[i] += (fillR - data[i]) * outside;
        data[i + 1] += (fillG - data[i + 1]) * outside;
        data[i + 2] += (fillB - data[i + 2]) * outside;
        data[i + 3] += (255 - data[i + 3]) * outside;
      }
    }
    return image;
  },
};
