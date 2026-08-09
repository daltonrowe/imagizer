import { hexToRgb } from './shared.js';

/**
 * Snaps every pixel to the nearest colour in a fixed palette.
 *
 * Where Posterize quantises each channel independently on an even grid, this
 * matches against a specific list — so the output contains those colours and no
 * others, which is what makes a Game Boy screenshot look like one rather than
 * like a green photograph.
 *
 * Ordered dithering is the difference between four colours and four *bands*.
 * The 4×4 Bayer matrix nudges each pixel's value up or down by a fixed
 * position-dependent amount before matching, so a tone halfway between two
 * palette entries lands on each about half the time and the eye mixes them.
 * It uses no randomness, so it ignores the seed, exactly as Bayer Dither does.
 */

const PALETTES = [
  { value: 'gameboy', label: 'Game Boy', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { value: 'cga', label: 'CGA', colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  { value: 'mono', label: 'Black & white', colors: ['#000000', '#ffffff'] },
  { value: 'grey4', label: 'Four greys', colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'] },
  { value: 'sepia', label: 'Sepia', colors: ['#2b1d0e', '#6b4f2a', '#b08d57', '#e8d3a9', '#fdf6e3'] },
  {
    value: 'sixteen',
    label: 'Sixteen',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
];

// 4x4 Bayer, normalised to -0.5..0.5 so dithering brightens as often as it dims.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  .map((v) => (v + 0.5) / 16 - 0.5);

export default {
  id: 'palette',
  label: 'Palette',
  // With posterize and the thresholds: it is a tone reduction, and it wants the
  // finished colours rather than ones a later stage will change again.
  stage: 5,
  params: [
    { key: 'palette', label: 'Palette', type: 'select', default: 'gameboy', options: PALETTES },
    { key: 'dither', label: 'Dither', type: 'range', min: 0, max: 100, step: 1, default: 40, unit: '%', random: [0, 80] },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [70, 100] },
  ],

  apply(image, { params }) {
    const { data, width } = image;
    const amount = params.amount / 100;
    if (amount <= 0) return image;

    const entry = PALETTES.find((p) => p.value === params.palette) ?? PALETTES[0];
    const colors = entry.colors.map(hexToRgb);
    // How far apart the palette sits, so the dither nudge scales with it: a
    // fixed offset would be invisible on 16 colours and violent on two.
    const spread = (255 / Math.max(1, colors.length - 1)) * (params.dither / 100);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) continue;
      const pixel = i >> 2;
      const nudge = spread * BAYER4[((pixel / width) & 3) * 4 + (pixel % width & 3)];

      const r = data[i] + nudge;
      const g = data[i + 1] + nudge;
      const b = data[i + 2] + nudge;

      let best = colors[0];
      let bestDistance = Infinity;
      for (const color of colors) {
        const dr = r - color[0];
        const dg = g - color[1];
        const db = b - color[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = color;
        }
      }

      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (best[c] - data[i + c]) * amount;
    }
    return image;
  },
};
