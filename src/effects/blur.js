/**
 * Box blur, run three times to approximate a gaussian — far cheaper than a real
 * gaussian kernel and visually indistinguishable at these radii.
 *
 * Colours are premultiplied by alpha before blurring and unpremultiplied after.
 * Skipping that step bleeds the colour of fully transparent pixels (usually
 * black) into the visible edges, which shows up as a dark halo around a cutout.
 */

const PASSES = 3;

export default {
  id: 'blur',
  label: 'Blur',
  // First: softening the source feeds every other effect well.
  stage: 0,
  params: [
    { key: 'radius', label: 'Radius', type: 'range', min: 0, max: 40, step: 1, default: 6, unit: 'px', random: [2, 14] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const radius = Math.round(params.radius);
    // A single-row or single-column image still blurs along its other axis;
    // blurAxis clamps a length-1 pass into a plain copy.
    if (radius < 1 || width < 1 || height < 1) return image;

    // Each pass is narrower than the requested radius; three of them stack up
    // to roughly the same visual spread as one wide box.
    const r = Math.max(1, Math.round(radius / 2));

    const pixels = width * height;
    let src = new Float32Array(pixels * 4);
    let dst = new Float32Array(pixels * 4);

    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      const alpha = data[o + 3] / 255;
      src[o] = data[o] * alpha;
      src[o + 1] = data[o + 1] * alpha;
      src[o + 2] = data[o + 2] * alpha;
      src[o + 3] = data[o + 3];
    }

    for (let pass = 0; pass < PASSES; pass++) {
      blurAxis(src, dst, width, height, r, 4, width * 4);       // horizontal
      blurAxis(dst, src, height, width, r, width * 4, 4);       // vertical
    }

    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      const alpha = src[o + 3];
      data[o + 3] = alpha;
      if (alpha <= 0) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        continue;
      }
      const scale = 255 / alpha;
      data[o] = src[o] * scale;
      data[o + 1] = src[o + 1] * scale;
      data[o + 2] = src[o + 2] * scale;
    }
    return image;
  },
};

/**
 * One separable box pass with a sliding window, so cost is independent of
 * radius. `step` walks along the axis being blurred and `lineStep` across it,
 * which lets the same code do rows and columns.
 */
function blurAxis(src, dst, length, lines, radius, step, lineStep) {
  const window = radius * 2 + 1;
  const norm = 1 / window;
  const last = length - 1;

  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;

    // Seed the window, clamping at the edges so borders don't darken.
    for (let i = -radius; i <= radius; i++) {
      const o = base + (i < 0 ? 0 : i > last ? last : i) * step;
      s0 += src[o];
      s1 += src[o + 1];
      s2 += src[o + 2];
      s3 += src[o + 3];
    }

    for (let i = 0; i < length; i++) {
      const o = base + i * step;
      dst[o] = s0 * norm;
      dst[o + 1] = s1 * norm;
      dst[o + 2] = s2 * norm;
      dst[o + 3] = s3 * norm;

      const leaving = i - radius;
      const entering = i + radius + 1;
      const a = base + (leaving < 0 ? 0 : leaving > last ? last : leaving) * step;
      const b = base + (entering < 0 ? 0 : entering > last ? last : entering) * step;
      s0 += src[b] - src[a];
      s1 += src[b + 1] - src[a + 1];
      s2 += src[b + 2] - src[a + 2];
      s3 += src[b + 3] - src[a + 3];
    }
  }
}
