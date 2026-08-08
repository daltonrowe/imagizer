/**
 * Box blur, run three times to approximate a gaussian — far cheaper than a real
 * gaussian kernel and visually indistinguishable at these radii.
 *
 * Shared by Blur, which softens the image itself, and Bloom, which softens a
 * highlight layer before adding it back.
 *
 * Buffers are RGBA `Float32Array`s with the colour channels premultiplied by
 * alpha. Blurring unpremultiplied colour bleeds the colour of fully transparent
 * pixels (usually black) into the visible edges, which shows up as a dark halo
 * around a cutout.
 */

const PASSES = 3;

/** Read an image into a premultiplied float buffer. */
export function toPremultiplied({ data, width, height }) {
  const buffer = new Float32Array(width * height * 4);
  for (let o = 0; o < buffer.length; o += 4) {
    const alpha = data[o + 3] / 255;
    buffer[o] = data[o] * alpha;
    buffer[o + 1] = data[o + 1] * alpha;
    buffer[o + 2] = data[o + 2] * alpha;
    buffer[o + 3] = data[o + 3];
  }
  return buffer;
}

/**
 * Blur `buffer` in place. `scratch` is reused between passes when supplied,
 * which matters for bloom: it blurs a second layer the same size as the image.
 */
export function blurPremultiplied(buffer, width, height, radius, scratch) {
  const r = Math.max(1, Math.round(radius));
  if (width < 1 || height < 1) return buffer;

  let src = buffer;
  let dst = scratch ?? new Float32Array(buffer.length);

  for (let pass = 0; pass < PASSES; pass++) {
    blurAxis(src, dst, width, height, r, 4, width * 4);   // horizontal
    blurAxis(dst, src, height, width, r, width * 4, 4);   // vertical
  }
  return src;
}

/**
 * One separable box pass with a sliding window, so cost is independent of
 * radius. `step` walks along the axis being blurred and `lineStep` across it,
 * which lets the same code do rows and columns.
 */
export function blurAxis(src, dst, length, lines, radius, step, lineStep) {
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
