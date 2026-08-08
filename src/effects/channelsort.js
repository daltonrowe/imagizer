import { DIRECTION_PARAM, RUN_PARAMS, sortLines } from './sortlines.js';

const CHANNELS = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

const INDEX = { red: 0, green: 1, blue: 2 };

/**
 * Pixel sorting confined to one colour channel.
 *
 * The same walk as Pixel Sort — runs above a threshold, sorted by value — but
 * both the threshold and the sort read only the chosen channel, and only that
 * channel moves. The other two stay exactly where they were, so pixels come
 * apart instead of being reordered: a red sort drags reds along a streak while
 * the greens and blues hold still, and the seam between them shows up as
 * cyan-and-red fringing.
 *
 * Running it three times with a different channel each, and a different max run
 * each, pulls the image into separated colour bands.
 */
export default {
  id: 'channelsort',
  label: 'Channel Sort',
  stage: 4,
  params: [
    { key: 'channel', label: 'Channel', type: 'select', default: 'red', options: CHANNELS },
    DIRECTION_PARAM,
    ...RUN_PARAMS,
  ],

  apply(image, { params, rng }) {
    return sortLines(image, { params, rng, channel: INDEX[params.channel] ?? 0 });
  },
};
