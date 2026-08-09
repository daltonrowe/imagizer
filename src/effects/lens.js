import { EDGE_PARAMS, edgeFill, writeFill } from './edges.js';
import { samplePixel } from './sampling.js';

/**
 * Barrel and pincushion distortion — the way a real lens bends straight lines.
 *
 * The map is the standard radial one: an output pixel at distance r from the
 * centre reads the source at r·(1 + k·r²), with r measured against the
 * half-diagonal so the corners sit at 1 and the same Amount looks the same on
 * any aspect ratio.
 *
 * Positive Amount magnifies the centre relative to the edges, which pulls the
 * corners in and bows straight lines outward — barrel, what a wide-angle lens
 * does. Negative does the reverse: content is pushed outward and lines bow in,
 * which is pincushion.
 *
 * The two directions differ in what they leave behind. Barrel reads from beyond
 * the source at the corners, so the frame ends up with empty corners and Edges
 * decides what goes there; pincushion reads from inside it, pushing the outer
 * ring off-frame and covering everything. Zoom scales the whole map, which is
 * the usual way to crop a barrel's empty corners back out of shot.
 */

export default {
  id: 'lens',
  label: 'Lens Distortion',
  // Early, with the other optics: it moves the photo's geometry, so everything
  // stacked on top should see the shape it will actually end up with.
  stage: 0,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: -60, max: 60, step: 1, default: 25, unit: '%', random: [-45, 45] },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 50, max: 200, step: 1, default: 100, unit: '%', random: [95, 135] },
    ...EDGE_PARAMS,
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const k = params.amount / 100;
    const zoom = params.zoom / 100;
    // An identity map would still round-trip every pixel through the sampler;
    // bailing keeps it exactly untouched rather than nearly so.
    if ((k === 0 && zoom === 1) || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const maxRadius = Math.hypot(cx, cy);

    const { stretch, fill } = edgeFill(params);

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const i = (y * width + x) * 4;

        const r = Math.hypot(dx, dy) / maxRadius;
        const factor = (1 + k * r * r) / zoom;
        const sx = cx + dx * factor;
        const sy = cy + dy * factor;

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
