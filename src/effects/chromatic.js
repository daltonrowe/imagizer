import { sampleChannel } from './sampling.js';

/**
 * Chromatic aberration: the lens artefact where a cheap element focuses red and
 * blue at slightly different magnifications, so colour fringes appear away from
 * the optical centre.
 *
 * Modelled the way the real thing behaves — the fringe grows with distance from
 * the centre and is zero at the middle of the frame, so it reads as a lens
 * rather than a flat colour offset. For a flat one, see Channel Shift.
 *
 * Amount is the fringe width at the corners as a share of the half-diagonal, so
 * a look holds at any crop size. Edge bias controls how fast it gets there: 1 is
 * a straight scaling of each channel, higher values keep the middle of the frame
 * clean and pile the fringing into the corners.
 */

const FRINGES = [
  // Which channel is magnified and which is shrunk. The third is left alone,
  // which is what keeps the image sharp where the fringes cancel.
  { value: 'red-blue', label: 'Red / Blue', out: 0, in: 2 },
  { value: 'blue-red', label: 'Blue / Red', out: 2, in: 0 },
  { value: 'green-magenta', label: 'Green / Magenta', out: 1, in: -1 },
];

export default {
  id: 'chromatic',
  label: 'Chromatic Aberration',
  // Early, with Blur: it is a lens artefact, so it belongs to the photo rather
  // than to the effects stacked on top of it.
  stage: 0,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 10, step: 0.1, default: 1.5, unit: '%', random: [1, 5] },
    { key: 'bias', label: 'Edge bias', type: 'range', min: 1, max: 3, step: 0.1, default: 2, random: [1, 3] },
    { key: 'fringe', label: 'Fringe', type: 'select', default: 'red-blue', options: FRINGES },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const amount = params.amount / 100;
    if (amount <= 0 || width < 2 || height < 2) return image;

    const src = Uint8ClampedArray.from(data);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const maxRadius = Math.hypot(cx, cy);
    const reach = amount * maxRadius;

    const fringe = FRINGES.find((f) => f.value === params.fringe) ?? FRINGES[0];
    // Magenta is red and blue together, so "green out" means both others in.
    const shift = [0, 0, 0];
    shift[fringe.out] = 1;
    if (fringe.in >= 0) shift[fringe.in] = -1;
    else for (let c = 0; c < 3; c++) if (c !== fringe.out) shift[c] = -1;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const radius = Math.hypot(dx, dy);
        const i = (y * width + x) * 4;
        if (radius <= 0) continue;

        // Distance the fringe travels here, eased toward the corners.
        const distance = reach * (radius / maxRadius) ** params.bias;
        const ux = dx / radius;
        const uy = dy / radius;

        for (let c = 0; c < 3; c++) {
          if (shift[c] === 0) continue;
          // A channel displaced outward is one sampled from further in.
          const d = distance * shift[c];
          data[i + c] = sampleChannel(src, width, height, x - ux * d, y - uy * d, c);
        }
      }
    }
    return image;
  },
};
