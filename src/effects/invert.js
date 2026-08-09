/**
 * Negative. Trivial on its own, useful for what it does to everything else.
 *
 * Per-channel toggles are the reason it exists as its own effect rather than a
 * checkbox somewhere: inverting one channel is not a negative at all, it is a
 * hue rotation with the other two left behind, which is where the acid colour
 * comes from. Amount below 100% lands between the two, passing through flat
 * mid grey at 50%.
 */
export default {
  id: 'invert',
  label: 'Invert',
  // With greyscale: a plain recolouring that leaves geometry and tone structure
  // where they were.
  stage: 2,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [40, 100] },
    { key: 'red', label: 'Red', type: 'toggle', default: true },
    { key: 'green', label: 'Green', type: 'toggle', default: true },
    { key: 'blue', label: 'Blue', type: 'toggle', default: true },
  ],

  apply(image, { params }) {
    const { data } = image;
    const amount = params.amount / 100;
    const channels = [params.red, params.green, params.blue];
    if (amount <= 0 || !channels.some(Boolean)) return image;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      for (let c = 0; c < 3; c++) {
        if (!channels[c]) continue;
        const value = data[i + c];
        data[i + c] = value + (255 - 2 * value) * amount;
      }
    }
    return image;
  },
};
