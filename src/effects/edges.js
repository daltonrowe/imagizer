import { hexToRgb } from './shared.js';

/**
 * What the geometric effects put where they have no source to read.
 *
 * Any effect that resamples the image from somewhere else — the lens, the
 * ripple, the warp, the kaleidoscope — can end up asking for a pixel outside
 * the frame. There are only three sensible answers, and they are the same three
 * every time, so they live here as one shared control.
 */
export const EDGE_PARAMS = [
  {
    key: 'edges',
    label: 'Edges',
    type: 'select',
    default: 'transparent',
    options: [
      { value: 'transparent', label: 'Transparent' },
      { value: 'color', label: 'Colour' },
      { value: 'stretch', label: 'Stretch edge' },
    ],
  },
  { key: 'background', label: 'Edge colour', type: 'color', default: '#000000', showWhen: (p) => p.edges === 'color' },
];

/**
 * Resolve the edge params once, outside the pixel loop.
 *
 * `stretch` means the sampler's own clamping does the job, so callers skip the
 * bounds test entirely; otherwise `fill` is the RGBA to write.
 */
export function edgeFill(params) {
  const [r, g, b] = hexToRgb(params.background);
  return {
    stretch: params.edges === 'stretch',
    fill: params.edges === 'color' ? [r, g, b, 255] : [0, 0, 0, 0],
  };
}

/** Write the out-of-frame fill into `data` at `i`. */
export function writeFill(data, i, fill) {
  data[i] = fill[0];
  data[i + 1] = fill[1];
  data[i + 2] = fill[2];
  data[i + 3] = fill[3];
}
