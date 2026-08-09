import { MODES, composite } from './blendmodes.js';

/**
 * Lays several earlier stages of the chain back on top, each fainter than the
 * last — a motion trail through the effect stack rather than through time.
 *
 * Reblend Previous reaches back one chosen distance; this reaches back all of
 * them at once. Blur, sort, threshold, then echo four steps with a decay and
 * every stage the image passed through is still faintly visible underneath the
 * final one.
 *
 * Decay is per step, so it compounds: at 60% the first echo lands at 60% of the
 * base opacity, the second at 36%, the third at 22%. That is what makes the
 * trail fade off rather than stopping dead at the last step.
 *
 * Oldest first, so the nearest stage ends up on top — the other order buries
 * the image under its own history.
 */
export default {
  id: 'echo',
  label: 'Echo',
  // Last, with the reblends: it exists to put earlier stages over later ones.
  stage: 7,
  historyDepth: (params) => params.steps,
  params: [
    { key: 'steps', label: 'Steps', type: 'range', min: 1, max: 8, step: 1, default: 3, random: [2, 5] },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 45, unit: '%', random: [25, 70] },
    { key: 'decay', label: 'Decay', type: 'range', min: 10, max: 95, step: 1, default: 60, unit: '%', random: [35, 80] },
    { key: 'mode', label: 'Blend mode', type: 'select', default: 'normal', options: MODES },
  ],

  apply(image, { params, frameAt }) {
    if (typeof frameAt !== 'function') return image;

    const steps = Math.round(params.steps);
    const decay = params.decay / 100;

    for (let step = steps; step >= 1; step--) {
      const opacity = params.opacity * decay ** (step - 1);
      if (opacity < 0.5) continue;
      composite(image, frameAt(step), { mode: params.mode, opacity });
    }
    return image;
  },
};
