/**
 * Reflects one half of the image onto the other, making it symmetric.
 *
 * Not a flip. A flip reverses the picture and shows you the same content the
 * other way round; this keeps one half and replaces the other with its
 * reflection, so the result is a new image that is symmetric about the middle.
 * On Both that gives four-fold symmetry — one quadrant reflected into all four
 * corners — which is why "both" is worth having as an option at all, where for
 * a flip it would only ever mean a 180° rotation.
 *
 * Which half survives has to be a choice, since mirroring is otherwise
 * under-specified: the left half reflected rightward and the right half
 * reflected leftward are different pictures of the same photo.
 *
 * The remap is exact — every output pixel is some input pixel, never a blend of
 * two — so nothing softens and a hard-edged graphic stays hard-edged. On an odd
 * width or height the middle row and column map to themselves and come through
 * untouched.
 */

const AXES = [
  { value: 'x', label: 'X (left to right)' },
  { value: 'y', label: 'Y (top to bottom)' },
  { value: 'both', label: 'Both' },
];

export default {
  id: 'mirror',
  label: 'Mirror',
  // With the other things that move pixels around, before anything reads tone.
  stage: 4,
  params: [
    { key: 'axis', label: 'Axis', type: 'select', default: 'x', options: AXES },
    { key: 'flipX', label: 'Keep the right half', type: 'toggle', default: false, showWhen: (p) => p.axis !== 'y' },
    { key: 'flipY', label: 'Keep the bottom half', type: 'toggle', default: false, showWhen: (p) => p.axis !== 'x' },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const mirrorX = params.axis !== 'y';
    const mirrorY = params.axis !== 'x';
    if (width < 2 && height < 2) return image;

    const src = Uint8ClampedArray.from(data);

    for (let y = 0; y < height; y++) {
      // Doubled rather than compared against a half, so an odd size lands the
      // middle row on itself instead of on a pixel either side of it.
      const foldY = mirrorY && (params.flipY ? 2 * y < height - 1 : 2 * y > height - 1);
      const sy = foldY ? height - 1 - y : y;
      const srcRow = sy * width;
      const dstRow = y * width;

      for (let x = 0; x < width; x++) {
        const foldX = mirrorX && (params.flipX ? 2 * x < width - 1 : 2 * x > width - 1);
        const sx = foldX ? width - 1 - x : x;
        if (!foldX && !foldY) continue;

        const from = (srcRow + sx) * 4;
        const to = (dstRow + x) * 4;
        data[to] = src[from];
        data[to + 1] = src[from + 1];
        data[to + 2] = src[from + 2];
        data[to + 3] = src[from + 3];
      }
    }
    return image;
  },
};
