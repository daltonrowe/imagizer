import { hexToRgb, luma } from './shared.js';

/**
 * Knocks a colour out to transparency — the green screen, without the screen.
 *
 * Matching on hue and saturation separately from brightness is what makes it
 * usable on a photograph: a green wall is one colour to the eye but hundreds to
 * the pixels, all sharing a hue and differing in how much light fell on them.
 * A plain RGB distance would cut the lit parts and leave the shadowed ones, so
 * Brightness is a separate, and by default much looser, tolerance.
 *
 * Softness feathers the cut into partial alpha, which is what stops a keyed
 * subject having a hard jagged outline.
 *
 * Spill removal pulls the leftover cast out of what survives: light bouncing
 * off a green wall tints the edges of everything in front of it, and those
 * pixels are not transparent enough to cut but are the wrong colour to keep.
 */
export default {
  id: 'colorkey',
  label: 'Colour Key',
  // After the colour work, so it keys what is actually on screen, and before
  // the halftones and dithers that would scatter the colour it matches on.
  stage: 4,
  params: [
    { key: 'color', label: 'Key colour', type: 'color', default: '#00b140' },
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, default: 25, unit: '%', random: [10, 45] },
    { key: 'brightness', label: 'Brightness range', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%', random: [30, 90] },
    { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 15, unit: '%', random: [0, 40] },
    { key: 'spill', label: 'Spill removal', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: '%', random: [0, 70] },
    { key: 'invert', label: 'Keep the colour instead', type: 'toggle', default: false },
  ],

  apply(image, { params }) {
    const { data } = image;
    const [kr, kg, kb] = hexToRgb(params.color);
    const keyLuma = luma(kr, kg, kb);

    // Chroma is the colour with its brightness divided out, so the comparison
    // is about hue and saturation rather than exposure.
    const keyScale = keyLuma > 0 ? 1 / keyLuma : 0;
    const kcr = kr * keyScale;
    const kcg = kg * keyScale;
    const kcb = kb * keyScale;

    const tolerance = (params.tolerance / 100) * 1.6;
    const feather = Math.max((params.softness / 100) * 1.6, 1e-4);
    const range = (params.brightness / 100) * 255;
    const spill = params.spill / 100;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;

      const tone = luma(data[i], data[i + 1], data[i + 2]);
      const scale = tone > 0 ? 1 / tone : 0;
      const distance = Math.hypot(
        data[i] * scale - kcr,
        data[i + 1] * scale - kcg,
        data[i + 2] * scale - kcb,
      );

      // Too far off in brightness and it is not the key however close the hue.
      const outOfRange = Math.abs(tone - keyLuma) > range;
      // 1 where it matches, easing to 0 a feather past the tolerance.
      const match = outOfRange ? 0 : 1 - Math.min(1, Math.max(0, (distance - tolerance) / feather));

      const cut = params.invert ? 1 - match : match;
      data[i + 3] *= 1 - cut;

      if (spill > 0 && match > 0 && data[i + 3] > 0) {
        // Pull the matched channel down to what the others say it should be.
        const others = (data[i] + data[i + 1] + data[i + 2] - maxChannel(data, i)) / 2;
        const worst = maxIndex(data, i);
        data[i + worst] += (others - data[i + worst]) * spill * match;
      }
    }
    return image;
  },
};

function maxIndex(data, i) {
  let best = 0;
  for (let c = 1; c < 3; c++) if (data[i + c] > data[i + best]) best = c;
  return best;
}

const maxChannel = (data, i) => data[i + maxIndex(data, i)];
