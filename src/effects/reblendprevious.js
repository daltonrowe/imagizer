import { BLEND_PARAMS, composite } from './blendmodes.js';

/**
 * Composites an earlier stage of the chain back over the current image.
 *
 * Where Reblend Original always reaches for the image as it entered the chain,
 * this one steps back a chosen number of effects: 1 is the image as it stood
 * before the previous effect ran, 2 is before the two previous, and so on. That
 * makes it a way to soften a single stage — blur, dither, then reblend one step
 * back at 50% and the dither reads as texture over a still-blurred photo —
 * rather than an all-or-nothing return to the photo.
 *
 * Steps count *applied* effects, so disabling one in the middle of the chain
 * shifts what a given count reaches, which matches what the list looks like.
 * A count that runs off the front of the chain lands on the chain input, which
 * is the most useful thing there is to land on and never a crash.
 */
export default {
  id: 'reblendprevious',
  label: 'Reblend Previous',
  // Last, alongside Reblend Original: it lays an earlier image over the result.
  stage: 7,
  // Tells the chain runner how far back to keep intermediate images. Snapshots
  // are the size of the whole crop, so it only keeps what can be reached.
  historyDepth: (params) => params.steps,
  params: [
    { key: 'steps', label: 'Steps back', type: 'range', min: 1, max: 8, step: 1, default: 1, random: [1, 3] },
    ...BLEND_PARAMS,
  ],

  apply(image, { params, frameAt }) {
    // Outside a chain runner there is no history to reach into; leave the image
    // alone rather than inventing something.
    if (typeof frameAt !== 'function') return image;
    return composite(image, frameAt(params.steps), params);
  },
};
