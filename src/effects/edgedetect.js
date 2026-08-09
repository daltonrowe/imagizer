import { clamp, luma } from './shared.js';

/**
 * Sobel edges: how fast the brightness is changing, drawn as an image.
 *
 * Two 3×3 kernels measure the horizontal and vertical gradient, and the length
 * of that pair is the edge strength however the edge is oriented. The kernels
 * weight the middle row and column double, which is a small blur across the
 * edge — the reason Sobel is usable on a photograph while a bare difference of
 * neighbours mostly finds noise.
 *
 * Output is a greyscale edge map, deliberately. Colouring it here would need
 * ink and paper controls that Duotone, Colorize and the reblends already do
 * better, and leaving it grey makes those work: edge detect, then Duotone for
 * ink on paper, or Reblend Original to lay the lines back over the photo.
 *
 * Alpha is carried through, so the edges of a cutout stay cut out.
 */
export default {
  id: 'edgedetect',
  label: 'Edge Detect',
  // With the other tone reductions: it wants finished tones to differentiate,
  // and everything after it is working on line art rather than a photo.
  stage: 5,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 10, max: 400, step: 5, default: 150, unit: '%', random: [80, 300] },
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 8, random: [0, 30] },
    { key: 'invert', label: 'Dark lines on white', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    if (width < 3 || height < 3) return image;

    // One luminance pass first: the kernels read nine neighbours each, and
    // recomputing luma per tap is nine times the work for the same numbers.
    const tone = new Float32Array(width * height);
    for (let p = 0; p < tone.length; p++) {
      const i = p * 4;
      tone[p] = luma(data[i], data[i + 1], data[i + 2]);
    }

    const amount = params.amount / 100;
    const src = Uint8ClampedArray.from(data);

    for (let y = 0; y < height; y++) {
      // Clamped at the border, so the frame's own edge is not an edge.
      const up = (y > 0 ? y - 1 : 0) * width;
      const mid = y * width;
      const down = (y < height - 1 ? y + 1 : height - 1) * width;

      for (let x = 0; x < width; x++) {
        const left = x > 0 ? x - 1 : 0;
        const right = x < width - 1 ? x + 1 : width - 1;

        const tl = tone[up + left]; const tm = tone[up + x]; const tr = tone[up + right];
        const ml = tone[mid + left]; const mr = tone[mid + right];
        const bl = tone[down + left]; const bm = tone[down + x]; const br = tone[down + right];

        const gx = tl + 2 * ml + bl - tr - 2 * mr - br;
        const gy = tl + 2 * tm + tr - bl - 2 * bm - br;

        let edge = Math.hypot(gx, gy) / 4;
        if (edge <= params.threshold) edge = 0;
        edge = clamp(edge * amount, 0, 255);
        if (params.invert) edge = 255 - edge;

        const i = (mid + x) * 4;
        data[i] = edge;
        data[i + 1] = edge;
        data[i + 2] = edge;
        data[i + 3] = src[i + 3];
      }
    }
    return image;
  },
};
