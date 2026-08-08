/**
 * The render pipeline, in the one place that defines its order:
 *
 *     photo -> crop -> effects -> output
 *
 * Crop is step one and effects are step two, always. Effects therefore see the
 * framed region and nothing else — a pixel sort finds run boundaries at the
 * crop edges, a dither diffuses error only within the crop, and a blur samples
 * only pixels the crop includes.
 *
 * The preview and the export both come through here, differing only in the
 * pixel size they render at. Keeping the sequence in a shared function is what
 * stops the two paths from drifting: an effect added to one but not the other,
 * or a crop that quietly starts happening second.
 */

import { runChain } from './effects/index.js';

export function hasActiveEffects(chain) {
  return chain.some((item) => item.enabled !== false);
}

/**
 * Render the cropped, processed image into `ctx` at `width` x `height`.
 *
 * `drawCrop(ctx, width, height, { background })` supplies step one; the cropper
 * owns the framing maths. `background` is for formats without an alpha channel
 * and is filled before the crop is drawn, so effects run on the flattened image
 * rather than seeing transparency the output cannot represent.
 */
export function renderPipeline({
  ctx,
  drawCrop,
  width,
  height,
  background = null,
  chain = [],
  rng,
}) {
  // Step 1 — crop.
  drawCrop(ctx, width, height, { background });

  // Step 2 — effects, over the cropped pixels only.
  if (!hasActiveEffects(chain)) return;
  const image = ctx.getImageData(0, 0, width, height);
  runChain(image, chain, rng);
  ctx.putImageData(image, 0, 0);
}
