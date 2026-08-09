import { EDGE_PARAMS, edgeFill, writeFill } from './edges.js';
import { samplePixel } from './sampling.js';

/**
 * Folds the frame into a wedge and mirrors it around the centre.
 *
 * Every output pixel's angle is folded into one segment of the circle, and that
 * folded position is what gets read. Alternate segments fold in reverse, which
 * is what makes the seams meet as mirrors instead of as hard cuts — an
 * unmirrored version is a pinwheel, not a kaleidoscope.
 *
 * Rotation turns the wedge under the image, so it selects which slice of the
 * photo gets multiplied — usually a bigger difference to the result than the
 * segment count is.
 *
 * The fold preserves radius but not position, so a wedge can point somewhere
 * the rectangle does not reach; that is what the Edges control is for.
 */
export default {
  id: 'kaleidoscope',
  label: 'Kaleidoscope',
  stage: 4,
  params: [
    { key: 'segments', label: 'Segments', type: 'range', min: 2, max: 24, step: 1, default: 6, random: [3, 12] },
    { key: 'rotation', label: 'Rotation', type: 'range', min: 0, max: 360, step: 1, default: 0, unit: '°', random: [0, 360] },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 25, max: 200, step: 1, default: 100, unit: '%', random: [60, 150] },
    { key: 'mirror', label: 'Mirror segments', type: 'toggle', default: true },
    ...EDGE_PARAMS,
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    if (width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const { stretch, fill } = edgeFill(params);

    const segments = Math.max(2, Math.round(params.segments));
    const wedge = (2 * Math.PI) / segments;
    const rotation = (params.rotation * Math.PI) / 180;
    const zoom = params.zoom / 100;
    const mirror = params.mirror;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const i = (y * width + x) * 4;

        const radius = Math.hypot(dx, dy) / zoom;
        let angle = Math.atan2(dy, dx) - rotation;

        // Into the wedge. Reflecting the second half of each one is what turns
        // the joins into mirrors.
        angle -= Math.floor(angle / wedge) * wedge;
        if (mirror && angle > wedge / 2) angle = wedge - angle;
        angle += rotation;

        const sx = cx + Math.cos(angle) * radius;
        const sy = cy + Math.sin(angle) * radius;

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
