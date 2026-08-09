import { hexToRgb } from './shared.js';
import { screenLight } from './glow.js';
import { highlightLayer, smear, tapsFor } from './streaks.js';

/**
 * The horizontal flare bar an anamorphic lens throws off every highlight.
 *
 * Anamorphic glass squeezes a wide frame onto a normal sensor, and because the
 * squeeze happens in one axis only, so does everything the lens does wrong —
 * out-of-focus circles become ovals, and flare, which a spherical lens spreads
 * evenly, gets drawn into a bar. Keeping the angle at 0 is the cinema look; the
 * control is there because turning it is free.
 *
 * Length is a share of the shorter side rather than a pixel count, so the bar
 * covers the same part of the picture in the preview as in the export.
 */
export default {
  id: 'streak',
  label: 'Anamorphic Streak',
  // With the other light: real highlights to work from, before anything
  // quantises them away.
  stage: 3,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 70, unit: '%', random: [50, 88] },
    { key: 'length', label: 'Length', type: 'range', min: 1, max: 60, step: 1, default: 20, unit: '%', random: [8, 40] },
    { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 180, step: 1, default: 0, unit: '°', random: [0, 180] },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 300, step: 5, default: 140, unit: '%', random: [60, 220] },
    { key: 'tint', label: 'Tint', type: 'color', default: '#7fb2ff' },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const intensity = params.intensity / 100;
    if (intensity <= 0 || width < 2 || height < 2) return image;

    const length = (params.length / 100) * Math.min(width, height);
    if (length < 1) return image;

    const layer = highlightLayer(image, params.threshold);
    const light = new Float32Array(data.length);
    smear(layer, light, width, height, params.angle, length, tapsFor(length));

    // The blue cast is half of why the look is recognisable, so it is a param
    // rather than a constant — pull it to white to switch it off.
    const [tr, tg, tb] = hexToRgb(params.tint).map((channel) => channel / 255);
    for (let i = 0; i < light.length; i += 4) {
      light[i] *= tr;
      light[i + 1] *= tg;
      light[i + 2] *= tb;
    }

    return screenLight(image, light, intensity);
  },
};
