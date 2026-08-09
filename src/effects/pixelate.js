/**
 * Mosaic: the image reduced to flat blocks.
 *
 * Average takes the mean of each block, which is the classic censor-bar look
 * and stays smooth as the cell grows. Nearest takes the block's centre pixel
 * instead, which keeps colours the photo actually contained — sharper and more
 * poster-like, and the better input for a threshold or a palette afterwards,
 * since averaging invents in-between tones that then get quantised anyway.
 *
 * Averaging is alpha-weighted. Without that, a block straddling the edge of a
 * cutout mixes in transparent black and the mosaic grows a dark border.
 */
export default {
  id: 'pixelate',
  label: 'Pixelate',
  // With posterize: both throw detail away, and both want the geometry settled.
  stage: 5,
  params: [
    { key: 'cell', label: 'Cell size', type: 'range', min: 0.5, max: 25, step: 0.5, default: 4, unit: '%', random: [1, 10] },
    {
      key: 'mode',
      label: 'Sampling',
      type: 'select',
      default: 'average',
      options: [
        { value: 'average', label: 'Average' },
        { value: 'nearest', label: 'Nearest' },
      ],
    },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const cell = Math.max(2, Math.round((Math.min(width, height) * params.cell) / 100));
    if (cell < 2 || width < 1 || height < 1) return image;

    const src = Uint8ClampedArray.from(data);
    const nearest = params.mode === 'nearest';

    for (let by = 0; by < height; by += cell) {
      const yEnd = Math.min(by + cell, height);
      for (let bx = 0; bx < width; bx += cell) {
        const xEnd = Math.min(bx + cell, width);

        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;

        if (nearest) {
          const cx = Math.min(width - 1, bx + ((xEnd - bx) >> 1));
          const cy = Math.min(height - 1, by + ((yEnd - by) >> 1));
          const o = (cy * width + cx) * 4;
          r = src[o]; g = src[o + 1]; b = src[o + 2]; a = src[o + 3];
        } else {
          let weight = 0;
          for (let y = by; y < yEnd; y++) {
            for (let x = bx; x < xEnd; x++) {
              const o = (y * width + x) * 4;
              const alpha = src[o + 3] / 255;
              r += src[o] * alpha;
              g += src[o + 1] * alpha;
              b += src[o + 2] * alpha;
              a += src[o + 3];
              weight += alpha;
            }
          }
          const count = (xEnd - bx) * (yEnd - by);
          a /= count;
          if (weight > 0) {
            r /= weight; g /= weight; b /= weight;
          } else {
            r = 0; g = 0; b = 0;
          }
        }

        for (let y = by; y < yEnd; y++) {
          for (let x = bx; x < xEnd; x++) {
            const o = (y * width + x) * 4;
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
            data[o + 3] = a;
          }
        }
      }
    }
    return image;
  },
};
