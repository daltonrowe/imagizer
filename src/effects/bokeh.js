import { highlightWeight, screenLight } from './glow.js';
import { smoothstep } from './falloff.js';
import { luma } from './shared.js';

/**
 * Bokeh: the discs an out-of-focus lens turns bright points into.
 *
 * A true defocus is a disc-shaped convolution over the whole image, which costs
 * the disc's area per pixel and is far too slow for a live preview. What people
 * actually recognise as bokeh is the highlights, so this samples the image on a
 * jittered grid and splats a disc wherever a sample is bright enough — the same
 * picture at a fraction of the cost, and it stacks over a Blur if the soft
 * background is wanted too.
 *
 * The grid is laid out in cells across the image rather than in pixels, so a
 * cell has the same index in the preview as in the export. Each cell's jitter
 * comes from `noiseAt` on that index, which means the discs land in the same
 * places at both sizes instead of rearranging themselves on download.
 *
 * Shape is the aperture: a circle for a wide-open lens, a hexagon for one
 * stopped down onto its blades, a ring for the doughnuts a mirror lens makes.
 */

const SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'ring', label: 'Ring' },
];

const ROOT3 = Math.sqrt(3);

export default {
  id: 'bokeh',
  label: 'Bokeh',
  // With bloom: it spreads real highlights, so it wants tones that still have
  // a range to them.
  stage: 3,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 72, unit: '%', random: [55, 88] },
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 25, step: 0.5, default: 7, unit: '%', random: [3, 12] },
    { key: 'density', label: 'Density', type: 'range', min: 0, max: 100, step: 1, default: 55, unit: '%', random: [25, 85] },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 200, step: 5, default: 100, unit: '%', random: [50, 160] },
    { key: 'shape', label: 'Aperture', type: 'select', default: 'circle', options: SHAPES },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const intensity = params.intensity / 100;
    if (intensity <= 0 || width < 2 || height < 2) return image;

    const minor = Math.min(width, height);
    const radius = ((params.size / 100) * minor) / 2;
    if (radius < 0.5) return image;

    // Cell size as a share of the shorter side: sparse cells at low density are
    // wider than a disc, dense ones overlap heavily.
    const cellShare = (params.size / 100) * (2.2 - 0.02 * params.density);
    const cellsMinor = Math.max(1, Math.round(1 / cellShare));
    const cellsX = Math.max(1, Math.round((cellsMinor * width) / minor));
    const cellsY = Math.max(1, Math.round((cellsMinor * height) / minor));

    const threshold = (params.threshold / 100) * 255;
    const light = new Float32Array(data.length);

    // Named streams so jitter, placement and size stay independent of each
    // other and of every other effect in the chain.
    const placeX = rng.fork('x');
    const placeY = rng.fork('y');
    const vary = rng.fork('size');

    const stepX = width / cellsX;
    const stepY = height / cellsY;

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const px = Math.round((cx + placeX.noiseAt(cx, cy)) * stepX);
        const py = Math.round((cy + placeY.noiseAt(cx, cy)) * stepY);
        if (px >= width || py >= height) continue;

        const i = (py * width + px) * 4;
        const alpha = data[i + 3] / 255;
        if (alpha <= 0) continue;

        const weight = highlightWeight(luma(data[i], data[i + 1], data[i + 2]), threshold);
        if (weight <= 0) continue;

        // Discs vary in size the way real ones do with distance from focus.
        const size = radius * (0.65 + 0.7 * vary.noiseAt(cx, cy));
        splat(light, width, height, px, py, size, params.shape, [
          data[i] * weight * alpha,
          data[i + 1] * weight * alpha,
          data[i + 2] * weight * alpha,
        ]);
      }
    }

    return screenLight(image, light, intensity);
  },
};

/** Add one aperture-shaped disc of light centred on (px, py). */
function splat(light, width, height, px, py, radius, shape, [r, g, b]) {
  const reach = Math.ceil(radius);
  const x0 = Math.max(0, px - reach);
  const x1 = Math.min(width - 1, px + reach);
  const y0 = Math.max(0, py - reach);
  const y1 = Math.min(height - 1, py + reach);

  for (let y = y0; y <= y1; y++) {
    const dy = y - py;
    for (let x = x0; x <= x1; x++) {
      const dx = x - px;

      // Distance to the aperture's edge, as a fraction of the radius.
      let d;
      if (shape === 'hexagon') {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        d = Math.max(ay, (ax * ROOT3 + ay) / 2) / radius;
      } else {
        d = Math.hypot(dx, dy) / radius;
      }
      if (d >= 1) continue;

      // A real disc has a hard rim, not a gaussian falloff — just enough
      // feather to keep the edge from stairstepping.
      let coverage = 1 - smoothstep(0.85, 1, d);
      if (shape === 'ring') coverage *= smoothstep(0.35, 0.8, d);
      if (coverage <= 0) continue;

      const o = (y * width + x) * 4;
      light[o] += r * coverage;
      light[o + 1] += g * coverage;
      light[o + 2] += b * coverage;
    }
  }
}
