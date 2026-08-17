import { MODES, composite } from './blendmodes.js';
import { samplePixel } from './sampling.js';

/**
 * Stacks scaled copies of the image on top of itself — the droste effect, the
 * recursive picture-within-a-picture.
 *
 * Every copy is a scaling of the image as it arrived, not of the copy before
 * it, so the sizes are `factor`, `factor²`, `factor³` and so on. Compounding
 * from the original rather than from the running result is what keeps the
 * copies clean: chaining each one off the last would resample an already
 * resampled image and the innermost would be mush.
 *
 * Under 100% each copy is smaller than the last and they nest inward, which is
 * the picture-in-a-picture. Over 100% they grow outward and each one covers
 * more of the frame than the last, which reads as an explosion out of the
 * origin. At exactly 100% every copy lands on the original, which is a no-op in
 * Normal but not in a mode that accumulates — eight multiplies is a very
 * different image from one.
 *
 * Copies are laid down largest-first, so the last iteration ends up on top.
 * That is what makes a shrinking stack read as depth rather than as the
 * smallest copy being buried under the rest.
 */

const ORIGINS = [
  { value: 'center', label: 'Centre', x: 0.5, y: 0.5 },
  { value: 'top', label: 'Top', x: 0.5, y: 0 },
  { value: 'bottom', label: 'Bottom', x: 0.5, y: 1 },
  { value: 'left', label: 'Left', x: 0, y: 0.5 },
  { value: 'right', label: 'Right', x: 1, y: 0.5 },
  { value: 'topleft', label: 'Top left', x: 0, y: 0 },
  { value: 'topright', label: 'Top right', x: 1, y: 0 },
  { value: 'bottomleft', label: 'Bottom left', x: 0, y: 1 },
  { value: 'bottomright', label: 'Bottom right', x: 1, y: 1 },
];

export default {
  id: 'scalerepeat',
  label: 'Scale Repeat',
  // With the other things that move pixels around: the copies want real tones,
  // and a threshold or a dither after this treats the whole stack as one image.
  stage: 4,
  params: [
    { key: 'iterations', label: 'Iterations', type: 'range', min: 1, max: 12, step: 1, default: 4, random: [2, 8] },
    { key: 'scale', label: 'Scale', type: 'range', min: 20, max: 200, step: 1, default: 70, unit: '%', random: [45, 92] },
    { key: 'mode', label: 'Blend mode', type: 'select', default: 'normal', options: MODES },
    { key: 'origin', label: 'Origin', type: 'select', default: 'center', options: ORIGINS },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [50, 100] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const iterations = Math.round(params.iterations);
    const factor = params.scale / 100;
    if (params.opacity <= 0 || iterations < 1 || width < 2 || height < 2) return image;

    const anchor = ORIGINS.find((o) => o.value === params.origin) ?? ORIGINS[0];
    const ox = anchor.x * (width - 1);
    const oy = anchor.y * (height - 1);

    // The image as it arrived: every copy scales this, never the running result.
    const src = Uint8ClampedArray.from(data);
    // One layer buffer, reused — a copy per iteration would be n times the crop.
    const layer = { data: new Uint8ClampedArray(data.length), width, height };

    let scale = factor;
    for (let step = 0; step < iterations; step++, scale *= factor) {
      // Anything this small has nothing left to show.
      if (!(scale > 1e-4)) break;
      layer.data.fill(0);

      // Where the copy lands, so a shrunken one does not cost a pass over the
      // whole frame to find out most of it is empty.
      const x0 = Math.max(0, Math.floor(ox - ox * scale));
      const x1 = Math.min(width - 1, Math.ceil(ox + (width - 1 - ox) * scale));
      const y0 = Math.max(0, Math.floor(oy - oy * scale));
      const y1 = Math.min(height - 1, Math.ceil(oy + (height - 1 - oy) * scale));

      for (let y = y0; y <= y1; y++) {
        const sy = oy + (y - oy) / scale;
        if (sy < 0 || sy > height - 1) continue;
        for (let x = x0; x <= x1; x++) {
          const sx = ox + (x - ox) / scale;
          if (sx < 0 || sx > width - 1) continue;
          samplePixel(src, width, height, sx, sy, layer.data, (y * width + x) * 4);
        }
      }

      composite(image, layer, { mode: params.mode, opacity: params.opacity });
    }
    return image;
  },
};
