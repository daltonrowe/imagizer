/**
 * Keeps only what an earlier effect changed, and cuts the rest out.
 *
 * Compare the image against how it stood a few stages back and knock out every
 * pixel that came through untouched. What survives is precisely the footprint
 * of the effects in between — the sorted streaks without the photo they came
 * from, the dithered edges without the flat areas, the slices without the
 * background they slid across.
 *
 * Tolerance is how much change counts as none, and Softness fades the cut
 * instead of making it binary, so a gentle gradient of change comes out as a
 * gradient of opacity rather than a hard-edged blob.
 *
 * Keep unchanged inverts the whole thing, which is the mask rather than the
 * subject: everything the chain left alone, with the changes punched out.
 */
export default {
  id: 'diffkey',
  label: 'Difference Key',
  // Last, with the reblends: it is a comparison against history.
  stage: 7,
  historyDepth: (params) => params.steps,
  params: [
    { key: 'steps', label: 'Steps back', type: 'range', min: 1, max: 8, step: 1, default: 2, random: [1, 4] },
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, default: 12, unit: '%', random: [4, 35] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 10, unit: '%', random: [0, 40] },
    { key: 'invert', label: 'Keep unchanged', type: 'toggle', default: false },
  ],

  apply(image, { params, frameAt }) {
    if (typeof frameAt !== 'function') return image;
    const past = frameAt(params.steps);
    if (!past) return image;

    const { data } = image;
    const old = past.data;
    if (old.length !== data.length) return image;

    const tolerance = (params.tolerance / 100) * 255;
    const feather = Math.max((params.softness / 100) * 255, 1e-4);

    for (let i = 0; i < data.length; i += 4) {
      // The largest change on any channel, alpha included: a pixel that only
      // became transparent has changed as surely as one that changed colour.
      let change = 0;
      for (let c = 0; c < 4; c++) change = Math.max(change, Math.abs(data[i + c] - old[i + c]));

      // 0 below the tolerance, 1 once it is a feather past it.
      const moved = Math.min(1, Math.max(0, (change - tolerance) / feather));
      const keep = params.invert ? 1 - moved : moved;
      data[i + 3] *= keep;
    }
    return image;
  },
};
