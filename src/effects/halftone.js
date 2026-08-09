import { clamp, hexToRgb, luma } from './shared.js';
import { smoothstep } from './falloff.js';

/**
 * Halftone: tone carried by the size of a dot rather than by the density of
 * scattered pixels.
 *
 * That is the whole difference from the three dithers. A dither picks between a
 * few fixed tones and varies how often; a halftone screen has one ink and
 * varies how much of each cell it covers. Newspapers used the second because a
 * press can only put ink down or not, and it is why halftones stay readable
 * when a dither turns to mush.
 *
 * CMYK runs four screens at the classic angles — 15°, 75°, 0° and 45° — which
 * are chosen to be maximally out of step with each other. Line them up and the
 * dots interfere into the coarse blotches printers call a moiré rosette gone
 * wrong; hold them apart and the eye reads colour instead of pattern.
 *
 * Each pixel resolves its own cell analytically rather than the screen being
 * drawn dot by dot, so cost does not grow with dot size.
 */

// Angle per plate, in degrees. Black takes 45° because that is where the eye is
// least able to see a grid, and black carries most of the detail.
const PLATES = [
  { channel: 0, angle: 15 },  // cyan
  { channel: 1, angle: 75 },  // magenta
  { channel: 2, angle: 0 },   // yellow
  { channel: 3, angle: 45 },  // black
];

export default {
  id: 'halftone',
  label: 'Halftone',
  // Late: it is the printing step, and it wants a finished picture to screen.
  stage: 6,
  params: [
    {
      key: 'mode',
      label: 'Screen',
      type: 'select',
      default: 'mono',
      options: [
        { value: 'mono', label: 'Single ink' },
        { value: 'cmyk', label: 'CMYK' },
      ],
    },
    { key: 'dot', label: 'Dot size', type: 'range', min: 0.4, max: 12, step: 0.2, default: 2, unit: '%', random: [0.8, 5] },
    { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 90, step: 1, default: 45, unit: '°', random: [0, 90] },
    { key: 'ink', label: 'Ink', type: 'color', default: '#000000', showWhen: (p) => p.mode === 'mono' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#ffffff' },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const cell = Math.max(2, (params.dot / 100) * Math.min(width, height));
    const src = Uint8ClampedArray.from(data);

    const [paperR, paperG, paperB] = hexToRgb(params.paper);
    const [inkR, inkG, inkB] = hexToRgb(params.ink);
    const cmyk = params.mode === 'cmyk';

    const screens = (cmyk ? PLATES : [{ channel: -1, angle: params.angle }]).map((plate) => {
      const radians = (plate.angle * Math.PI) / 180;
      return { channel: plate.channel, cos: Math.cos(radians), sin: Math.sin(radians) };
    });

    // Ink laid down by each plate at the pixel's own position, 0..1.
    const inks = new Float64Array(screens.length);
    // Reused per pixel: cyan, magenta, yellow, black.
    const separation = new Float64Array(4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 0) continue;

        for (let s = 0; s < screens.length; s++) {
          const { channel, cos, sin } = screens[s];

          // Into screen space, to the centre of the cell this pixel sits in,
          // and back out again to find which pixel that centre reads.
          const u = x * cos + y * sin;
          const v = -x * sin + y * cos;
          const cu = (Math.floor(u / cell) + 0.5) * cell;
          const cv = (Math.floor(v / cell) + 0.5) * cell;
          const sx = clamp(Math.round(cu * cos - cv * sin), 0, width - 1);
          const sy = clamp(Math.round(cu * sin + cv * cos), 0, height - 1);
          const o = (sy * width + sx) * 4;

          let coverage;
          if (channel < 0) {
            coverage = 1 - luma(src[o], src[o + 1], src[o + 2]) / 255;
          } else {
            separate(src[o], src[o + 1], src[o + 2], separation);
            coverage = separation[channel];
          }

          // Area, not radius, carries tone: a dot twice as dark is twice the
          // area, so the radius goes as its square root. 0.72 of the cell is
          // where neighbouring dots just touch at full coverage.
          const radius = Math.sqrt(clamp(coverage, 0, 1)) * cell * 0.72;
          const distance = Math.hypot(u - cu, v - cv);
          // A pixel of feather, so the dots have edges rather than stairs.
          inks[s] = radius <= 0 ? 0 : 1 - smoothstep(radius - 1, radius, distance);
        }

        let r = paperR;
        let g = paperG;
        let b = paperB;
        if (cmyk) {
          // Ink is subtractive: each plate multiplies what the last let through.
          r *= (1 - inks[0]) * (1 - inks[3]);
          g *= (1 - inks[1]) * (1 - inks[3]);
          b *= (1 - inks[2]) * (1 - inks[3]);
        } else {
          const k = inks[0];
          r += (inkR - r) * k;
          g += (inkG - g) * k;
          b += (inkB - b) * k;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
    return image;
  },
};

/**
 * RGB to CMYK with full grey-component replacement: whatever the three inks
 * share becomes black instead, which is what stops a press laying three wet
 * layers down to make a colour one dry one can manage.
 */
function separate(r, g, b, out) {
  const c = 1 - r / 255;
  const m = 1 - g / 255;
  const y = 1 - b / 255;
  const k = Math.min(c, m, y);
  const keep = 1 - k;
  out[0] = keep > 0 ? (c - k) / keep : 0;
  out[1] = keep > 0 ? (m - k) / keep : 0;
  out[2] = keep > 0 ? (y - k) / keep : 0;
  out[3] = k;
}
