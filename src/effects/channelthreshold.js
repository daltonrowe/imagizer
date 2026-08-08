/**
 * Thresholds each colour channel independently.
 *
 * Unlike Threshold BW, which collapses everything to luminance and gives two
 * tones, cutting red, green and blue separately yields up to eight flat
 * colours — the primaries and secondaries — with the sliders deciding how much
 * of the image falls on each side of each cut. Posterisation with control over
 * where the colour goes rather than just where the light does.
 */
export default {
  id: 'channelthreshold',
  label: 'Channel Threshold',
  stage: 5,
  params: [
    { key: 'red', label: 'Red', type: 'range', min: 0, max: 255, step: 1, default: 128, random: [60, 200] },
    { key: 'green', label: 'Green', type: 'range', min: 0, max: 255, step: 1, default: 128, random: [60, 200] },
    { key: 'blue', label: 'Blue', type: 'range', min: 0, max: 255, step: 1, default: 128, random: [60, 200] },
    { key: 'invert', label: 'Invert', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data } = image;
    const levels = [params.red, params.green, params.blue];
    const { invert } = params;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        // `!==` against invert flips the whole comparison without branching
        // twice; a channel at exactly its level counts as on.
        data[i + c] = (data[i + c] >= levels[c]) !== invert ? 255 : 0;
      }
    }
    return image;
  },
};
