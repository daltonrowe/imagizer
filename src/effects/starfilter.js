import { screenLight } from './glow.js';
import { highlightLayer, smear, tapsFor } from './streaks.js';

/**
 * The spikes a cross-screen filter puts on every point of light.
 *
 * A star filter is a plain piece of glass with fine grooves ruled across it;
 * light hitting a groove diffracts along it, which is why the spikes always
 * point the same way whatever the picture is doing. Two rulings crossed give
 * four points, three give six — which is why the count here goes in twos, and
 * why odd numbers of spikes are not on offer. A camera lens with an odd number
 * of aperture blades does produce them, but that is a different artefact.
 *
 * Cost is the reason the count is capped: each pair of points is another smear
 * across the whole frame.
 */
export default {
  id: 'starfilter',
  label: 'Star Filter',
  stage: 3,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 100, step: 1, default: 82, unit: '%', random: [65, 92] },
    { key: 'points', label: 'Points', type: 'range', min: 2, max: 8, step: 2, default: 4, random: [2, 8] },
    { key: 'length', label: 'Length', type: 'range', min: 1, max: 40, step: 1, default: 12, unit: '%', random: [5, 25] },
    { key: 'rotation', label: 'Rotation', type: 'range', min: 0, max: 180, step: 1, default: 45, unit: '°', random: [0, 180] },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 300, step: 5, default: 150, unit: '%', random: [70, 240] },
  ],

  apply(image, { params }) {
    const { data, width, height } = image;
    const intensity = params.intensity / 100;
    if (intensity <= 0 || width < 2 || height < 2) return image;

    const length = (params.length / 100) * Math.min(width, height);
    if (length < 1) return image;

    const layer = highlightLayer(image, params.threshold);
    const light = new Float32Array(data.length);

    // Each smear draws both ways along its line, so it makes two points.
    const pairs = Math.max(1, Math.round(params.points / 2));
    const taps = tapsFor(length);
    for (let pair = 0; pair < pairs; pair++) {
      smear(layer, light, width, height, params.rotation + (180 / pairs) * pair, length, taps);
    }

    return screenLight(image, light, intensity / pairs);
  },
};
