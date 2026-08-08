import { DIRECTION_PARAM, RUN_PARAMS, sortLines } from './sortlines.js';

/**
 * The glitch-art staple: find runs of pixels brighter than a threshold and sort
 * them by luminance, which smears them into clean gradient streaks. Max run caps
 * how far a streak can travel, as a percentage of the line it runs along, so the
 * look holds at any resolution.
 *
 * Whole pixels move, so every colour in the image survives and only its position
 * changes. Channel Sort is the same walk applied to one channel at a time.
 *
 * This is the effect that leans hardest on the seed — which lines get sorted and
 * how the threshold wobbles per line both come from the generator, so the same
 * seed reproduces the same streaks exactly.
 */
export default {
  id: 'pixelsort',
  label: 'Pixel Sort',
  // Middle: wants real tones to sort, but before a threshold flattens them.
  stage: 4,
  params: [DIRECTION_PARAM, ...RUN_PARAMS],

  apply(image, { params, rng }) {
    return sortLines(image, { params, rng, channel: null });
  },
};
