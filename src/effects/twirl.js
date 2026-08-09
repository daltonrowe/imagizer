import { samplePixel } from './sampling.js';

/**
 * Rotates the image about its centre by an angle that falls off with distance,
 * so the middle spins and the rim stays put.
 *
 * A rotation preserves radius, which is why this one needs no edge handling at
 * all: every pixel it reads sits at the same distance from the centre as the
 * pixel it writes, and outside the radius the angle is zero, so nothing moves.
 * That makes it the one geometric effect that cannot leave a gap.
 *
 * Falloff shapes the transition. At 1 the twist decays straight to the rim and
 * the boundary shows as a crease; higher values ease it out, which is the
 * difference between a whirlpool and a dent.
 */
export default {
  id: 'twirl',
  label: 'Twirl',
  // With the other geometry, before the stack that reads tone.
  stage: 4,
  params: [
    { key: 'angle', label: 'Angle', type: 'range', min: -720, max: 720, step: 5, default: 180, unit: '°', random: [-360, 360] },
    { key: 'radius', label: 'Radius', type: 'range', min: 5, max: 150, step: 1, default: 70, unit: '%', random: [40, 110] },
    { key: 'falloff', label: 'Falloff', type: 'range', min: 1, max: 4, step: 0.1, default: 2, random: [1, 3] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    if (params.angle === 0 || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    // Radius is a share of the half-diagonal, so 100% reaches the corners.
    const reach = (params.radius / 100) * Math.hypot(cx, cy);
    if (reach <= 0) return image;

    const turn = (params.angle * Math.PI) / 180;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const i = (y * width + x) * 4;

        const radius = Math.hypot(dx, dy);
        if (radius >= reach) continue;

        const strength = (1 - radius / reach) ** params.falloff;
        const theta = -turn * strength;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        samplePixel(src, width, height, cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, data, i);
      }
    }
    return image;
  },
};
