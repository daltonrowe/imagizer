import { BLEND_PARAMS, composite } from './blendmodes.js';

/**
 * Composites the original crop back over the processed image.
 *
 * The "original" is the image as it entered the chain, not the previous stage's
 * output — that is the whole point. Threshold the photo to hard black and white,
 * then reblend the original at 40% and you get the graphic shape with the real
 * colour pushed back through it. Reading from the previous stage instead would
 * make the effect a no-op.
 *
 * For an earlier stage rather than the very first, see Reblend Previous.
 *
 * Order decides which of the two ends up on top, and the blend mode always
 * applies to whichever that is. Underneath is the more useful half than it
 * sounds: the photo behind a thresholded image shows through wherever the
 * threshold left transparency, and multiplying it under a dither darkens the
 * dither's white cells with the original tone instead of the other way round.
 */
export default {
  id: 'reblend',
  label: 'Reblend Original',
  // Last: it exists to bring the photo back over whatever came before.
  stage: 7,
  // Asks the chain runner to keep a copy of the image as it came in.
  needsSource: true,
  params: BLEND_PARAMS,

  apply(image, { params, source }) {
    // Without the original there is nothing to blend; leave the image alone
    // rather than inventing something.
    return composite(image, source, params);
  },
};
