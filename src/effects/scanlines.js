import { clamp } from './shared.js';

/**
 * The dark gaps between a CRT's lines, and optionally its shadow mask.
 *
 * Spacing is a share of the height rather than a pixel count, so the line count
 * stays the same in the preview as in the export — a pixel-based spacing would
 * show four times as many lines on download, which is exactly the artefact that
 * makes a screenshot look wrong.
 *
 * The RGB mask is the other half of the illusion. A colour CRT has no white
 * phosphor; it has red, green and blue stripes, and every third column carries
 * only one of them. Darkening two channels per column reproduces that, and it
 * is what stops the effect reading as "photo with lines drawn on".
 *
 * For the bulge of the glass, stack Lens Distortion in front of it.
 */
export default {
  id: 'scanlines',
  label: 'Scanlines',
  // Late, with the dithers and the halftone: it is the display, not the image.
  stage: 6,
  params: [
    { key: 'spacing', label: 'Spacing', type: 'range', min: 0.2, max: 5, step: 0.1, default: 0.6, unit: '%', random: [0.3, 2] },
    { key: 'darkness', label: 'Darkness', type: 'range', min: 0, max: 100, step: 1, default: 55, unit: '%', random: [30, 85] },
    { key: 'thickness', label: 'Line width', type: 'range', min: 10, max: 90, step: 1, default: 50, unit: '%', random: [25, 65] },
    { key: 'mask', label: 'RGB mask', type: 'toggle', default: false },
    { key: 'maskStrength', label: 'Mask strength', type: 'range', min: 0, max: 100, step: 1, default: 45, unit: '%', random: [20, 70], showWhen: (p) => p.mask },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const darkness = params.darkness / 100;
    const mask = params.mask;
    if ((darkness <= 0 && !mask) || width < 1 || height < 1) return image;

    const spacing = Math.max(2, Math.round((params.spacing / 100) * height));
    const dark = Math.round(spacing * (params.thickness / 100));
    const maskStrength = mask ? params.maskStrength / 100 : 0;

    for (let y = 0; y < height; y++) {
      const onLine = y % spacing < dark;
      const rowFactor = onLine ? 1 - darkness : 1;

      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 0) continue;

        if (maskStrength > 0) {
          const lit = x % 3;
          for (let c = 0; c < 3; c++) {
            const factor = rowFactor * (c === lit ? 1 : 1 - maskStrength);
            data[i + c] = clamp(data[i + c] * factor, 0, 255);
          }
          continue;
        }
        if (rowFactor === 1) continue;
        data[i] *= rowFactor;
        data[i + 1] *= rowFactor;
        data[i + 2] *= rowFactor;
      }
    }
    return image;
  },
};
