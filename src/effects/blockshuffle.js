import { hexToRgb } from './shared.js';

/**
 * Chops the image into a grid of blocks and slides some of them off their spot.
 *
 * The Slicer's cousin: that one moves whole bands, which reads as a scan
 * failure, while this one moves independent rectangles, which reads as a
 * corrupt file. Density decides how many blocks move at all — leaving most of
 * the picture intact is what makes the ones that moved look like damage rather
 * than like a pattern.
 *
 * Which blocks move, and how far, come from `noiseAt` on the block's index, so
 * the same seed damages the preview and the export in the same places rather
 * than rearranging itself on download.
 *
 * A block that moves leaves its old spot empty, exactly as a slice does, and
 * the same choice applies: punch through to transparency or drop in a colour.
 */
export default {
  id: 'blockshuffle',
  label: 'Block Shuffle',
  // With the other displacements.
  stage: 4,
  params: [
    { key: 'block', label: 'Block size', type: 'range', min: 1, max: 40, step: 0.5, default: 8, unit: '%', random: [3, 20] },
    { key: 'shift', label: 'Displacement', type: 'range', min: 0, max: 50, step: 0.5, default: 10, unit: '%', random: [3, 25] },
    { key: 'density', label: 'Density', type: 'range', min: 0, max: 100, step: 1, default: 35, unit: '%', random: [15, 70] },
    { key: 'transparent', label: 'Gaps transparent', type: 'toggle', default: true },
    { key: 'background', label: 'Gap colour', type: 'color', default: '#000000', showWhen: (p) => !p.transparent },
  ],

  apply(image, { params, rng }) {
    const { data, width, height } = image;
    const minor = Math.min(width, height);
    const density = params.density / 100;
    const reach = (params.shift / 100) * minor;
    if (density <= 0 || reach <= 0 || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const block = Math.max(2, Math.round((params.block / 100) * minor));

    const [fillR, fillG, fillB] = hexToRgb(params.background);
    const fillA = params.transparent ? 0 : 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fillR;
      data[i + 1] = fillG;
      data[i + 2] = fillB;
      data[i + 3] = fillA;
    }

    const picked = rng.fork('pick');
    const offsetX = rng.fork('x');
    const offsetY = rng.fork('y');

    const cols = Math.ceil(width / block);
    const rows = Math.ceil(height / block);

    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let dx = 0;
        let dy = 0;
        if (picked.noiseAt(bx, by) < density) {
          dx = Math.round((offsetX.noiseAt(bx, by) * 2 - 1) * reach);
          dy = Math.round((offsetY.noiseAt(bx, by) * 2 - 1) * reach);
        }

        const x0 = bx * block;
        const y0 = by * block;
        const xEnd = Math.min(x0 + block, width);
        const yEnd = Math.min(y0 + block, height);

        for (let y = y0; y < yEnd; y++) {
          const ty = y + dy;
          if (ty < 0 || ty >= height) continue;
          for (let x = x0; x < xEnd; x++) {
            const tx = x + dx;
            if (tx < 0 || tx >= width) continue;
            const from = (y * width + x) * 4;
            const to = (ty * width + tx) * 4;
            data[to] = src[from];
            data[to + 1] = src[from + 1];
            data[to + 2] = src[from + 2];
            data[to + 3] = src[from + 3];
          }
        }
      }
    }
    return image;
  },
};
