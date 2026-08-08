/**
 * Slides one channel across the image, leaving the others where they are.
 *
 * Where Chromatic Aberration models a lens — fringes that grow from the centre
 * outward — this is a flat displacement of the whole channel, which is the
 * printing-misregistration look: hard edges doubled in cyan and red.
 *
 * Offsets are percentages of the width and height, so a look holds whatever
 * size the crop is rendered at. Wrapping brings the channel back around the
 * opposite edge; without it the vacated strip takes the edge value, which keeps
 * the border reading as a colour rather than a black or blown-out band.
 *
 * Alpha is shiftable too, and does something quite different: it moves the
 * cutout itself, so the subject's colour spills past its own silhouette.
 */
export default {
  id: 'channelshift',
  label: 'Channel Shift',
  // With the other displacements: it moves pixels around rather than recolouring
  // them, and wants real tones to move.
  stage: 4,
  params: [
    {
      key: 'channel',
      label: 'Channel',
      type: 'select',
      default: 'red',
      options: [
        { value: 'red', label: 'Red' },
        { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' },
        { value: 'alpha', label: 'Alpha' },
      ],
    },
    { key: 'x', label: 'Shift X', type: 'range', min: -50, max: 50, step: 0.5, default: 2, unit: '%', random: [-12, 12] },
    { key: 'y', label: 'Shift Y', type: 'range', min: -50, max: 50, step: 0.5, default: 0, unit: '%', random: [-12, 12] },
    { key: 'wrap', label: 'Wrap around', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const channel = { red: 0, green: 1, blue: 2, alpha: 3 }[params.channel] ?? 0;

    const dx = Math.round((width * params.x) / 100);
    const dy = Math.round((height * params.y) / 100);
    if ((dx === 0 && dy === 0) || width < 1 || height < 1) return image;

    const src = Uint8ClampedArray.from(data);

    for (let y = 0; y < height; y++) {
      // The channel moves by +d, so each output row reads from d back.
      const sy = params.wrap
        ? (((y - dy) % height) + height) % height
        : Math.min(height - 1, Math.max(0, y - dy));
      const srcRow = sy * width;
      const dstRow = y * width;

      for (let x = 0; x < width; x++) {
        const sx = params.wrap
          ? (((x - dx) % width) + width) % width
          : Math.min(width - 1, Math.max(0, x - dx));
        data[(dstRow + x) * 4 + channel] = src[(srcRow + sx) * 4 + channel];
      }
    }
    return image;
  },
};
