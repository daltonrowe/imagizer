import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../src/random.js';
import { createItem } from '../src/effects/index.js';
import { renderPipeline, hasActiveEffects } from '../src/pipeline.js';

/**
 * A stand-in for a 2D context that records the order of calls, so the tests can
 * assert that the crop happens before any effect touches a pixel.
 */
function fakeContext(width, height, fill = 128) {
  const calls = [];
  const data = new Uint8ClampedArray(width * height * 4).fill(fill);
  return {
    calls,
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    drawImage: () => calls.push('drawImage'),
    getImageData(x, y, w, h) {
      calls.push(`getImageData:${x},${y},${w},${h}`);
      return { data, width: w, height: h };
    },
    putImageData(image, x, y) {
      calls.push(`putImageData:${x},${y}`);
    },
  };
}

/** A drawCrop that stamps a recognisable pattern, like the real one would. */
function stampCrop(marker) {
  return (ctx, width, height, options) => {
    ctx.calls.push(`drawCrop:${width}x${height}:${options?.background ?? 'none'}`);
    const image = ctx.getImageData(0, 0, width, height);
    image.data.fill(marker);
    // The recorded getImageData from the crop is bookkeeping, not the effects'.
    ctx.calls.pop();
  };
}

test('the crop runs before any effect', () => {
  const order = [];
  const chain = [createItem('greyscale'), createItem('threshold')];
  const ctx = fakeContext(8, 8);

  const drawCrop = (context, width, height) => {
    order.push('crop');
    context.calls.push(`drawCrop:${width}x${height}`);
  };

  // Wrap the image so any effect read/write is recorded after the crop.
  const spy = {
    ...ctx,
    getImageData(...args) {
      order.push('effects-read');
      return ctx.getImageData(...args);
    },
    putImageData(...args) {
      order.push('effects-write');
      return ctx.putImageData(...args);
    },
    calls: ctx.calls,
  };

  renderPipeline({ ctx: spy, drawCrop, width: 8, height: 8, chain, rng: createRng('s') });

  assert.deepEqual(order, ['crop', 'effects-read', 'effects-write']);
  assert.equal(order.indexOf('crop'), 0, 'crop must be first');
});

test('effects only ever see the cropped region', () => {
  const chain = [createItem('greyscale')];
  const ctx = fakeContext(1080, 1350);

  renderPipeline({
    ctx,
    drawCrop: (context, width, height) => context.calls.push(`drawCrop:${width}x${height}`),
    width: 1080,
    height: 1350,
    chain,
    rng: createRng('s'),
  });

  // The read covers the crop exactly — no margin, no full-source read.
  assert.ok(ctx.calls.includes('getImageData:0,0,1080,1350'), ctx.calls.join(' '));
  assert.ok(ctx.calls.includes('putImageData:0,0'));
});

test('the background is filled as part of the crop, before effects', () => {
  const ctx = fakeContext(4, 4);
  const seen = [];

  renderPipeline({
    ctx,
    drawCrop: (context, width, height, options) => seen.push(options.background),
    width: 4,
    height: 4,
    background: '#ffffff',
    chain: [createItem('threshold')],
    rng: createRng('s'),
  });

  assert.deepEqual(seen, ['#ffffff'], 'the matte belongs to the crop step');
  // Effects then run on the flattened result rather than on transparency.
  assert.ok(ctx.calls.some((call) => call.startsWith('getImageData')));
});

test('an empty or fully disabled chain still crops, and skips the effect pass', () => {
  for (const chain of [[], [{ ...createItem('blur'), enabled: false }]]) {
    const ctx = fakeContext(4, 4);
    let cropped = false;

    renderPipeline({
      ctx,
      drawCrop: () => { cropped = true; },
      width: 4,
      height: 4,
      chain,
      rng: createRng('s'),
    });

    assert.equal(cropped, true, 'the crop always happens');
    assert.equal(ctx.calls.length, 0, 'no pixel round trip when nothing is enabled');
  }
});

test('hasActiveEffects ignores disabled stages', () => {
  assert.equal(hasActiveEffects([]), false);
  assert.equal(hasActiveEffects([createItem('blur')]), true);
  assert.equal(hasActiveEffects([{ ...createItem('blur'), enabled: false }]), false);
  assert.equal(
    hasActiveEffects([{ ...createItem('blur'), enabled: false }, createItem('greyscale')]),
    true,
  );
});

test('the same pipeline at two sizes stays consistent in ordering', () => {
  // Preview and export differ only in pixel size; both crop first.
  for (const [width, height] of [[240, 240], [1080, 1080]]) {
    const ctx = fakeContext(width, height);
    const calls = [];
    renderPipeline({
      ctx,
      drawCrop: (context, w, h) => calls.push(`crop:${w}x${h}`),
      width,
      height,
      chain: [createItem('greyscale')],
      rng: createRng('s'),
    });
    assert.deepEqual(calls, [`crop:${width}x${height}`]);
    assert.equal(ctx.calls[0], `getImageData:0,0,${width},${height}`);
  }
});

// stampCrop is exercised indirectly above; keep the helper honest.
test('the crop helper writes into the buffer the effects then read', () => {
  const ctx = fakeContext(4, 4, 0);
  stampCrop(200)(ctx, 4, 4, {});
  const image = ctx.getImageData(0, 0, 4, 4);
  assert.equal(image.data[0], 200);
});
