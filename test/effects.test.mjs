import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../src/random.js';
import {
  EFFECTS,
  getEffect,
  runChain,
  randomChain,
  createItem,
  normalizeChain,
  normalizeParams,
  chainNeedsSource,
  chainHistoryDepth,
  chainToJSON,
  chainFromJSON,
  RANDOM_MIN,
  RANDOM_MAX,
} from '../src/effects/index.js';

/** An ImageData-shaped object; effects never touch the DOM constructor. */
function image(width, height, fill = (x, y) => [x % 256, y % 256, (x + y) % 256, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { data, width, height };
}

/**
 * A fixture with long, non-monotonic bright runs — what pixel sort needs in
 * order to actually do anything.
 *
 * Two more obvious fixtures both pass every assertion for the wrong reason: a
 * plain gradient already ascends along the sort axis, and fine-grained noise
 * yields runs 1-2px long. In both cases sorting is a no-op, so the effect looks
 * deterministic and seed-independent when it is neither. Hence a smooth wave
 * (long runs above the threshold) plus jitter (unsorted within a run).
 */
const texture = (x, y) => {
  const wave = 140 + 80 * Math.sin(x / 3 + y / 7) + ((x * 97 + y * 53) % 40) - 20;
  const v = Math.min(255, Math.max(0, Math.round(wave)));
  return [v, v, v, 255];
};

const at = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

const rng = () => createRng('test-seed');

test('every effect is registered with the metadata the UI needs', () => {
  const ids = EFFECTS.map((e) => e.id);
  assert.deepEqual(ids.slice().sort(), [
    'atkinson', 'bayer', 'blockshuffle', 'bloom', 'blur', 'bokeh',
    'channelshift', 'channelsort', 'channelthreshold', 'chromatic',
    'colorize', 'colorkey', 'diffkey', 'duotone', 'echo', 'edgedetect',
    'grain', 'greyscale', 'gridgate', 'halftone', 'huerotate', 'invert',
    'kaleidoscope', 'lens', 'levels', 'lightleak', 'palette', 'pixelate',
    'pixelsort', 'posterize', 'randomdither', 'reblend', 'reblendprevious',
    'ripple', 'scanlines', 'shapemask', 'sharpen', 'slicer', 'solarize',
    'spotlight', 'starfilter', 'streak', 'threshold', 'tiltshift', 'twirl',
    'vignette', 'warp',
  ]);
  for (const effect of EFFECTS) {
    assert.equal(typeof effect.label, 'string');
    assert.equal(typeof effect.stage, 'number');
    assert.equal(typeof effect.apply, 'function');
    for (const spec of effect.params) {
      assert.ok(['range', 'toggle', 'select', 'color'].includes(spec.type), `${effect.id}.${spec.key}`);
      assert.notEqual(spec.default, undefined, `${effect.id}.${spec.key} needs a default`);
      if (spec.type === 'range') {
        assert.ok(spec.min < spec.max);
        assert.ok(spec.default >= spec.min && spec.default <= spec.max);
        if (spec.random) {
          assert.ok(spec.random[0] >= spec.min && spec.random[1] <= spec.max, `${effect.id}.${spec.key} random hint out of range`);
        }
      }
    }
  }
});

test('greyscale removes colour but keeps luminance and alpha', () => {
  const img = image(4, 1, () => [255, 0, 0, 128]);
  getEffect('greyscale').apply(img, { params: { amount: 100 }, rng: rng() });
  const [r, g, b, a] = at(img, 0, 0);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(a, 128, 'alpha must survive');
  assert.ok(Math.abs(r - 0.2126 * 255) < 1.5, `expected Rec.709 luma, got ${r}`);

  const partial = image(1, 1, () => [255, 0, 0, 255]);
  getEffect('greyscale').apply(partial, { params: { amount: 50 }, rng: rng() });
  assert.ok(at(partial, 0, 0)[0] > 120 && at(partial, 0, 0)[0] < 200, 'amount should blend');
});

test('threshold splits at the level and inverts', () => {
  const gradient = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('threshold').apply(gradient, { params: { level: 128, softness: 0, invert: false }, rng: rng() });
  assert.deepEqual(at(gradient, 100, 0), [0, 0, 0, 255]);
  assert.deepEqual(at(gradient, 200, 0), [255, 255, 255, 255]);

  const inverted = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('threshold').apply(inverted, { params: { level: 128, softness: 0, invert: true }, rng: rng() });
  assert.deepEqual(at(inverted, 100, 0), [255, 255, 255, 255]);
  assert.deepEqual(at(inverted, 200, 0), [0, 0, 0, 255]);

  // Softness produces a ramp rather than only two values.
  const soft = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('threshold').apply(soft, { params: { level: 128, softness: 64, invert: false }, rng: rng() });
  const values = new Set(Array.from({ length: 256 }, (_, x) => at(soft, x, 0)[0]));
  assert.ok(values.size > 2, 'softness should give intermediate tones');
});

test('blur of a flat field changes nothing, including at the edges', () => {
  const flat = image(32, 32, () => [90, 140, 210, 255]);
  getEffect('blur').apply(flat, { params: { radius: 12 }, rng: rng() });
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31], [16, 16]]) {
    const [r, g, b, a] = at(flat, x, y);
    assert.ok(Math.abs(r - 90) <= 1 && Math.abs(g - 140) <= 1 && Math.abs(b - 210) <= 1, `edge darkening at ${x},${y}: ${[r, g, b]}`);
    assert.equal(a, 255);
  }
});

test('blur spreads a hard edge and preserves the average', () => {
  const split = image(64, 1, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const before = average(split);
  getEffect('blur').apply(split, { params: { radius: 10 }, rng: rng() });
  assert.ok(at(split, 30, 0)[0] > 0, 'dark side should pick up light');
  assert.ok(at(split, 34, 0)[0] < 255, 'light side should pick up dark');
  assert.ok(Math.abs(average(split) - before) < 2, 'blur should conserve overall brightness');
});

test('blur does not bleed transparent black into visible pixels', () => {
  // A red square on transparency: without premultiplication the edge goes dark.
  const img = image(64, 1, (x) => (x < 32 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  getEffect('blur').apply(img, { params: { radius: 8 }, rng: rng() });
  for (let x = 0; x < 32; x++) {
    const [r, g, b, a] = at(img, x, 0);
    if (a < 8) continue; // essentially transparent, colour is meaningless
    assert.ok(r > 200, `halo at x=${x}: rgb ${[r, g, b]} a=${a}`);
    assert.ok(g < 60 && b < 60, `colour shift at x=${x}: ${[r, g, b]}`);
  }
});

test('blur with radius 0 is a no-op', () => {
  const img = image(16, 16);
  const copy = Uint8ClampedArray.from(img.data);
  getEffect('blur').apply(img, { params: { radius: 0 }, rng: rng() });
  assert.deepEqual(img.data, copy);
});

test('atkinson dither quantises to the requested levels', () => {
  const gradient = image(64, 64, (x) => [x * 4, x * 4, x * 4, 255]);
  getEffect('atkinson').apply(gradient, { params: { levels: 2, scale: 1 }, rng: rng() });
  const values = new Set();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) values.add(at(gradient, x, y)[0]);
  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255], 'two levels means pure black and white');

  const four = image(64, 64, (x) => [x * 4, x * 4, x * 4, 255]);
  getEffect('atkinson').apply(four, { params: { levels: 4, scale: 1 }, rng: rng() });
  const fourValues = new Set();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) fourValues.add(at(four, x, y)[0]);
  assert.ok(fourValues.size > 2 && fourValues.size <= 4, `expected up to 4 tones, got ${fourValues.size}`);
});

test('atkinson approximates the original brightness', () => {
  const gradient = image(96, 96, (x, y) => { const v = (x + y) % 256; return [v, v, v, 255]; });
  const before = average(gradient);
  getEffect('atkinson').apply(gradient, { params: { levels: 2, scale: 1 }, rng: rng() });
  assert.ok(Math.abs(average(gradient) - before) < 12, `dither drifted: ${average(gradient)} vs ${before}`);
});

test('atkinson pixel size produces uniform blocks', () => {
  const img = image(32, 32, (x, y) => { const v = (x * 8 + y * 3) % 256; return [v, v, v, 255]; });
  getEffect('atkinson').apply(img, { params: { levels: 2, scale: 4 }, rng: rng() });
  for (let by = 0; by < 32; by += 4) {
    for (let bx = 0; bx < 32; bx += 4) {
      const expected = at(img, bx, by)[0];
      for (let y = by; y < by + 4; y++) {
        for (let x = bx; x < bx + 4; x++) {
          assert.equal(at(img, x, y)[0], expected, `block at ${bx},${by} not uniform`);
        }
      }
    }
  }
});

test('pixel sort orders bright runs and preserves the pixels', () => {
  const row = image(32, 1, (x) => { const v = ((x * 37) % 64) + 190; return [v, v, v, 255]; });
  const before = [...row.data].filter((_, i) => i % 4 === 0).sort((a, b) => a - b);

  getEffect('pixelsort').apply(row, {
    params: { direction: 'horizontal', threshold: 0, maxRun: 100, coverage: 100, reverse: false },
    rng: rng(),
  });

  const after = [...row.data].filter((_, i) => i % 4 === 0);
  assert.deepEqual(after.slice().sort((a, b) => a - b), before, 'sorting must not invent or lose pixels');
  for (let x = 1; x < 32; x++) assert.ok(after[x] >= after[x - 1], 'run should end up ascending');
});

test('pixel sort reverses and works vertically', () => {
  const column = image(1, 32, (_x, y) => { const v = ((y * 37) % 64) + 190; return [v, v, v, 255]; });
  getEffect('pixelsort').apply(column, {
    params: { direction: 'vertical', threshold: 0, maxRun: 100, coverage: 100, reverse: true },
    rng: rng(),
  });
  const values = Array.from({ length: 32 }, (_, y) => at(column, 0, y)[0]);
  for (let y = 1; y < 32; y++) assert.ok(values[y] <= values[y - 1], 'reverse should sort descending');
});

test('pixel sort leaves dark pixels below the threshold alone', () => {
  const row = image(32, 1, (x) => (x < 16 ? [10, 10, 10, 255] : [200 + (x % 8), 200, 200, 255]));
  const darkBefore = Array.from({ length: 16 }, (_, x) => at(row, x, 0));
  getEffect('pixelsort').apply(row, {
    params: { direction: 'horizontal', threshold: 128, maxRun: 100, coverage: 100, reverse: false },
    rng: rng(),
  });
  for (let x = 0; x < 16; x++) assert.deepEqual(at(row, x, 0), darkBefore[x]);
});

test('pixel sort is reproducible from the seed and varies with it', () => {
  const run = (seed) => {
    const img = image(48, 48, texture);
    getEffect('pixelsort').apply(img, {
      params: { direction: 'horizontal', threshold: 100, maxRun: 40, coverage: 50, reverse: false },
      rng: createRng(seed),
    });
    return [...img.data];
  };
  assert.deepEqual(run('alpha'), run('alpha'));
  assert.notDeepEqual(run('alpha'), run('beta'));
});

test('a chain feeds each effect into the next', () => {
  const chain = [createItem('greyscale'), createItem('threshold', { level: 128, softness: 0 })];
  const img = image(16, 16, (x) => [x * 16, 0, 0, 255]);
  runChain(img, chain, rng());

  for (let x = 0; x < 16; x++) {
    const [r, g, b] = at(img, x, 0);
    assert.ok((r === 0 || r === 255) && r === g && g === b, `chain output should be pure B/W, got ${[r, g, b]}`);
  }
  // Threshold alone on the red ramp would keep it red-channel-driven; the
  // greyscale first is what makes every pixel black here.
  assert.deepEqual(at(img, 15, 0).slice(0, 3), [0, 0, 0]);
});

test('a chain is deterministic, and disabled items are skipped', () => {
  const chain = [createItem('pixelsort'), createItem('atkinson')];
  const run = (seed, c) => {
    const img = image(40, 40, texture);
    runChain(img, c, createRng(seed));
    return [...img.data];
  };
  assert.deepEqual(run('s', chain), run('s', chain));
  assert.notDeepEqual(run('s', chain), run('t', chain));

  const disabled = [{ ...chain[0], enabled: false }, chain[1]];
  assert.notDeepEqual(run('s', chain), run('s', disabled));
});

test('two of the same effect in one chain get different randomness', () => {
  const twice = [createItem('pixelsort', { coverage: 50 }), createItem('pixelsort', { coverage: 50 })];
  const single = [createItem('pixelsort', { coverage: 50 })];
  const run = (c) => {
    const img = image(40, 40, texture);
    runChain(img, c, rng());
    return [...img.data];
  };
  // If both instances shared a stream the second pass would be a no-op repeat.
  assert.notDeepEqual(run(twice), run(single));
});

test('randomChain picks 2-5 distinct effects in stage order', () => {
  for (let i = 0; i < 200; i++) {
    const chain = randomChain(createRng(`roll-${i}`));
    assert.ok(chain.length >= RANDOM_MIN && chain.length <= RANDOM_MAX, `length ${chain.length}`);
    assert.equal(new Set(chain.map((item) => item.id)).size, chain.length, 'effects should be distinct');

    const stages = chain.map((item) => getEffect(item.id).stage);
    assert.deepEqual(stages, stages.slice().sort((a, b) => a - b), 'chain should be in stage order');

    for (const item of chain) {
      const effect = getEffect(item.id);
      assert.deepEqual(item.params, normalizeParams(effect, item.params), 'random params must be valid');
    }
  }
});

test('randomChain varies, and repeats for the same generator seed', () => {
  const signature = (rngInstance) => JSON.stringify(randomChain(rngInstance));
  assert.equal(signature(createRng('same')), signature(createRng('same')));

  const seen = new Set(Array.from({ length: 60 }, (_, i) => signature(createRng(`n${i}`))));
  assert.ok(seen.size > 40, `expected variety, got ${seen.size} distinct chains`);
});

test('params are clamped, snapped to step, and defaulted', () => {
  const blur = getEffect('blur');
  assert.equal(normalizeParams(blur, { radius: 999 }).radius, 40);
  assert.equal(normalizeParams(blur, { radius: -5 }).radius, 0);
  assert.equal(normalizeParams(blur, {}).radius, 6);
  assert.equal(normalizeParams(blur, { radius: 'nonsense' }).radius, 6);

  const sort = getEffect('pixelsort');
  assert.equal(normalizeParams(sort, { direction: 'diagonal' }).direction, 'horizontal');
  assert.equal(normalizeParams(sort, { reverse: 'yes' }).reverse, false);
  assert.equal(normalizeParams(getEffect('randomdither'), { amount: 103 }).amount, 105, 'should snap to the step');
});

test('normalizeChain drops unknown effects', () => {
  const chain = normalizeChain([{ id: 'blur' }, { id: 'nope' }, { id: 'greyscale', params: {} }, null]);
  assert.deepEqual(chain.map((item) => item.id), ['blur', 'greyscale']);
});

test('JSON round-trips a chain with its seed and crop', () => {
  const chain = randomChain(createRng('preset'));
  const json = chainToJSON({ chain, seed: 'golden hour', crop: { w: 1080, h: 1350 } });
  const parsed = chainFromJSON(json);

  assert.deepEqual(parsed.chain, chain);
  assert.equal(parsed.seed, 'golden hour');
  assert.deepEqual(parsed.crop, { w: 1080, h: 1350 });
  assert.equal(parsed.dropped, 0);

  // And the round-tripped preset renders identically.
  const render = (c, seed) => {
    const img = image(32, 32, texture);
    runChain(img, c, createRng(seed));
    return [...img.data];
  };
  assert.deepEqual(render(parsed.chain, parsed.seed), render(chain, 'golden hour'));
});

test('JSON import reports what it had to drop', () => {
  const parsed = chainFromJSON(JSON.stringify({
    format: 'imagizer.chain',
    effects: [{ id: 'blur' }, { id: 'unreleased-effect' }],
  }));
  assert.equal(parsed.chain.length, 1);
  assert.equal(parsed.dropped, 1);
  assert.equal(parsed.seed, null);
});

test('JSON import rejects junk with a readable message', () => {
  assert.throws(() => chainFromJSON('not json'), /valid JSON/);
  assert.throws(() => chainFromJSON('[]'), /effects/);
  assert.throws(() => chainFromJSON('null'), /JSON object/);
  assert.throws(() => chainFromJSON(JSON.stringify({ format: 'something.else', effects: [] })), /not an Imagizer chain/);
});

test('a disabled effect survives the JSON round trip', () => {
  const chain = [{ ...createItem('blur'), enabled: false }, createItem('greyscale')];
  const parsed = chainFromJSON(chainToJSON({ chain, seed: 's' }));
  assert.equal(parsed.chain[0].enabled, false);
  assert.equal(parsed.chain[1].enabled, true);
});

function average(img) {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) sum += img.data[i];
  return sum / (img.data.length / 4);
}

// ---------- reblend ----------

const RED = () => image(8, 8, () => [200, 40, 40, 255]);

/** Run a chain and hand back the finished image. */
function render(chain, fill = (x, y) => [200, 40, 40, 255], size = 8) {
  const img = image(size, size, fill);
  runChain(img, chain, rng());
  return img;
}

test('reblend at full opacity and normal mode restores the original exactly', () => {
  const original = RED();
  const out = render([
    createItem('threshold', { level: 128, softness: 0 }),
    createItem('reblend', { mode: 'normal', opacity: 100 }),
  ]);
  assert.deepEqual([...out.data], [...original.data]);
});

test('reblend at zero opacity changes nothing', () => {
  const thresholdOnly = render([createItem('threshold', { level: 128, softness: 0 })]);
  const withReblend = render([
    createItem('threshold', { level: 128, softness: 0 }),
    createItem('reblend', { mode: 'normal', opacity: 0 }),
  ]);
  assert.deepEqual([...withReblend.data], [...thresholdOnly.data]);
});

test('reblend composites the chain input, not the previous stage', () => {
  // Greyscale destroys the colour; reblending the *original* brings it back.
  // Reading the previous stage instead would leave the image grey.
  const out = render([
    createItem('greyscale', { amount: 100 }),
    createItem('reblend', { mode: 'normal', opacity: 100 }),
  ]);
  assert.deepEqual(at(out, 0, 0), [200, 40, 40, 255]);
});

test('every reblend in a chain sees the same original', () => {
  const twice = render([
    createItem('greyscale', { amount: 100 }),
    createItem('reblend', { mode: 'normal', opacity: 100 }),
    createItem('greyscale', { amount: 100 }),
    createItem('reblend', { mode: 'normal', opacity: 100 }),
  ]);
  assert.deepEqual(at(twice, 0, 0), [200, 40, 40, 255]);
});

test('reblend at half opacity lands halfway', () => {
  const out = render([
    createItem('threshold', { level: 128, softness: 0, invert: false }),
    createItem('reblend', { mode: 'normal', opacity: 50 }),
  ]);
  // Luma of (200,40,40) is ~72, so threshold gives black; half of red is ~100,20,20.
  const [r, g, b] = at(out, 0, 0);
  assert.ok(Math.abs(r - 100) <= 1, `r ${r}`);
  assert.ok(Math.abs(g - 20) <= 1, `g ${g}`);
  assert.ok(Math.abs(b - 20) <= 1, `b ${b}`);
});

test('blend modes follow the W3C formulas', () => {
  // Backdrop is mid grey after a 50% greyscale... use a known pair instead:
  // white backdrop via threshold-invert, source is the original red.
  const modes = {
    multiply: (cb, cs) => cb * cs,
    screen: (cb, cs) => cb + cs - cb * cs,
    darken: Math.min,
    lighten: Math.max,
    difference: (cb, cs) => Math.abs(cb - cs),
    exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
  };

  for (const [mode, fn] of Object.entries(modes)) {
    const out = render([
      // Threshold to pure white so the backdrop is a known 1.0 per channel.
      createItem('threshold', { level: 0, softness: 0, invert: false }),
      createItem('reblend', { mode, opacity: 100 }),
    ]);
    const [r, g, b] = at(out, 0, 0);
    const expect = (cs) => Math.round(fn(1, cs / 255) * 255);
    assert.ok(Math.abs(r - expect(200)) <= 1, `${mode} r: ${r} vs ${expect(200)}`);
    assert.ok(Math.abs(g - expect(40)) <= 1, `${mode} g: ${g} vs ${expect(40)}`);
    assert.ok(Math.abs(b - expect(40)) <= 1, `${mode} b: ${b} vs ${expect(40)}`);
  }
});

test('difference against an untouched image is black', () => {
  const out = render([createItem('reblend', { mode: 'difference', opacity: 100 })]);
  for (let x = 0; x < 8; x++) {
    assert.deepEqual(at(out, x, 0).slice(0, 3), [0, 0, 0], 'identical images differ by nothing');
  }
});

test('reblend keeps transparency instead of punching through a cutout', () => {
  // Left half opaque, right half fully transparent.
  const fill = (x) => (x < 4 ? [200, 40, 40, 255] : [0, 0, 0, 0]);
  const out = render([
    createItem('greyscale', { amount: 100 }),
    createItem('reblend', { mode: 'normal', opacity: 100 }),
  ], fill);

  assert.deepEqual(at(out, 0, 0), [200, 40, 40, 255], 'opaque side comes back in colour');
  assert.equal(at(out, 6, 0)[3], 0, 'transparent side stays transparent');
});

test('reblend over a transparent backdrop shows the original plainly', () => {
  const img = image(4, 4, () => [10, 200, 90, 255]);
  const source = { data: Uint8ClampedArray.from(img.data), width: 4, height: 4 };
  // Wipe the backdrop to transparent, then reblend at half opacity.
  img.data.fill(0);
  getEffect('reblend').apply(img, {
    params: { mode: 'multiply', opacity: 50 },
    rng: rng(),
    source,
  });
  const [r, g, b, a] = at(img, 0, 0);
  assert.equal(a, 128, 'half-opacity source over nothing is half-opaque');
  // Colour is the source itself, undimmed — alpha carries the fade, not the RGB.
  assert.deepEqual([r, g, b], [10, 200, 90]);
});

test('reblend without a source is a no-op rather than a crash', () => {
  const img = RED();
  const copy = [...img.data];
  getEffect('reblend').apply(img, { params: { mode: 'normal', opacity: 100 }, rng: rng(), source: null });
  assert.deepEqual([...img.data], copy);
});

test('the chain only copies the image when an effect asks for it', () => {
  // The copy is the size of the whole crop, so chains that cannot use it
  // should not pay for it.
  assert.equal(chainNeedsSource([]), false);
  assert.equal(chainNeedsSource([createItem('blur'), createItem('atkinson')]), false);
  assert.equal(chainNeedsSource([createItem('reblend')]), true);
  assert.equal(chainNeedsSource([createItem('blur'), createItem('reblend')]), true);
  assert.equal(chainNeedsSource([{ ...createItem('reblend'), enabled: false }]), false);
  assert.equal(
    chainNeedsSource([{ ...createItem('reblend'), enabled: false }, createItem('reblend')]),
    true,
  );
});

// ---------- reblend previous ----------

/** Chain prefixes used below, each leaving a distinctly coloured image. */
const grey = () => createItem('greyscale', { amount: 100 });
const white = () => createItem('threshold', { level: 0, softness: 0, invert: false });
const previous = (steps, params = {}) =>
  createItem('reblendprevious', { steps, mode: 'normal', opacity: 100, ...params });

test('reblend previous at one step back recovers the stage before the last', () => {
  // Threshold blows the image out to white; reblending one step back at full
  // opacity puts the greyscale image straight over it again.
  const greyOnly = render([grey()]);
  const out = render([grey(), white(), previous(1)]);
  assert.deepEqual([...out.data], [...greyOnly.data]);
});

test('reblend previous counts stages, not pixels of distance', () => {
  // Two steps back from the third effect is the chain input, colour and all —
  // one step back would still be grey.
  const out = render([grey(), white(), previous(2)]);
  assert.deepEqual(at(out, 0, 0), [200, 40, 40, 255]);
});

test('a step count that runs off the front of the chain lands on the input', () => {
  const original = RED();
  const out = render([grey(), white(), previous(8)]);
  assert.deepEqual([...out.data], [...original.data]);
  // ...which is exactly what Reblend Original would have given.
  const asOriginal = render([grey(), white(), createItem('reblend', { mode: 'normal', opacity: 100 })]);
  assert.deepEqual([...out.data], [...asOriginal.data]);
});

test('disabled effects do not count as steps', () => {
  // The greyscale is off, so one step back is the image before the threshold —
  // the untouched photo, not a grey one.
  const out = render([{ ...grey(), enabled: false }, white(), previous(1)]);
  assert.deepEqual(at(out, 0, 0), [200, 40, 40, 255]);
});

test('the first effect in a chain sees only the chain input', () => {
  const original = RED();
  const out = render([previous(3)]);
  assert.deepEqual([...out.data], [...original.data], 'nothing behind it to reach for');
});

test('reblend previous still reaches back once older frames have been released', () => {
  // Long enough that the runner has dropped frames it can no longer reach; the
  // one step this asks for must survive that trimming.
  const throughHue = render([grey(), createItem('huerotate', { angle: 120 }), createItem('colorize', { amount: 40, color: '#2244ff' })]);
  const out = render([
    grey(),
    createItem('huerotate', { angle: 120 }),
    createItem('colorize', { amount: 40, color: '#2244ff' }),
    white(),
    previous(1),
  ]);
  assert.deepEqual([...out.data], [...throughHue.data]);
});

test('two reblend previouses in one chain each reach their own depth', () => {
  const greyOnly = render([grey()]);
  const original = RED();
  const out = render([
    grey(),
    white(),
    previous(1), // back to grey
    white(),
    previous(4), // back to the chain input
  ]);
  assert.deepEqual([...out.data], [...original.data]);
  // The intermediate step really did land on grey rather than being overwritten
  // by luck: stopping there gives the greyscale image.
  assert.deepEqual([...render([grey(), white(), previous(1)]).data], [...greyOnly.data]);
});

test('reblend previous honours blend mode and opacity', () => {
  const out = render([grey(), white(), previous(2, { mode: 'multiply', opacity: 100 })]);
  // Backdrop is pure white, so multiply hands back the source untouched.
  assert.deepEqual(at(out, 0, 0), [200, 40, 40, 255]);

  const half = render([white(), previous(1, { opacity: 50 })]);
  const [r, g, b] = at(half, 0, 0);
  // White backdrop, red source at half strength.
  assert.ok(Math.abs(r - 228) <= 1, `r ${r}`);
  assert.ok(Math.abs(g - 148) <= 1, `g ${g}`);
  assert.ok(Math.abs(b - 148) <= 1, `b ${b}`);
});

test('reblend previous outside a chain runner is a no-op rather than a crash', () => {
  const img = RED();
  const copy = [...img.data];
  getEffect('reblendprevious').apply(img, {
    params: { steps: 2, mode: 'normal', opacity: 100 },
    rng: rng(),
    source: null,
    frameAt: null,
  });
  assert.deepEqual([...img.data], copy);
});

test('the chain keeps history only as deep as something reaches', () => {
  // Each frame is the size of the whole crop, so an unused depth is not free.
  assert.equal(chainHistoryDepth([]), 0);
  assert.equal(chainHistoryDepth([createItem('blur'), createItem('reblend')]), 0);
  assert.equal(chainHistoryDepth([previous(1)]), 1);
  assert.equal(chainHistoryDepth([previous(3), previous(1)]), 3);
  assert.equal(chainHistoryDepth([{ ...previous(5), enabled: false }, previous(2)]), 2);
  // Out-of-range values are clamped by normalizeParams before they are read.
  assert.equal(chainHistoryDepth([createItem('reblendprevious', { steps: 99 })]), 8);
});

// ---------- bayer, random dither ----------

const ramp = (x) => { const v = Math.min(255, x * 4); return [v, v, v, 255]; };
const tones = (img) => {
  const set = new Set();
  for (let i = 0; i < img.data.length; i += 4) set.add(img.data[i]);
  return [...set].sort((a, b) => a - b);
};

for (const id of ['bayer', 'randomdither']) {
  test(`${id} quantises to the requested levels`, () => {
    const two = image(64, 64, ramp);
    getEffect(id).apply(two, { params: { ...defaults(id), levels: 2, scale: 1 }, rng: rng() });
    assert.deepEqual(tones(two), [0, 255], 'two levels means pure black and white');

    const four = image(64, 64, ramp);
    getEffect(id).apply(four, { params: { ...defaults(id), levels: 4, scale: 1 }, rng: rng() });
    assert.ok(tones(four).length > 2 && tones(four).length <= 4, `got ${tones(four).length} tones`);
  });

  test(`${id} approximates the original brightness`, () => {
    const img = image(96, 96, (x, y) => { const v = (x + y) % 256; return [v, v, v, 255]; });
    const before = average(img);
    getEffect(id).apply(img, { params: { ...defaults(id), levels: 2, scale: 1 }, rng: rng() });
    assert.ok(Math.abs(average(img) - before) < 14, `drifted: ${average(img)} vs ${before}`);
  });

  test(`${id} pixel size produces uniform blocks`, () => {
    const img = image(32, 32, (x, y) => { const v = (x * 8 + y * 3) % 256; return [v, v, v, 255]; });
    getEffect(id).apply(img, { params: { ...defaults(id), levels: 2, scale: 4 }, rng: rng() });
    for (let by = 0; by < 32; by += 4) {
      for (let bx = 0; bx < 32; bx += 4) {
        const expected = at(img, bx, by)[0];
        for (let y = by; y < by + 4; y++) {
          for (let x = bx; x < bx + 4; x++) {
            assert.equal(at(img, x, y)[0], expected, `block at ${bx},${by} not uniform`);
          }
        }
      }
    }
  });

  test(`${id} leaves alpha alone`, () => {
    const img = image(16, 16, (x) => [x * 16, x * 16, x * 16, x < 8 ? 255 : 0]);
    getEffect(id).apply(img, { params: { ...defaults(id), levels: 2, scale: 1 }, rng: rng() });
    assert.equal(at(img, 2, 0)[3], 255);
    assert.equal(at(img, 12, 0)[3], 0);
  });
}

test('bayer is a fixed pattern: same output regardless of seed', () => {
  const run = (seed) => {
    const img = image(48, 48, ramp);
    getEffect('bayer').apply(img, { params: { matrix: '4', levels: 2, scale: 1 }, rng: createRng(seed) });
    return [...img.data];
  };
  assert.deepEqual(run('one'), run('two'), 'ordered dithering must not depend on randomness');
});

test('bayer matrix size changes the pattern', () => {
  const run = (matrix) => {
    const img = image(48, 48, ramp);
    getEffect('bayer').apply(img, { params: { matrix, levels: 2, scale: 1 }, rng: rng() });
    return [...img.data].join(',');
  };
  assert.notEqual(run('2'), run('4'));
  assert.notEqual(run('4'), run('8'));
});

test('bayer produces a repeating pattern on flat input', () => {
  // A flat mid grey should break into a regular 4x4 tile, not a solid block.
  const img = image(16, 16, () => [128, 128, 128, 255]);
  getEffect('bayer').apply(img, { params: { matrix: '4', levels: 2, scale: 1 }, rng: rng() });
  assert.deepEqual(tones(img), [0, 255], 'flat grey should dither, not flatten');
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      assert.equal(at(img, x, y)[0], at(img, x + 4, y + 4)[0], 'pattern should tile every 4px');
    }
  }
});

test('random dither follows the seed and varies with it', () => {
  const run = (seed) => {
    const img = image(48, 48, () => [128, 128, 128, 255]);
    getEffect('randomdither').apply(img, {
      params: { levels: 2, scale: 1, amount: 100 },
      rng: createRng(seed),
    });
    return [...img.data].join(',');
  };
  assert.equal(run('alpha'), run('alpha'), 'same seed reproduces the grain');
  assert.notEqual(run('alpha'), run('beta'), 'a new seed reshuffles it');
});

test('random dither with no noise is a plain threshold', () => {
  const img = image(64, 1, (x) => { const v = x * 4; return [v, v, v, 255]; });
  getEffect('randomdither').apply(img, { params: { levels: 2, scale: 1, amount: 0 }, rng: rng() });
  for (let x = 0; x < 64; x++) {
    const expected = x * 4 >= 128 ? 255 : 0;
    assert.equal(at(img, x, 0)[0], expected, `x=${x} should follow the midpoint`);
  }
});

test('random dither is unordered, unlike bayer', () => {
  const flat = () => image(16, 16, () => [128, 128, 128, 255]);
  const b = flat(); getEffect('bayer').apply(b, { params: { matrix: '4', levels: 2, scale: 1 }, rng: rng() });
  const r = flat(); getEffect('randomdither').apply(r, { params: { levels: 2, scale: 1, amount: 100 }, rng: rng() });
  assert.notDeepEqual([...b.data], [...r.data]);
});

// ---------- channel threshold ----------

test('channel threshold cuts each channel at its own level', () => {
  const img = image(1, 1, () => [200, 100, 50, 255]);
  getEffect('channelthreshold').apply(img, {
    params: { red: 150, green: 150, blue: 40, invert: false },
    rng: rng(),
  });
  // red 200>=150 on, green 100<150 off, blue 50>=40 on -> magenta
  assert.deepEqual(at(img, 0, 0), [255, 0, 255, 255]);
});

test('channel threshold yields at most eight colours and keeps alpha', () => {
  const img = image(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 128]);
  getEffect('channelthreshold').apply(img, {
    params: { red: 128, green: 128, blue: 128, invert: false },
    rng: rng(),
  });
  const colours = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    colours.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    assert.equal(img.data[i + 3], 128);
  }
  assert.ok(colours.size <= 8, `expected up to 8 colours, got ${colours.size}`);
  for (const colour of colours) {
    for (const channel of colour.split(',')) assert.ok(channel === '0' || channel === '255');
  }
});

test('channel threshold inverts every channel', () => {
  const params = { red: 128, green: 128, blue: 128 };
  const plain = image(1, 1, () => [200, 100, 50, 255]);
  const inverted = image(1, 1, () => [200, 100, 50, 255]);
  getEffect('channelthreshold').apply(plain, { params: { ...params, invert: false }, rng: rng() });
  getEffect('channelthreshold').apply(inverted, { params: { ...params, invert: true }, rng: rng() });
  const [r, g, b] = at(plain, 0, 0);
  assert.deepEqual(at(inverted, 0, 0), [255 - r, 255 - g, 255 - b, 255]);
});

// ---------- colorize ----------

test('colorize keeps luminance ordering and takes the target hue', () => {
  const img = image(64, 1, (x) => { const v = x * 4; return [v, v, v, 255]; });
  getEffect('colorize').apply(img, { params: { color: '#ff0000', amount: 100 }, rng: rng() });

  // Dark stays dark, light stays light.
  assert.ok(at(img, 2, 0)[0] < at(img, 60, 0)[0], 'lightness order preserved');
  // A red tint means red dominates through the midtones.
  const [r, g, b] = at(img, 32, 0);
  assert.ok(r > g && r > b, `expected a red cast, got ${[r, g, b]}`);
  assert.equal(g, b, 'red has no green/blue bias of its own');
});

test('colorize at zero amount changes nothing', () => {
  const img = image(8, 8, (x) => [x * 30, 100, 200, 255]);
  const copy = [...img.data];
  getEffect('colorize').apply(img, { params: { color: '#00ff00', amount: 0 }, rng: rng() });
  assert.deepEqual([...img.data], copy);
});

test('colorize keeps black black and white white', () => {
  const img = image(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  getEffect('colorize').apply(img, { params: { color: '#3366cc', amount: 100 }, rng: rng() });
  assert.deepEqual(at(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(at(img, 1, 0), [255, 255, 255, 255]);
});

test('colorize preserves alpha and blends partway', () => {
  const img = image(1, 1, () => [200, 40, 40, 90]);
  getEffect('colorize').apply(img, { params: { color: '#00ff00', amount: 50 }, rng: rng() });
  const [r, g, b, a] = at(img, 0, 0);
  assert.equal(a, 90);
  assert.ok(g > 40 && r < 200, `expected a partial shift toward green, got ${[r, g, b]}`);
});

// ---------- hue rotate ----------

test('hue rotate by 0 or 360 degrees leaves the image alone', () => {
  for (const angle of [0, 360]) {
    const img = image(8, 8, (x) => [x * 30, 120, 200, 255]);
    const copy = [...img.data];
    getEffect('huerotate').apply(img, { params: { angle }, rng: rng() });
    for (let i = 0; i < copy.length; i++) {
      assert.ok(Math.abs(img.data[i] - copy[i]) <= 1, `angle ${angle} changed channel ${i}`);
    }
  }
});

test('hue rotate matches the CSS filter matrix', () => {
  // Pinned to the SVG feColorMatrix values: red at 120° is exactly what
  // `filter: hue-rotate(120deg)` renders, negative channels clipped and all.
  const img = image(1, 1, () => [255, 0, 0, 255]);
  getEffect('huerotate').apply(img, { params: { angle: 120 }, rng: rng() });
  const [r, g, b, a] = at(img, 0, 0);
  assert.equal(a, 255);
  assert.ok(Math.abs(r - 0) <= 1 && Math.abs(g - 113) <= 1 && Math.abs(b - 0) <= 1,
    `expected ~[0, 113, 0], got ${[r, g, b]}`);
  assert.ok(g > r && g > b, 'red rotated 120° reads green');
});

test('hue rotate roughly keeps luminance where nothing clips', () => {
  // The matrix only approximates luminance preservation, and clipping at 0
  // breaks it outright for fully saturated colours — so measure a colour that
  // stays inside the gamut through the rotation.
  const img = image(1, 1, () => [180, 120, 90, 255]);
  const before = 0.2126 * 180 + 0.7152 * 120 + 0.0722 * 90;
  getEffect('huerotate').apply(img, { params: { angle: 90 }, rng: rng() });
  const [r, g, b] = at(img, 0, 0);
  const after = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(Math.abs(after - before) < 6, `luminance drifted: ${after} vs ${before}`);
});

test('hue rotate leaves greys grey', () => {
  const img = image(4, 1, () => [128, 128, 128, 255]);
  getEffect('huerotate').apply(img, { params: { angle: 200 }, rng: rng() });
  const [r, g, b] = at(img, 0, 0);
  assert.ok(Math.abs(r - 128) <= 1 && Math.abs(g - 128) <= 1 && Math.abs(b - 128) <= 1,
    `grey should survive rotation, got ${[r, g, b]}`);
});

test('colour params are validated and randomised as usable colours', () => {
  const colorize = getEffect('colorize');
  assert.equal(normalizeParams(colorize, { color: '#ABCDEF' }).color, '#abcdef');
  assert.equal(normalizeParams(colorize, { color: 'red' }).color, colorize.params[0].default);
  assert.equal(normalizeParams(colorize, { color: '#fff' }).color, colorize.params[0].default);
  assert.equal(normalizeParams(colorize, {}).color, colorize.params[0].default);

  // Draw until enough chains happen to contain a colorize, rather than fixing
  // the number of rolls: a random chain is 2-5 effects out of the whole
  // registry, so a fixed roll count quietly weakens every time one is added.
  const seen = new Set();
  let sampled = 0;
  for (let i = 0; sampled < 20 && i < 500; i++) {
    const item = randomChain(createRng(`c${i}`)).find((entry) => entry.id === 'colorize');
    if (!item) continue;
    assert.match(item.params.color, /^#[0-9a-f]{6}$/);
    seen.add(item.params.color);
    sampled++;
  }
  assert.equal(sampled, 20, 'colorize should turn up within 500 rolls');
  assert.ok(seen.size > 10, `random colours should vary, saw ${seen.size} across ${sampled}`);
});

test('a colour param round-trips through JSON', () => {
  const chain = [createItem('colorize', { color: '#12ab34', amount: 70 })];
  const parsed = chainFromJSON(chainToJSON({ chain, seed: 's' }));
  assert.equal(parsed.chain[0].params.color, '#12ab34');
  assert.equal(parsed.chain[0].params.amount, 70);
});

/** Default params for an effect, so tests can override just what they mean to. */
function defaults(id) {
  return normalizeParams(getEffect(id), {});
}

test('pixel sort max run is a share of the line, not a pixel count', () => {
  // A bright line with one long run: the cap decides how far a streak travels.
  const run = (width, percent) => {
    const img = image(width, 1, (x) => {
      // Descending so every sortable run visibly changes, and bright throughout
      // so the whole line is one candidate run.
      const v = 255 - Math.floor((x / width) * 60);
      return [v, v, v, 255];
    });
    getEffect('pixelsort').apply(img, {
      params: { direction: 'horizontal', threshold: 100, maxRun: percent, coverage: 100, reverse: false },
      rng: rng(),
    });
    // Sorting ascending within each capped block leaves a sawtooth; count the
    // resets to recover the block size.
    let resets = 0;
    for (let x = 1; x < width; x++) {
      if (at(img, x, 0)[0] < at(img, x - 1, 0)[0]) resets++;
    }
    return resets;
  };

  // The same percentage over a line twice as long yields the same number of
  // blocks — that is what makes the preview and the export agree.
  assert.equal(run(200, 25), run(400, 25), '25% should give the same structure at either size');
  assert.equal(run(200, 50), run(400, 50), '50% likewise');

  // And a smaller percentage means more, shorter runs.
  assert.ok(run(400, 10) > run(400, 50), 'a tighter cap should chop the line into more blocks');
});

test('pixel sort max run of 100% leaves the line uncapped', () => {
  const width = 64;
  const img = image(width, 1, (x) => { const v = 255 - x; return [v, v, v, 255]; });
  getEffect('pixelsort').apply(img, {
    params: { direction: 'horizontal', threshold: 0, maxRun: 100, coverage: 100, reverse: false },
    rng: rng(),
  });
  for (let x = 1; x < width; x++) {
    assert.ok(at(img, x, 0)[0] >= at(img, x - 1, 0)[0], 'one uncapped run sorts the whole line');
  }
});

test('pixel sort max run applies to the axis being sorted', () => {
  // A tall, narrow image: vertical sorting should cap against the height.
  const build = () => image(8, 200, (x, y) => { const v = 255 - Math.floor(y / 4); return [v, v, v, 255]; });
  const vertical = build();
  getEffect('pixelsort').apply(vertical, {
    params: { direction: 'vertical', threshold: 100, maxRun: 25, coverage: 100, reverse: false },
    rng: rng(),
  });
  let resets = 0;
  for (let y = 1; y < 200; y++) if (at(vertical, 0, y)[0] < at(vertical, 0, y - 1)[0]) resets++;
  assert.ok(resets >= 3, `25% of 200px should chop the column into ~4 blocks, saw ${resets + 1}`);
});

test('a version 1 preset still loads, losing only the renamed param', () => {
  // maxLength was pixels; maxRun is a percentage. Reinterpreting 400 as 400%
  // would clamp to 100% — a whole uncapped line — so the old key is dropped
  // and the default applies instead.
  const parsed = chainFromJSON(JSON.stringify({
    format: 'imagizer.chain',
    version: 1,
    seed: 'old-preset',
    effects: [{ id: 'pixelsort', params: { maxLength: 400, threshold: 90, reverse: true } }],
  }));

  assert.equal(parsed.dropped, 0, 'the effect itself still loads');
  assert.equal(parsed.seed, 'old-preset');
  const params = parsed.chain[0].params;
  assert.equal(params.maxRun, getEffect('pixelsort').params.find((p) => p.key === 'maxRun').default);
  assert.equal(params.maxLength, undefined, 'the old key is gone, not carried along');
  assert.equal(params.threshold, 90, 'everything else survives');
  assert.equal(params.reverse, true);
});

test('a version 2 preset still loads, falling back to the merged cell size', () => {
  // Two keys cannot merge into one without guessing which axis the user meant,
  // and either guess silently changes the other, so the default applies.
  const parsed = chainFromJSON(JSON.stringify({
    format: 'imagizer.chain',
    version: 2,
    effects: [{ id: 'gridgate', params: { cellWidth: 20, cellHeight: 4, aperture: 35, shape: 'circle' } }],
  }));

  assert.equal(parsed.dropped, 0, 'the effect itself still loads');
  const params = parsed.chain[0].params;
  assert.equal(params.cell, getEffect('gridgate').params.find((p) => p.key === 'cell').default);
  assert.equal(params.cellWidth, undefined, 'the old keys are gone, not carried along');
  assert.equal(params.cellHeight, undefined);
  assert.equal(params.aperture, 35, 'everything else survives');
  assert.equal(params.shape, 'circle');
});

// ---------- vignette, spotlight ----------

const flat = (w, h) => image(w, h, () => [200, 200, 200, 255]);
const bright = (img, x, y) => at(img, x, y)[0];

for (const id of ['vignette', 'spotlight']) {
  test(`${id} darkens the edges and leaves the centre alone`, () => {
    const img = flat(64, 64);
    getEffect(id).apply(img, { params: defaults(id), rng: rng() });
    assert.equal(bright(img, 32, 32), 200, 'the centre should be untouched');
    assert.ok(bright(img, 0, 0) < 200, 'the corner should darken');
    assert.ok(bright(img, 0, 0) < bright(img, 16, 16), 'darker the further out you go');
  });

  test(`${id} falls off monotonically from the centre`, () => {
    const img = flat(80, 80);
    getEffect(id).apply(img, { params: defaults(id), rng: rng() });
    let previous = Infinity;
    for (let x = 40; x < 80; x++) {
      const value = bright(img, x, 40);
      assert.ok(value <= previous + 0.5, `brightness rose again at x=${x}`);
      previous = value;
    }
  });

  test(`${id} at zero strength changes nothing`, () => {
    const img = flat(32, 32);
    const copy = [...img.data];
    getEffect(id).apply(img, { params: { ...defaults(id), strength: 0 }, rng: rng() });
    assert.deepEqual([...img.data], copy);
  });

  test(`${id} leaves alpha alone`, () => {
    const img = image(32, 32, (x) => [200, 200, 200, x < 16 ? 255 : 64]);
    getEffect(id).apply(img, { params: defaults(id), rng: rng() });
    assert.equal(at(img, 0, 0)[3], 255);
    assert.equal(at(img, 31, 0)[3], 64);
  });

  test(`${id} reaches full strength past the falloff`, () => {
    const img = flat(64, 64);
    getEffect(id).apply(img, {
      params: { ...defaults(id), strength: 100, softness: 0, ...(id === 'vignette' ? { size: 10 } : { radius: 10 }) },
      rng: rng(),
    });
    assert.equal(bright(img, 0, 0), 0, 'full strength should reach black');
  });
}

test('vignette follows the frame; spotlight stays a circle', () => {
  // Odd dimensions so the centre lands on an exact pixel — with even sizes the
  // centre sits on a half-pixel and two "equal" offsets differ by a whole one,
  // which looks like a broken circle when it is a broken measurement.
  const width = 201;
  const height = 81;
  const cx = 100;
  const cy = 40;
  const offset = 30;

  const run = (id, params) => {
    const img = flat(width, height);
    getEffect(id).apply(img, { params: { ...defaults(id), ...params }, rng: rng() });
    return {
      across: bright(img, cx + offset, cy),
      down: bright(img, cx, cy - offset),
      edgeX: bright(img, width - 1, cy),
      edgeY: bright(img, cx, 0),
    };
  };

  // Spotlight scales both axes alike, so equal pixel offsets darken equally.
  const spot = run('spotlight', { radius: 20, softness: 90 });
  assert.equal(spot.across, spot.down, `spotlight should be circular, got ${JSON.stringify(spot)}`);
  assert.ok(spot.across < 200, 'the sample points need to be inside the falloff to prove anything');

  // Vignette normalises per axis, so 30px is a far larger share of the short
  // side and darkens more there.
  const vig = run('vignette', { size: 0, softness: 100 });
  assert.ok(vig.down < vig.across, `vignette should follow the frame, got ${JSON.stringify(vig)}`);
  assert.ok(vig.across < 200, 'both samples should be inside the falloff');

  // ...and for a vignette every edge midpoint is the same distance out.
  assert.equal(vig.edgeX, vig.edgeY, 'vignette edge midpoints should match');
});

test('vignette size pushes the falloff outward', () => {
  const measure = (size) => {
    const img = flat(64, 64);
    getEffect('vignette').apply(img, { params: { ...defaults('vignette'), size, softness: 30 }, rng: rng() });
    return bright(img, 8, 32);
  };
  assert.ok(measure(20) < measure(80), 'a bigger clear area should leave more of the frame bright');
});

test('spotlight radius grows the lit circle', () => {
  const measure = (radius) => {
    const img = flat(64, 64);
    getEffect('spotlight').apply(img, { params: { ...defaults('spotlight'), radius, softness: 20 }, rng: rng() });
    return bright(img, 16, 32);
  };
  assert.ok(measure(20) < measure(90), 'a bigger radius should leave more of the frame lit');
});

test('softness controls how abruptly the darkening arrives', () => {
  const edges = (softness) => {
    const img = flat(80, 80);
    getEffect('spotlight').apply(img, {
      params: { ...defaults('spotlight'), strength: 100, radius: 40, softness },
      rng: rng(),
    });
    // Count the distinct brightnesses along a radius: a hard edge gives two.
    const values = new Set();
    for (let x = 40; x < 80; x++) values.add(bright(img, x, 40));
    return values.size;
  };
  assert.ok(edges(0) <= 3, `no softness should give a hard edge, saw ${edges(0)} tones`);
  assert.ok(edges(60) > 8, `softness should give a gradient, saw ${edges(60)} tones`);
});

test('neither effect needs randomness', () => {
  for (const id of ['vignette', 'spotlight']) {
    const run = (seed) => {
      const img = flat(32, 32);
      getEffect(id).apply(img, { params: defaults(id), rng: createRng(seed) });
      return [...img.data];
    };
    assert.deepEqual(run('one'), run('two'), `${id} should not depend on the seed`);
  }
});

test('the falloff survives a 1px image without dividing by zero', () => {
  for (const id of ['vignette', 'spotlight']) {
    const img = image(1, 1, () => [200, 200, 200, 255]);
    getEffect(id).apply(img, { params: defaults(id), rng: rng() });
    assert.ok(Number.isFinite(at(img, 0, 0)[0]), `${id} produced a non-finite pixel`);
  }
});

// ---------- channel sort ----------

/** Independent per-channel values, all bright enough to clear a 0 threshold. */
const channels = (x, y) => [
  30 + ((x * 97 + y * 11) % 220),
  30 + ((x * 53 + y * 29) % 220),
  30 + ((x * 31 + y * 71) % 220),
  255,
];

const channelOf = (img, index) =>
  [...img.data].filter((_, i) => i % 4 === index);

const sortParams = (over = {}) => ({
  channel: 'red', direction: 'horizontal', threshold: 0,
  maxRun: 100, coverage: 100, reverse: false, ...over,
});

test('channel sort moves only the channel it was given', () => {
  for (const [name, index] of [['red', 0], ['green', 1], ['blue', 2]]) {
    const img = image(40, 12, channels);
    const before = [0, 1, 2, 3].map((i) => channelOf(img, i));

    getEffect('channelsort').apply(img, { params: sortParams({ channel: name }), rng: rng() });

    for (const other of [0, 1, 2, 3]) {
      const after = channelOf(img, other);
      if (other === index) {
        assert.notDeepEqual(after, before[other], `${name} channel should have moved`);
      } else {
        assert.deepEqual(after, before[other], `${name} sort disturbed channel ${other}`);
      }
    }
  }
});

test('channel sort leaves the run sorted in that channel', () => {
  const img = image(48, 1, channels);
  getEffect('channelsort').apply(img, { params: sortParams({ channel: 'green' }), rng: rng() });
  for (let x = 1; x < 48; x++) {
    assert.ok(at(img, x, 1 - 1)[1] >= at(img, x - 1, 0)[1], `green descended at x=${x}`);
  }
});

test('channel sort reverses, and works vertically', () => {
  const down = image(1, 48, channels);
  getEffect('channelsort').apply(down, {
    params: sortParams({ channel: 'blue', direction: 'vertical', reverse: true }),
    rng: rng(),
  });
  for (let y = 1; y < 48; y++) {
    assert.ok(at(down, 0, y)[2] <= at(down, 0, y - 1)[2], `blue rose at y=${y}`);
  }
});

test('channel sort thresholds on its channel, not luminance', () => {
  // Saturated red: high in the red channel (178-240), low in luminance (~51).
  // Descending, so sorting it ascending is guaranteed to change something — an
  // already-ascending fixture makes the sort a no-op and the test vacuous.
  const reds = (x) => [240 - x * 2, 0, 0, 255];

  const byChannel = image(32, 1, reds);
  getEffect('channelsort').apply(byChannel, { params: sortParams({ channel: 'red', threshold: 150 }), rng: rng() });

  const byLuma = image(32, 1, reds);
  getEffect('pixelsort').apply(byLuma, {
    params: { direction: 'horizontal', threshold: 150, maxRun: 100, coverage: 100, reverse: false },
    rng: rng(),
  });

  const original = channelOf(image(32, 1, reds), 0);
  assert.notDeepEqual(channelOf(byChannel, 0), original, 'the red channel clears a red threshold');
  assert.deepEqual(channelOf(byLuma, 0), original, 'the same pixels never clear a luminance threshold');
});

test('channel sort invents colours; pixel sort only rearranges them', () => {
  const tuples = (img) => {
    const set = new Set();
    for (let i = 0; i < img.data.length; i += 4) {
      set.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    }
    return set;
  };

  const original = tuples(image(40, 8, channels));

  const sorted = image(40, 8, channels);
  getEffect('pixelsort').apply(sorted, {
    params: { direction: 'horizontal', threshold: 0, maxRun: 100, coverage: 100, reverse: false },
    rng: rng(),
  });
  for (const colour of tuples(sorted)) {
    assert.ok(original.has(colour), `pixel sort produced a new colour: ${colour}`);
  }

  const torn = image(40, 8, channels);
  getEffect('channelsort').apply(torn, { params: sortParams(), rng: rng() });
  const invented = [...tuples(torn)].filter((colour) => !original.has(colour));
  assert.ok(invented.length > 0, 'channel sort should pull pixels apart into new colours');
});

test('channel sort follows the seed and varies with it', () => {
  const run = (seed) => {
    const img = image(40, 40, channels);
    getEffect('channelsort').apply(img, {
      params: sortParams({ threshold: 100, maxRun: 40, coverage: 50 }),
      rng: createRng(seed),
    });
    return [...img.data].join(',');
  };
  assert.equal(run('alpha'), run('alpha'));
  assert.notEqual(run('alpha'), run('beta'));
});

test('each channel choice gives a different result', () => {
  const run = (channel) => {
    const img = image(40, 12, channels);
    getEffect('channelsort').apply(img, { params: sortParams({ channel }), rng: rng() });
    return [...img.data].join(',');
  };
  const results = ['red', 'green', 'blue'].map(run);
  assert.equal(new Set(results).size, 3, 'the three channels should not agree');
});

test('channel sort shares the run rules with pixel sort', () => {
  // Max run is a share of the line here too, so the structure is resolution
  // independent in the same way.
  const runs = (width, percent) => {
    const img = image(width, 1, (x) => { const v = 250 - Math.floor((x / width) * 40); return [v, 20, 20, 255]; });
    getEffect('channelsort').apply(img, {
      params: sortParams({ channel: 'red', threshold: 100, maxRun: percent }),
      rng: rng(),
    });
    let resets = 0;
    for (let x = 1; x < width; x++) if (at(img, x, 0)[0] < at(img, x - 1, 0)[0]) resets++;
    return resets;
  };
  assert.equal(runs(200, 25), runs(400, 25), 'same share, same structure at either size');
});

// ---------- slicer ----------

/** Content with no magenta in it, so the gap colour is unambiguous. */
const slicable = (x, y) => [20 + ((x * 7) % 200), 40 + ((y * 5) % 180), 60, 255];

const GAP = '#ff00ff';

const slicerParams = (over = {}) => ({
  direction: 'horizontal', size: 10, jitter: 0, shift: 30,
  transparent: false, background: GAP, ...over,
});

/**
 * Recover each line's displacement by counting gap pixels. A band shifted right
 * leaves its gap on the left and vice versa, so the run of fill at either end
 * gives the signed offset.
 */
function offsets(img, vertical = false) {
  const lines = vertical ? img.width : img.height;
  const length = vertical ? img.height : img.width;
  const isGap = (i, l) => {
    const [r, g, b] = vertical ? at(img, l, i) : at(img, i, l);
    return r === 255 && g === 0 && b === 255;
  };

  return Array.from({ length: lines }, (_, l) => {
    let lead = 0;
    while (lead < length && isGap(lead, l)) lead++;
    if (lead > 0) return lead;
    let trail = 0;
    while (trail < length && isGap(length - 1 - trail, l)) trail++;
    return -trail;
  });
}

test('slicer with no shift leaves the image untouched', () => {
  const img = image(60, 60, slicable);
  const copy = [...img.data];
  getEffect('slicer').apply(img, { params: slicerParams({ shift: 0 }), rng: rng() });
  assert.deepEqual([...img.data], copy);
});

test('slicer shifts whole bands together', () => {
  const img = image(80, 60, slicable);
  getEffect('slicer').apply(img, { params: slicerParams(), rng: rng() });

  const found = offsets(img);
  assert.ok(found.some((o) => o !== 0), 'something should have moved');

  // Every boundary — a row whose offset differs from the one above — must fall
  // on a multiple of the band size when jitter is off.
  const bandSize = Math.round((60 * 10) / 100);
  for (let y = 1; y < found.length; y++) {
    if (found[y] !== found[y - 1]) {
      assert.equal(y % bandSize, 0, `band boundary at row ${y} is not a multiple of ${bandSize}`);
    }
  }
});

test('slicer jitter makes the bands uneven', () => {
  const img = image(80, 120, slicable);
  getEffect('slicer').apply(img, { params: slicerParams({ size: 10, jitter: 80 }), rng: rng() });

  const found = offsets(img);
  const bandSize = Math.round((120 * 10) / 100);
  const boundaries = [];
  for (let y = 1; y < found.length; y++) if (found[y] !== found[y - 1]) boundaries.push(y);

  assert.ok(boundaries.length > 2, 'expected several bands');
  assert.ok(
    boundaries.some((y) => y % bandSize !== 0),
    `jitter should break the regular grid, boundaries: ${boundaries}`,
  );
});

test('slicer keeps each band intact, just moved', () => {
  const original = image(80, 60, slicable);
  const img = image(80, 60, slicable);
  getEffect('slicer').apply(img, { params: slicerParams(), rng: rng() });

  const found = offsets(img);
  for (let y = 0; y < 60; y++) {
    const shift = found[y];
    for (let x = 0; x < 80; x++) {
      const source = x - shift;
      if (source < 0 || source >= 80) continue;   // that is gap, checked elsewhere
      assert.deepEqual(at(img, x, y), at(original, source, y), `row ${y} scrambled at x=${x}`);
    }
  }
});

test('slicer gaps are transparent when asked, and filled when not', () => {
  const clear = image(60, 60, slicable);
  getEffect('slicer').apply(clear, { params: slicerParams({ transparent: true }), rng: rng() });
  let sawGap = false;
  for (let i = 0; i < clear.data.length; i += 4) {
    if (clear.data[i + 3] === 0) { sawGap = true; break; }
  }
  assert.ok(sawGap, 'transparent gaps should punch through');

  const filled = image(60, 60, slicable);
  getEffect('slicer').apply(filled, { params: slicerParams({ transparent: false }), rng: rng() });
  for (let i = 0; i < filled.data.length; i += 4) {
    assert.equal(filled.data[i + 3], 255, 'a filled slicer should leave nothing transparent');
  }
  const found = offsets(filled);
  const shifted = found.findIndex((o) => o > 0);
  assert.ok(shifted >= 0, 'need a right-shifted band to inspect');
  assert.deepEqual(at(filled, 0, shifted), [255, 0, 255, 255], 'the gap takes the chosen colour');
});

test('slicer band size controls how many bands there are', () => {
  const count = (size) => {
    const img = image(80, 120, slicable);
    getEffect('slicer').apply(img, { params: slicerParams({ size, jitter: 0 }), rng: rng() });
    const found = offsets(img);
    let boundaries = 0;
    for (let y = 1; y < found.length; y++) if (found[y] !== found[y - 1]) boundaries++;
    return boundaries;
  };
  assert.ok(count(4) > count(25), 'smaller bands should give more of them');
});

test('slicer works along either axis, and the two differ', () => {
  const horizontal = image(80, 80, slicable);
  getEffect('slicer').apply(horizontal, { params: slicerParams({ direction: 'horizontal' }), rng: rng() });

  const vertical = image(80, 80, slicable);
  getEffect('slicer').apply(vertical, { params: slicerParams({ direction: 'vertical' }), rng: rng() });

  assert.notDeepEqual([...horizontal.data], [...vertical.data]);

  // Vertical bands are columns displaced up and down.
  const columnOffsets = offsets(vertical, true);
  assert.ok(columnOffsets.some((o) => o !== 0), 'columns should have moved');

  // ...and a horizontal slice leaves whole rows intact vertically.
  const rowOffsets = offsets(horizontal);
  assert.ok(rowOffsets.some((o) => o !== 0), 'rows should have moved');
});

test('slicer follows the seed and varies with it', () => {
  const run = (seed) => {
    const img = image(60, 60, slicable);
    getEffect('slicer').apply(img, { params: slicerParams(), rng: createRng(seed) });
    return [...img.data].join(',');
  };
  assert.equal(run('alpha'), run('alpha'));
  assert.notEqual(run('alpha'), run('beta'));
});

test('slicer shift is a share of the line, not a pixel count', () => {
  const widest = (width) => {
    const img = image(width, 40, slicable);
    getEffect('slicer').apply(img, { params: slicerParams({ shift: 25, jitter: 0 }), rng: rng() });
    return Math.max(...offsets(img).map(Math.abs)) / width;
  };
  // The largest displacement should be the same fraction of either width.
  assert.ok(Math.abs(widest(200) - widest(400)) < 0.02, 'shift should scale with the line');
});

// ---------- grid gate ----------

const gateParams = (over = {}) => ({
  shape: 'square', cell: 10, aperture: 50,
  transparent: true, background: '#ff00ff', ...over,
});

/** Which pixels survived, as a boolean grid. */
function passMap(img) {
  return Array.from({ length: img.height }, (_, y) =>
    Array.from({ length: img.width }, (_, x) => at(img, x, y)[3] !== 0));
}

const passRate = (img) => {
  const map = passMap(img).flat();
  return map.filter(Boolean).length / map.length;
};

test('grid gate at full aperture lets a square grid through untouched', () => {
  const img = image(60, 60, slicable);
  const copy = [...img.data];
  getEffect('gridgate').apply(img, { params: gateParams({ aperture: 100 }), rng: rng() });
  assert.deepEqual([...img.data], copy, 'a wide-open square gate should be a no-op');
});

test('grid gate blocks the expected share of the image', () => {
  // A square aperture passes `open` of each axis, so open^2 of the area.
  for (const aperture of [40, 60, 80]) {
    const img = image(200, 200, slicable);
    getEffect('gridgate').apply(img, { params: gateParams({ aperture }), rng: rng() });
    const expected = (aperture / 100) ** 2;
    assert.ok(Math.abs(passRate(img) - expected) < 0.06,
      `square at ${aperture}%: passed ${passRate(img).toFixed(3)}, expected ~${expected.toFixed(3)}`);
  }

  // A circle inscribed in the cell covers pi/4 of it.
  const dots = image(200, 200, slicable);
  getEffect('gridgate').apply(dots, { params: gateParams({ shape: 'circle', aperture: 100 }), rng: rng() });
  assert.ok(Math.abs(passRate(dots) - Math.PI / 4) < 0.03,
    `circle at 100%: passed ${passRate(dots).toFixed(3)}, expected ~${(Math.PI / 4).toFixed(3)}`);
});

test('grid gate repeats exactly every cell', () => {
  const img = image(120, 120, slicable);
  getEffect('gridgate').apply(img, { params: gateParams({ cell: 10 }), rng: rng() });

  const map = passMap(img);
  const cell = Math.round((120 * 10) / 100);

  for (let y = 0; y < 120 - cell; y++) {
    for (let x = 0; x < 120 - cell; x++) {
      assert.equal(map[y][x], map[y][x + cell], `column pattern broke at ${x},${y}`);
      assert.equal(map[y][x], map[y + cell][x], `row pattern broke at ${x},${y}`);
    }
  }
});

test('one size keeps the cells square on a crop that is not', () => {
  // The point of a single slider: measured against the shorter side, the
  // period is the same number of pixels both ways. A percentage per axis would
  // stretch the cells with the frame and turn the square aperture into a
  // rectangle.
  const img = image(240, 80, slicable);
  getEffect('gridgate').apply(img, { params: gateParams({ cell: 25 }), rng: rng() });

  const map = passMap(img);
  const cell = Math.round((80 * 25) / 100);
  for (let y = 0; y < 80 - cell; y++) {
    for (let x = 0; x < 240 - cell; x++) {
      assert.equal(map[y][x], map[y][x + cell], `horizontal period is not ${cell} at ${x},${y}`);
      assert.equal(map[y][x], map[y + cell][x], `vertical period is not ${cell} at ${x},${y}`);
    }
  }
});

test('grid gate leaves the pixels it passes completely alone', () => {
  const original = image(80, 80, slicable);
  const img = image(80, 80, slicable);
  getEffect('gridgate').apply(img, { params: gateParams(), rng: rng() });

  let passed = 0;
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      if (at(img, x, y)[3] === 0) continue;
      assert.deepEqual(at(img, x, y), at(original, x, y), `pixel ${x},${y} was altered`);
      passed++;
    }
  }
  assert.ok(passed > 0, 'something should have passed');
});

test('grid gate blocks to transparency or to a colour', () => {
  const clear = image(60, 60, slicable);
  getEffect('gridgate').apply(clear, { params: gateParams({ transparent: true }), rng: rng() });
  assert.ok(passRate(clear) < 1, 'some pixels should be blocked');

  const filled = image(60, 60, slicable);
  getEffect('gridgate').apply(filled, { params: gateParams({ transparent: false }), rng: rng() });

  let blocked = 0;
  for (let i = 0; i < filled.data.length; i += 4) {
    assert.equal(filled.data[i + 3], 255, 'a filled gate should leave nothing transparent');
    if (filled.data[i] === 255 && filled.data[i + 1] === 0 && filled.data[i + 2] === 255) blocked++;
  }
  // The same cells are blocked either way, just filled differently.
  const clearBlocked = passMap(clear).flat().filter((p) => !p).length;
  assert.equal(blocked, clearBlocked, 'the pattern should not depend on how gaps are filled');
});

test('cell size sets the pattern period', () => {
  const period = (cell) => {
    const img = image(200, 200, slicable);
    getEffect('gridgate').apply(img, { params: gateParams({ cell }), rng: rng() });
    // Count transitions across the whole map, not one row: a single row can
    // land on a cell boundary and be uniformly blocked, which says nothing
    // about the period.
    const map = passMap(img);
    let changes = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 1; x < 200; x++) if (map[y][x] !== map[y][x - 1]) changes++;
    }
    return changes;
  };
  assert.ok(period(5) > period(20), 'smaller cells should switch more often');
});

test('grid gate is fixed: no randomness, so the seed does not matter', () => {
  const run = (seed) => {
    const img = image(60, 60, slicable);
    getEffect('gridgate').apply(img, { params: gateParams(), rng: createRng(seed) });
    return [...img.data];
  };
  assert.deepEqual(run('one'), run('two'));
});

test('grid gate survives an image smaller than one cell', () => {
  const img = image(1, 1, () => [10, 20, 30, 255]);
  getEffect('gridgate').apply(img, { params: gateParams(), rng: rng() });
  assert.ok(Number.isFinite(at(img, 0, 0)[0]));
});

// ---------- posterize ----------

const distinct = (img, offset) => new Set([...img.data].filter((_, i) => i % 4 === offset));

test('posterize reduces each channel to the requested levels', () => {
  for (const levels of [2, 3, 5, 8]) {
    const img = image(256, 16, (x) => [x, 255 - x, (x * 3) % 256, 255]);
    getEffect('posterize').apply(img, { params: { mode: 'channel', levels }, rng: rng() });
    for (const channel of [0, 1, 2]) {
      assert.ok(distinct(img, channel).size <= levels,
        `${levels} levels gave ${distinct(img, channel).size} tones in channel ${channel}`);
    }
  }
});

test('posterize at two levels is black and white per channel', () => {
  const img = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('posterize').apply(img, { params: { mode: 'channel', levels: 2 }, rng: rng() });
  assert.deepEqual([...distinct(img, 0)].sort((a, b) => a - b), [0, 255]);
  assert.deepEqual(at(img, 10, 0).slice(0, 3), [0, 0, 0]);
  assert.deepEqual(at(img, 250, 0).slice(0, 3), [255, 255, 255]);
});

test('posterize snaps to the nearest level, not down to it', () => {
  // Five levels means steps of 63.75: 0, 64, 128, 191, 255.
  const img = image(4, 1, (x) => { const v = [0, 60, 130, 255][x]; return [v, v, v, 255]; });
  getEffect('posterize').apply(img, { params: { mode: 'channel', levels: 5 }, rng: rng() });
  assert.equal(at(img, 0, 0)[0], 0);
  assert.equal(at(img, 1, 0)[0], 64, '60 should round up to 64, not down to 0');
  assert.equal(at(img, 2, 0)[0], 128);
  assert.equal(at(img, 3, 0)[0], 255);
});

test('luminance mode keeps hue while stepping the tone', () => {
  // A ramp of one hue: channel ratios must survive, tones must collapse.
  const img = image(64, 1, (x) => [x * 4, x * 2, 0, 255]);
  getEffect('posterize').apply(img, { params: { mode: 'luma', levels: 4 }, rng: rng() });

  const lumas = new Set();
  let checked = 0;
  for (let x = 0; x < 64; x++) {
    const [r, g, b] = at(img, x, 0);
    lumas.add(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
    assert.equal(b, 0, 'a channel at zero should stay at zero');
    if (r < 4) continue;                       // too dark to carry a ratio
    if (r === 255 || g === 255) continue;      // clipped, see below
    assert.ok(Math.abs(g / r - 0.5) < 0.06, `hue drifted at x=${x}: ${[r, g, b]}`);
    checked++;
  }
  assert.ok(checked > 10, 'the ratio check needs unclipped pixels to be worth anything');
  assert.ok(lumas.size <= 5, `expected about 4 tones, got ${lumas.size}`);
});

test('luminance mode clips when it brightens a saturated colour', () => {
  // Landing on the next level up can push a channel past 255. It clips there
  // and the hue shifts a little; staying under would miss the level instead.
  const img = image(1, 1, () => [224, 112, 0, 255]);
  getEffect('posterize').apply(img, { params: { mode: 'luma', levels: 4 }, rng: rng() });
  const [r, g] = at(img, 0, 0);
  assert.equal(r, 255, 'red should have clipped');
  assert.ok(g / r > 0.5, 'the clipped channel skews the ratio, by design');
});

test('luminance mode keeps more colours than per-channel does', () => {
  const colours = (mode) => {
    const img = image(64, 64, (x, y) => [x * 4, y * 4, ((x + y) * 2) % 256, 255]);
    getEffect('posterize').apply(img, { params: { mode, levels: 4 }, rng: rng() });
    const set = new Set();
    for (let i = 0; i < img.data.length; i += 4) set.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    return set.size;
  };
  // Per channel can only ever make levels^3 = 64 combinations; luminance mode
  // preserves each pixel's own ratios, so far more survive.
  assert.ok(colours('channel') <= 64, `per channel gave ${colours('channel')} colours`);
  assert.ok(colours('luma') > colours('channel'), 'luminance mode should keep more colours');
});

test('posterize leaves alpha alone in both modes', () => {
  for (const mode of ['channel', 'luma']) {
    const img = image(16, 1, (x) => [x * 16, 100, 200, x < 8 ? 255 : 40]);
    getEffect('posterize').apply(img, { params: { mode, levels: 4 }, rng: rng() });
    assert.equal(at(img, 2, 0)[3], 255, mode);
    assert.equal(at(img, 12, 0)[3], 40, mode);
  }
});

test('posterize is fixed: the seed makes no difference', () => {
  for (const mode of ['channel', 'luma']) {
    const run = (seed) => {
      const img = image(32, 32, (x, y) => [x * 8, y * 8, 120, 255]);
      getEffect('posterize').apply(img, { params: { mode, levels: 5 }, rng: createRng(seed) });
      return [...img.data];
    };
    assert.deepEqual(run('one'), run('two'), mode);
  }
});

test('posterize at two levels matches a threshold, given greyscale input', () => {
  const posterized = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('posterize').apply(posterized, { params: { mode: 'luma', levels: 2 }, rng: rng() });

  const thresholded = image(256, 1, (x) => [x, x, x, 255]);
  getEffect('threshold').apply(thresholded, { params: { level: 128, softness: 0, invert: false }, rng: rng() });

  // Both snap at the midpoint; posterize rounds 128 up, threshold takes >= 128.
  for (const x of [0, 60, 127, 129, 200, 255]) {
    assert.deepEqual(at(posterized, x, 0), at(thresholded, x, 0), `differed at x=${x}`);
  }
});

test('slicer cross shift moves bands across the stack', () => {
  const vacated = (crossShift) => {
    const img = image(60, 120, slicable);
    getEffect('slicer').apply(img, {
      params: slicerParams({ shift: 20, crossShift, transparent: true }),
      rng: rng(),
    });
    // A row nothing landed on is entirely transparent — only possible once a
    // band has moved off its own row.
    let empty = 0;
    for (let y = 0; y < 120; y++) {
      let all = true;
      for (let x = 0; x < 60; x++) if (at(img, x, y)[3] !== 0) { all = false; break; }
      if (all) empty++;
    }
    return empty;
  };

  assert.equal(vacated(0), 0, 'without cross shift every row keeps its own band');
  assert.ok(vacated(30) > 0, 'with cross shift some rows are left empty');
});

test('slicer cross shift lands a band on a different line', () => {
  const original = image(40, 80, slicable);
  const img = image(40, 80, slicable);
  getEffect('slicer').apply(img, {
    params: slicerParams({ shift: 0, crossShift: 25, transparent: true }),
    rng: rng(),
  });

  // With no along-shift, any row that received a band holds some other row's
  // pixels verbatim — find one that is not its own.
  let moved = 0;
  for (let y = 0; y < 80; y++) {
    if (at(img, 0, y)[3] === 0) continue;
    const sameAsOwn = at(img, 0, y).join() === at(original, 0, y).join();
    if (!sameAsOwn) moved++;
  }
  assert.ok(moved > 0, 'some rows should be showing another row of the image');
});

test('slicer with both shifts at zero is still a no-op', () => {
  const img = image(60, 60, slicable);
  const copy = [...img.data];
  getEffect('slicer').apply(img, {
    params: slicerParams({ shift: 0, crossShift: 0 }),
    rng: rng(),
  });
  assert.deepEqual([...img.data], copy);
});

test('a param can declare when it applies', () => {
  // The gap colour is meaningless while gaps are transparent, so it says so.
  for (const id of ['slicer', 'gridgate']) {
    const spec = getEffect(id).params.find((p) => p.key === 'background');
    assert.equal(typeof spec.showWhen, 'function', `${id} gap colour should be conditional`);
    assert.equal(spec.showWhen({ transparent: true }), false);
    assert.equal(spec.showWhen({ transparent: false }), true);
  }
});

// ---------- chromatic aberration ----------

/**
 * A horizontal grey ramp. Every pixel has R = G = B, so any red/blue difference
 * afterwards is the aberration and nothing else — and because the ramp is
 * linear, that difference is proportional to how far the two channels moved
 * apart, which makes the fringe directly measurable.
 */
const rampAcross = (width) => (x) => {
  const v = Math.round((x / (width - 1)) * 255);
  return [v, v, v, 255];
};

/** Red-minus-blue at a pixel: zero on the source, the fringe width after. */
const fringe = (img, x, y) => {
  const [r, , b] = at(img, x, y);
  return Math.abs(r - b);
};

const aberrate = (over = {}, size = 81) => {
  const img = image(size, size, rampAcross(size));
  getEffect('chromatic').apply(img, { params: { ...defaults('chromatic'), ...over }, rng: rng() });
  return img;
};

test('chromatic aberration leaves the optical centre alone', () => {
  // Odd dimensions so the centre is a real pixel rather than a half-pixel.
  const img = aberrate({ amount: 8 });
  assert.equal(fringe(img, 40, 40), 0, 'no fringe at the centre');
  assert.ok(fringe(img, 44, 40) < fringe(img, 76, 40), 'the fringe grows outward');
});

test('chromatic aberration fringes widen toward the edge', () => {
  const img = aberrate({ amount: 8, bias: 1 });
  let previous = -1;
  // Along the centre row, so the displacement is purely horizontal and the ramp
  // measures all of it.
  for (const x of [44, 52, 60, 68, 76]) {
    const value = fringe(img, x, 40);
    assert.ok(value >= previous, `fringe shrank again at x=${x}: ${value} after ${previous}`);
    previous = value;
  }
  assert.ok(previous > 4, `the outer fringe should be clearly visible, got ${previous}`);
});

test('edge bias keeps the middle of the frame clean', () => {
  const gentle = aberrate({ amount: 8, bias: 1 });
  const biased = aberrate({ amount: 8, bias: 3 });
  assert.ok(
    fringe(biased, 60, 40) < fringe(gentle, 60, 40),
    'a higher bias should pull fringing out of the mid-frame',
  );
});

test('the fringe pairs move in opposite directions', () => {
  const forward = aberrate({ amount: 8, fringe: 'red-blue' });
  const back = aberrate({ amount: 8, fringe: 'blue-red' });
  const [r1, , b1] = at(forward, 76, 40);
  const [r2, , b2] = at(back, 76, 40);
  assert.deepEqual([r2, b2], [b1, r1], 'swapping the pair should swap the channels');
});

test('the green fringe moves green against both others', () => {
  const img = aberrate({ amount: 8, fringe: 'green-magenta' });
  const [r, g, b] = at(img, 76, 40);
  assert.equal(r, b, 'red and blue move together as magenta');
  assert.notEqual(g, r, 'green moves the other way');
});

test('chromatic aberration at zero amount changes nothing', () => {
  const img = image(41, 41, rampAcross(41));
  const copy = [...img.data];
  getEffect('chromatic').apply(img, { params: { ...defaults('chromatic'), amount: 0 }, rng: rng() });
  assert.deepEqual([...img.data], copy);
});

test('chromatic aberration keeps the cutout it was given', () => {
  const img = image(41, 41, (x) => [255, 200, 100, x < 20 ? 255 : 0]);
  getEffect('chromatic').apply(img, { params: { ...defaults('chromatic'), amount: 10 }, rng: rng() });
  for (let y = 0; y < 41; y += 8) {
    assert.equal(at(img, 2, y)[3], 255, 'opaque side stays opaque');
    assert.equal(at(img, 38, y)[3], 0, 'transparent side stays transparent');
  }
  // The fringe next to the cutout takes the colour of what is actually there,
  // not the transparent black beyond it.
  const [r, g, b] = at(img, 18, 20);
  assert.ok(r > 100 && g > 80 && b > 20, `edge went dark: ${[r, g, b]}`);
});

// ---------- channel shift ----------

/** A single bright column, so a shift is a position to read off. */
const marker = (width, height, column) =>
  image(width, height, (x) => (x === column ? [255, 255, 255, 255] : [0, 0, 0, 255]));

const shiftParams = (over = {}) => ({ ...defaults('channelshift'), ...over });

/** Columns where the given channel is lit. */
const litColumns = (img, channel) => {
  const out = [];
  for (let x = 0; x < img.width; x++) if (at(img, x, 0)[channel] > 128) out.push(x);
  return out;
};

test('channel shift moves the chosen channel by a share of the width', () => {
  const img = marker(100, 4, 10);
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'red', x: 10, y: 0 }), rng: rng() });
  assert.deepEqual(litColumns(img, 0), [20], 'red moved ten percent of 100px');
  assert.deepEqual(litColumns(img, 1), [10], 'green stayed put');
  assert.deepEqual(litColumns(img, 2), [10], 'blue stayed put');
});

test('a negative shift moves the other way', () => {
  const img = marker(100, 4, 40);
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'blue', x: -25 }), rng: rng() });
  assert.deepEqual(litColumns(img, 2), [15]);
});

test('channel shift moves rows on the y axis', () => {
  const img = image(4, 100, (x, y) => (y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'green', x: 0, y: 20 }), rng: rng() });
  const rows = [];
  for (let y = 0; y < 100; y++) if (at(img, 0, y)[1] > 128) rows.push(y);
  assert.deepEqual(rows, [30]);
});

test('wrapping brings the channel back around the far edge', () => {
  const img = marker(100, 4, 95);
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'red', x: 10, wrap: true }), rng: rng() });
  assert.deepEqual(litColumns(img, 0), [5], 'it came back around the left');
});

test('without wrapping the vacated strip takes the edge value', () => {
  // Left edge is red, everything else black. Shifting right by 10% with no wrap
  // should smear that red edge across the strip rather than leave a black band.
  const img = image(100, 4, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 255]));
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'red', x: 10 }), rng: rng() });
  for (let x = 0; x <= 10; x++) {
    assert.equal(at(img, x, 0)[0], 255, `column ${x} should hold the edge value`);
  }
  assert.equal(at(img, 11, 0)[0], 0, 'and stop there');
});

test('a shift too small to move a whole pixel changes nothing', () => {
  // 0.5% of 80px is 0.4px, which rounds away. On a 100px image the same 0.5%
  // is exactly half a pixel and rounds up to one — hence the odd width here.
  const img = marker(80, 4, 10);
  const copy = [...img.data];
  getEffect('channelshift').apply(img, { params: shiftParams({ x: 0.5, y: 0 }), rng: rng() });
  assert.deepEqual([...img.data], copy);
});

test('shifting alpha moves the cutout, not the colour', () => {
  const img = image(100, 4, (x) => [x, 50, 60, x < 50 ? 255 : 0]);
  getEffect('channelshift').apply(img, { params: shiftParams({ channel: 'alpha', x: 20, wrap: false }), rng: rng() });
  assert.equal(at(img, 65, 0)[3], 255, 'the silhouette grew to the right');
  assert.equal(at(img, 75, 0)[3], 0, 'and still ends');
  assert.equal(at(img, 65, 0)[0], 65, 'the colour underneath never moved');
});

// ---------- bloom, bokeh ----------

/** A bright square on a dark field — a highlight with somewhere to spill into. */
const highlight = (size, box) => image(size, size, (x, y) => {
  const inside = Math.abs(x - size / 2) < box && Math.abs(y - size / 2) < box;
  return inside ? [255, 255, 255, 255] : [20, 20, 30, 255];
});

const applied = (id, img, over = {}) => {
  getEffect(id).apply(img, { params: { ...defaults(id), ...over }, rng: rng() });
  return img;
};

test('bloom spills light out of a highlight', () => {
  const img = applied('bloom', highlight(96, 12), { threshold: 50, radius: 10, intensity: 150 });
  const near = bright(img, 48, 62);
  const far = bright(img, 48, 92);
  assert.ok(near > 20, `the field beside the highlight should light up, got ${near}`);
  assert.ok(near > far, 'and fall off with distance');
});

test('bloom only ever brightens', () => {
  const before = highlight(64, 10);
  const copy = [...before.data];
  const after = applied('bloom', before, { threshold: 40 });
  for (let i = 0; i < after.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      assert.ok(after.data[i + c] >= copy[i + c], `channel ${c} at ${i} got darker`);
    }
  }
});

test('bloom below the threshold does nothing at all', () => {
  const img = image(64, 64, () => [90, 90, 90, 255]);
  const copy = [...img.data];
  // Luma of a flat 90 is 90, well under 80% of 255.
  applied('bloom', img, { threshold: 80 });
  assert.deepEqual([...img.data], copy);
});

test('bloom radius is a share of the image, not a pixel count', () => {
  // The same picture at two sizes should glow the same distance in proportion,
  // which is what keeps the preview honest about the export.
  const reach = (size) => {
    const img = applied('bloom', highlight(size, size / 8), { threshold: 50, radius: 12, intensity: 200 });
    const centre = size / 2;
    let distance = 0;
    for (let y = centre; y < size; y++) {
      if (bright(img, centre, y) > 40) distance = y - centre;
    }
    return distance / size;
  };
  const small = reach(64);
  const large = reach(128);
  assert.ok(small > 0.1, `the glow should reach somewhere, got ${small}`);
  assert.ok(Math.abs(small - large) < 0.04, `reach drifted with size: ${small} vs ${large}`);
});

for (const id of ['bloom', 'bokeh']) {
  test(`${id} at zero intensity changes nothing`, () => {
    const img = highlight(64, 10);
    const copy = [...img.data];
    applied(id, img, { intensity: 0 });
    assert.deepEqual([...img.data], copy);
  });

  test(`${id} leaves alpha alone and stains nothing transparent`, () => {
    const img = image(64, 64, (x) => [255, 255, 255, x < 32 ? 255 : 0]);
    const after = applied(id, img, { threshold: 20 });
    for (let y = 0; y < 64; y += 8) {
      assert.equal(at(after, 10, y)[3], 255, 'opaque stays opaque');
      assert.equal(at(after, 50, y)[3], 0, 'transparent stays transparent');
      assert.deepEqual(at(after, 50, y).slice(0, 3), [255, 255, 255], 'and keeps the colour it had');
    }
  });
}

test('bokeh spreads highlights past their own edges', () => {
  // The square ends at y = 84. Discs are centred on samples inside it and reach
  // at most a radius past that, so row 88 is spillover and row 110 is beyond
  // anything the effect could touch — which is the difference between discs and
  // a general brightening.
  const img = applied('bokeh', highlight(128, 20), { threshold: 40, size: 12, density: 80, intensity: 150 });
  const litOn = (row) => {
    let lit = 0;
    for (let x = 0; x < 128; x++) if (bright(img, x, row) > 30) lit++;
    return lit;
  };
  assert.ok(litOn(88) > 0, 'discs should spill below the highlight');
  assert.equal(litOn(110), 0, 'and not reach the far side of the frame');
});

test('bokeh places its discs the same way at any resolution', () => {
  // Placement comes from the cell index, not the pixel, so the same look
  // survives the jump from preview size to export size.
  //
  // The fixture has to be smooth. Against a hard-edged highlight a sample point
  // that rounds just inside the edge at one size and just outside at the other
  // flips a whole disc on or off, and the test then measures that one flip
  // (drift 30) rather than the placement it means to check. Where the tone
  // ramps, a sample near the threshold carries almost no weight either way.
  const cone = (size) => (x, y) => {
    const centre = (size - 1) / 2;
    const distance = Math.hypot(x - centre, y - centre) / (size / 2);
    const v = Math.max(0, Math.min(255, Math.round(255 * (1 - distance))));
    return [v, v, v, 255];
  };

  const grid = (size) => {
    const img = applied('bokeh', image(size, size, cone(size)), { threshold: 40, size: 10, density: 60, intensity: 150 });
    const cells = 8;
    const step = size / cells;
    const out = [];
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        let sum = 0;
        for (let y = cy * step; y < (cy + 1) * step; y++) {
          for (let x = cx * step; x < (cx + 1) * step; x++) sum += bright(img, x, y);
        }
        out.push(sum / (step * step));
      }
    }
    return out;
  };
  const small = grid(96);
  const large = grid(192);
  const drift = small.map((v, i) => Math.abs(v - large[i]));
  const worst = Math.max(...drift);
  assert.ok(worst < 6, `cell brightness drifted by ${worst.toFixed(1)} between sizes`);
});

test('the aperture shape decides how much light lands', () => {
  // Flat and bright everywhere, so every cell fires and the only difference is
  // the shape of what it splats. The hexagon here reaches 2/root-3 of the
  // radius across its flats, so it covers more than the circle; the ring is an
  // annulus, so it covers less.
  const total = (shape) => {
    const img = image(96, 96, () => [200, 200, 200, 255]);
    const before = [...img.data];
    applied('bokeh', img, { shape, threshold: 20, size: 8, density: 50, intensity: 25 });
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 4) sum += img.data[i] - before[i];
    return sum;
  };
  const circle = total('circle');
  const hexagon = total('hexagon');
  const ring = total('ring');
  assert.ok(circle > 0, 'a circle should add light');
  assert.ok(ring < circle, `ring ${ring} should add less than circle ${circle}`);
  assert.ok(hexagon > circle, `hexagon ${hexagon} should add more than circle ${circle}`);
});

test('bokeh is reproducible from the seed and moves with it', () => {
  const run = (seed) => {
    const img = highlight(96, 24);
    getEffect('bokeh').apply(img, { params: defaults('bokeh'), rng: createRng(seed) });
    return [...img.data];
  };
  assert.deepEqual(run('one'), run('one'), 'same seed, same discs');
  assert.notDeepEqual(run('one'), run('two'), 'a different seed should move them');
});

// ---------- lens distortion ----------

const lensParams = (over = {}) => ({ ...defaults('lens'), ...over });

const distort = (img, over = {}) => {
  getEffect('lens').apply(img, { params: lensParams(over), rng: rng() });
  return img;
};

/**
 * A bright ring at a known radius from the centre, on odd dimensions so the
 * centre is a real pixel. Where the ring lands afterwards is the whole map.
 */
const ring = (size, radius) => image(size, size, (x, y) => {
  const c = (size - 1) / 2;
  const d = Math.hypot(x - c, y - c);
  return Math.abs(d - radius) < 1 ? [255, 255, 255, 255] : [30, 30, 30, 255];
});

/** Distance from the centre to the ring along the centre row, going right. */
function ringRadius(img) {
  const c = (img.width - 1) / 2;
  for (let x = Math.floor(c) + 1; x < img.width; x++) {
    if (bright(img, x, (img.height - 1) / 2) > 140) return x - c;
  }
  return null;
}

test('lens distortion at zero amount and full zoom changes nothing', () => {
  const img = ring(81, 25);
  const copy = [...img.data];
  distort(img, { amount: 0, zoom: 100 });
  assert.deepEqual([...img.data], copy, 'an identity map should not even resample');
});

test('barrel pulls the frame in, pincushion pushes it out', () => {
  const straight = ringRadius(ring(81, 25));
  assert.equal(straight, 25);

  const barrel = ringRadius(distort(ring(81, 25), { amount: 40, edges: 'stretch' }));
  const pincushion = ringRadius(distort(ring(81, 25), { amount: -40, edges: 'stretch' }));

  assert.ok(barrel < straight, `barrel should draw the ring inward: ${barrel} vs ${straight}`);
  assert.ok(pincushion > straight, `pincushion should push it outward: ${pincushion} vs ${straight}`);
});

test('barrel bows a straight line outward, pincushion inward', () => {
  // The visual definition of the two, and the thing a sign error would flip.
  // A horizontal line above the centre: under barrel its ends bend toward the
  // centre row while its middle stays put, so the line reads as convex.
  const line = () => image(81, 81, (x, y) => (y === 20 ? [255, 255, 255, 255] : [30, 30, 30, 255]));
  const rowAt = (img, x) => {
    for (let y = 0; y < img.height; y++) if (bright(img, x, y) > 140) return y;
    return null;
  };

  const barrel = distort(line(), { amount: 45, edges: 'stretch' });
  assert.ok(rowAt(barrel, 40) < rowAt(barrel, 8), 'barrel: the middle sits above the ends');

  const pincushion = distort(line(), { amount: -45, edges: 'stretch' });
  assert.ok(rowAt(pincushion, 40) > rowAt(pincushion, 8), 'pincushion: the middle sits below the ends');
});

test('barrel leaves the corners empty and pincushion does not', () => {
  const clear = (img) => {
    let count = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) count++;
    return count;
  };
  assert.ok(clear(distort(ring(81, 25), { amount: 40 })) > 0, 'barrel reads past the source');
  assert.equal(clear(distort(ring(81, 25), { amount: -40 })), 0, 'pincushion reads inside it');
});

test('the edge mode decides what fills what the lens cannot reach', () => {
  const corner = (over) => at(distort(ring(81, 25), { amount: 40, ...over }), 0, 0);

  assert.deepEqual(corner({ edges: 'transparent' }), [0, 0, 0, 0]);
  assert.deepEqual(corner({ edges: 'color', background: '#ff00ff' }), [255, 0, 255, 255]);

  const stretched = corner({ edges: 'stretch' });
  assert.equal(stretched[3], 255, 'stretching leaves nothing transparent');
  assert.deepEqual(stretched.slice(0, 3), [30, 30, 30], 'and takes the colour at the edge');
});

test('zoom crops the empty corners back out of shot', () => {
  const empties = (zoom) => {
    const img = distort(ring(81, 25), { amount: 40, zoom });
    let count = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) count++;
    return count;
  };
  assert.ok(empties(100) > 0);
  assert.equal(empties(150), 0, 'zooming in should cover them');
});

test('lens distortion is radially symmetric', () => {
  // Odd dimensions, so "the same distance either side" really is the same.
  const img = distort(ring(81, 25), { amount: 35, edges: 'stretch' });
  const c = 40;
  for (const offset of [8, 16, 24, 32]) {
    const right = bright(img, c + offset, c);
    assert.equal(bright(img, c - offset, c), right, `left/right differ at ${offset}`);
    assert.equal(bright(img, c, c + offset), right, `down differs at ${offset}`);
    assert.equal(bright(img, c, c - offset), right, `up differs at ${offset}`);
  }
});

test('lens distortion carries alpha with the image', () => {
  // Unlike the aberration, this is geometry: the cutout moves with its colour
  // rather than staying put and clipping it.
  const img = image(81, 81, (x, y) => {
    const d = Math.hypot(x - 40, y - 40);
    return [200, 60, 60, d < 20 ? 255 : 0];
  });
  const radius = (probe) => {
    for (let x = 41; x < 81; x++) if (!probe(x)) return x - 40;
    return null;
  };
  const before = radius((x) => at(img, x, 40)[3] > 128);
  distort(img, { amount: -50, edges: 'stretch' });
  const after = radius((x) => at(img, x, 40)[3] > 128);
  assert.ok(after > before, `the cutout should grow with the image: ${before} to ${after}`);
});

test('lens distortion keeps the edge of a cutout clean of dark fringing', () => {
  // Sampling across the boundary of a cutout has to weight by alpha, or the
  // transparent black beyond it bleeds in as a dark rim.
  //
  // Two details decide whether this test can see the bug at all. The
  // transparent region has to hold black rather than the subject's colour —
  // a decoded canvas gives black, and a fixture that carries the colour
  // through has nothing to bleed, so the check passes either way. And the edge
  // has to be hard: across a soft alpha ramp neighbouring taps have similar
  // alphas and the two formulas nearly agree, while a hard edge puts an opaque
  // tap next to a transparent one, where plain bilinear scales the colour down
  // by the coverage (240 becomes 38 at the worst pixel).
  const img = image(81, 81, (x, y) =>
    (Math.hypot(x - 40, y - 40) < 22 ? [240, 200, 120, 255] : [0, 0, 0, 0]));
  distort(img, { amount: -30, edges: 'stretch' });

  let checked = 0;
  for (let y = 0; y < 81; y++) {
    for (let x = 0; x < 81; x++) {
      const [r, g, b, a] = at(img, x, y);
      // The partly-covered rim, where a sample straddled the boundary.
      if (a <= 40 || a >= 215) continue;
      checked++;
      assert.deepEqual([r, g, b], [240, 200, 120], `fringe at ${x},${y} (alpha ${a})`);
    }
  }
  assert.ok(checked > 50, `expected a rim to check, saw ${checked} pixels`);
});

// ---------- every effect, generically ----------

/**
 * Context complete enough for any effect: the ones that reach backwards get
 * something to reach at, so a crash is a real crash and not a missing input.
 */
function context(img, params, seed = 'test-seed') {
  const past = { data: Uint8ClampedArray.from(img.data), width: img.width, height: img.height };
  return { params, rng: createRng(seed), source: past, frameAt: () => past };
}

const SHAPES = [[1, 1], [1, 40], [40, 1], [2, 2], [17, 64], [64, 17], [64, 64], [97, 31]];

test('every effect survives every awkward image shape', () => {
  // A 1px image, a single row, an odd non-square — the sizes where a centre
  // lands on a half pixel, a kernel runs off both edges at once, or a division
  // by a dimension is a division by one.
  for (const effect of EFFECTS) {
    for (const [w, h] of SHAPES) {
      const img = image(w, h, texture);
      effect.apply(img, context(img, defaults(effect.id)));
      assert.equal(img.width, w, `${effect.id} changed the width at ${w}x${h}`);
      assert.equal(img.data.length, w * h * 4, `${effect.id} resized at ${w}x${h}`);
      for (let i = 0; i < img.data.length; i++) {
        assert.ok(Number.isFinite(img.data[i]), `${effect.id} wrote a non-finite value at ${w}x${h}`);
      }
    }
  }
});

test('every effect survives both ends of every slider', () => {
  // Zero radius, maximum angle, a threshold of nothing: the extremes are where
  // a divide-by-zero or an empty loop lives.
  for (const effect of EFFECTS) {
    for (const spec of effect.params) {
      if (spec.type !== 'range') continue;
      for (const value of [spec.min, spec.max]) {
        const img = image(31, 47, texture);
        const params = { ...defaults(effect.id), [spec.key]: value };
        effect.apply(img, context(img, params));
        for (let i = 0; i < img.data.length; i++) {
          assert.ok(
            Number.isFinite(img.data[i]),
            `${effect.id} with ${spec.key}=${value} wrote a non-finite value`,
          );
        }
      }
    }
  }
});

test('every effect reproduces exactly from the seed', () => {
  const run = (effect, seed) => {
    const img = image(48, 32, texture);
    effect.apply(img, context(img, defaults(effect.id), seed));
    return [...img.data];
  };
  for (const effect of EFFECTS) {
    assert.deepEqual(run(effect, 'a'), run(effect, 'a'), `${effect.id} is not reproducible`);
  }
});

test('every effect leaves fully transparent pixels alone or transparent', () => {
  // A cutout must not come back as a rectangle: nothing may paint colour into
  // a transparent pixel and make it opaque without being asked to.
  const painters = new Set([
    // Effects whose whole job is to put something where nothing was.
    'halftone',     // prints onto paper, which is a surface by definition
    'shapemask',    // fills outside the shape
    'gridgate',     // fills the blocked gaps when not transparent
    // Effects that move opaque pixels onto empty ground.
    'blockshuffle', 'slicer',
    'lens', 'ripple', 'warp', 'kaleidoscope', 'twirl',
    // Effects that spread alpha itself, which is what softening a cutout is.
    'blur', 'tiltshift', 'pixelate',
  ]);
  for (const effect of EFFECTS) {
    if (painters.has(effect.id)) continue;
    const img = image(40, 40, (x, y) => (x < 20 ? [200, 120, 60, 255] : [0, 0, 0, 0]));
    effect.apply(img, context(img, defaults(effect.id)));
    for (let y = 0; y < 40; y += 7) {
      for (let x = 24; x < 40; x += 5) {
        assert.equal(at(img, x, y)[3], 0, `${effect.id} filled in a transparent pixel at ${x},${y}`);
      }
    }
  }
});

// ---------- tonal: levels, invert, sharpen, grain, pixelate ----------

/** Apply an effect at defaults plus overrides, and hand the image back. */
const run = (id, img, over = {}, seed = 'test-seed') => {
  getEffect(id).apply(img, context(img, { ...defaults(id), ...over }, seed));
  return img;
};

const mid = (size = 32) => image(size, size, () => [128, 128, 128, 255]);

test('levels brightens, darkens, and steepens', () => {
  assert.ok(bright(run('levels', mid(), { brightness: 40 }), 5, 5) > 128);
  assert.ok(bright(run('levels', mid(), { brightness: -40 }), 5, 5) < 128);
  assert.equal(bright(run('levels', mid(), { contrast: 80 }), 5, 5), 128, 'mid grey is the pivot');

  // Contrast pushes everything else away from that pivot.
  const ramp = image(64, 4, (x) => { const v = x * 4; return [v, v, v, 255]; });
  run('levels', ramp, { contrast: 60 });
  assert.ok(bright(ramp, 10, 0) < 40, 'darks got darker');
  assert.ok(bright(ramp, 54, 0) > 216, 'lights got lighter');
});

test('levels gamma and saturation move the right way', () => {
  assert.ok(bright(run('levels', mid(), { gamma: 200 }), 5, 5) > 128, 'high gamma lifts midtones');
  assert.ok(bright(run('levels', mid(), { gamma: 50 }), 5, 5) < 128, 'low gamma drops them');

  const colour = () => image(8, 8, () => [200, 90, 40, 255]);
  const flat = run('levels', colour(), { saturation: 0 });
  const [r, g, b] = at(flat, 0, 0);
  assert.equal(r, g, 'zero saturation is grey');
  assert.equal(g, b);

  const vivid = at(run('levels', colour(), { saturation: 180 }), 0, 0);
  assert.ok(vivid[0] > 200 && vivid[2] < 40, 'over 100% pushes away from grey');
});

test('levels at neutral settings is an exact no-op', () => {
  const img = image(24, 24, texture);
  const copy = [...img.data];
  run('levels', img);
  assert.deepEqual([...img.data], copy);
});

test('invert flips channels, and only the ones asked for', () => {
  const colour = () => image(8, 8, () => [200, 90, 40, 255]);
  assert.deepEqual(at(run('invert', colour()), 0, 0), [55, 165, 215, 255]);
  assert.deepEqual(at(run('invert', colour(), { green: false, blue: false }), 0, 0), [55, 90, 40, 255]);
  // Half way through an inversion, everything meets at mid grey.
  const half = at(run('invert', colour(), { amount: 50 }), 0, 0);
  assert.deepEqual(half.slice(0, 3), [128, 128, 128]);
});

test('sharpen amplifies an edge and leaves flat areas alone', () => {
  // Square, because Radius is a share of the *shorter* side: on a 64x8 strip
  // 5% is a fifth of a pixel and the effect correctly declines to do anything.
  const edge = () => image(64, 64, (x) => { const v = x < 32 ? 100 : 160; return [v, v, v, 255]; });
  const sharp = run('sharpen', edge(), { amount: 200, radius: 5, threshold: 0 });
  assert.ok(bright(sharp, 30, 32) < 100, 'the dark side of the edge undershoots');
  assert.ok(bright(sharp, 33, 32) > 160, 'the light side overshoots');
  assert.equal(bright(sharp, 2, 32), 100, 'flat areas away from the edge are untouched');
});

test('sharpen threshold spares small differences', () => {
  const gentle = image(64, 64, (x) => { const v = x < 32 ? 126 : 130; return [v, v, v, 255]; });
  const copy = [...gentle.data];
  run('sharpen', gentle, { amount: 200, radius: 5, threshold: 30 });
  assert.deepEqual([...gentle.data], copy, 'a 4-level step is under a threshold of 30');
});

test('grain is normally distributed, not uniform', () => {
  // The distinguishing property: most of the noise is small, and the tails are
  // rare. A uniform offset would fill the range evenly instead.
  const img = run('grain', mid(200), { amount: 40, size: 0.5, midtones: 0, mono: true });
  const offsets = [];
  for (let i = 0; i < img.data.length; i += 4) offsets.push(img.data[i] - 128);

  // Measure the spread from the data, then check its *shape*. A normal
  // distribution puts 68% inside one deviation and 95% inside two; a uniform
  // one puts 58% and 100%, so the two are never confusable.
  const mean = offsets.reduce((sum, v) => sum + v, 0) / offsets.length;
  const deviation = Math.sqrt(offsets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / offsets.length);
  const within = (n) => offsets.filter((v) => Math.abs(v - mean) < n * deviation).length / offsets.length;

  assert.ok(deviation > 5, `grain should actually vary, saw a deviation of ${deviation.toFixed(1)}`);
  assert.ok(Math.abs(within(1) - 0.68) < 0.05, `within one deviation: ${within(1).toFixed(3)}`);
  assert.ok(Math.abs(within(2) - 0.95) < 0.03, `within two deviations: ${within(2).toFixed(3)}`);
  assert.ok(offsets.some((v) => v > 0) && offsets.some((v) => v < 0), 'grain goes both ways');
});

test('grain concentrates in the midtones when asked', () => {
  const spread = (tone, midtones) => {
    const img = run('grain', image(120, 120, () => [tone, tone, tone, 255]),
      { amount: 60, size: 0.5, midtones, mono: true });
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 4) sum += Math.abs(img.data[i] - tone);
    return sum / (img.data.length / 4);
  };
  assert.ok(spread(128, 100) > spread(20, 100) * 3, 'biased grain avoids the shadows');
  // With the bias off, a dark patch grains as hard as a mid one — clipping at 0
  // is the only thing that holds it back, so compare against a lighter shadow.
  assert.ok(spread(128, 0) < spread(70, 0) * 1.3, 'unbiased grain is even');
});

test('pixelate makes flat blocks, and the two samplings differ', () => {
  const noisy = () => image(64, 64, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256, 255]);

  const average = run('pixelate', noisy(), { cell: 25, mode: 'average' });
  const block = at(average, 0, 0);
  for (let y = 0; y < 16; y += 5) {
    for (let x = 0; x < 16; x += 5) assert.deepEqual(at(average, x, y), block, 'the block is flat');
  }
  assert.notDeepEqual(at(average, 20, 0), block, 'the next block is not the same');

  const nearest = run('pixelate', noisy(), { cell: 25, mode: 'nearest' });
  assert.notDeepEqual(at(nearest, 0, 0), block, 'nearest takes a real pixel, not the mean');
  // Nearest can only ever emit colours the image already contained.
  const source = noisy();
  const centre = at(source, 8, 8);
  assert.deepEqual(at(nearest, 0, 0), centre);
});

// ---------- print: halftone, duotone, palette, scanlines, solarize ----------

test('halftone dots grow with ink and shrink with light', () => {
  const coverage = (tone) => {
    const img = run('halftone', image(96, 96, () => [tone, tone, tone, 255]),
      { mode: 'mono', dot: 8, angle: 0, ink: '#000000', paper: '#ffffff' });
    let inked = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) inked++;
    return inked / (img.data.length / 4);
  };
  const dark = coverage(40);
  const light = coverage(215);
  assert.ok(dark > light, `a dark tone should ink more: ${dark.toFixed(3)} vs ${light.toFixed(3)}`);
  assert.ok(light < 0.25 && dark > 0.4, `coverage should track tone, saw ${light} and ${dark}`);
  assert.equal(coverage(255), 0, 'white leaves the paper bare');
});

test('halftone screens the four plates at different angles', () => {
  // The point of CMYK screening: the plates must not line up. If they shared an
  // angle the dots would stack and the result would be grey, not colour.
  const img = run('halftone', image(120, 120, () => [180, 90, 60, 255]),
    { mode: 'cmyk', dot: 6, paper: '#ffffff' });
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    seen.add(`${img.data[i] >> 5},${img.data[i + 1] >> 5},${img.data[i + 2] >> 5}`);
  }
  assert.ok(seen.size > 6, `overlapping plates should make many colours, saw ${seen.size}`);
});

test('duotone maps equal luminance to equal colour', () => {
  // The difference from Colorize: the original hue is gone, so two pixels that
  // were different colours of the same brightness come out identical.
  // Cyan's luminance is 200.8, which rounds to the same 201 as this grey — a
  // pair that only matches by eye is no test at all, so the numbers are checked.
  const matched = image(2, 2, (x, y) => (y === 0 ? [0, 255, 255, 255] : [201, 201, 201, 255]));
  run('duotone', matched, { shadow: '#000080', highlight: '#ffff00' });
  assert.deepEqual(at(matched, 0, 0), at(matched, 0, 1), 'same luminance, same output');
  assert.notDeepEqual(at(matched, 0, 0).slice(0, 3), [0, 255, 255], 'and not the colour it started as');
});

test('duotone pins both ends of the ramp', () => {
  const ends = image(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  run('duotone', ends, { shadow: '#102040', highlight: '#f0e0d0', midpoint: 70 });
  assert.deepEqual(at(ends, 0, 0).slice(0, 3), [16, 32, 64], 'black lands on the shadow colour');
  assert.deepEqual(at(ends, 1, 0).slice(0, 3), [240, 224, 208], 'white lands on the highlight');
});

test('palette emits only palette colours', () => {
  const img = run('palette', image(64, 64, texture), { palette: 'gameboy', dither: 60 });
  const allowed = new Set(['15,56,15', '48,98,48', '139,172,15', '155,188,15']);
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) seen.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
  for (const colour of seen) assert.ok(allowed.has(colour), `${colour} is not in the palette`);
  assert.ok(seen.size > 1, 'more than one palette entry should get used');
});

test('palette dithering mixes entries instead of banding', () => {
  // A flat tone between two palette entries: undithered it picks one and the
  // whole patch is uniform, dithered it alternates and the patch is mixed.
  const patch = () => image(64, 64, () => [90, 90, 90, 255]);
  const distinct = (img) => {
    const seen = new Set();
    for (let i = 0; i < img.data.length; i += 4) seen.add(img.data[i]);
    return seen.size;
  };
  assert.equal(distinct(run('palette', patch(), { palette: 'grey4', dither: 0 })), 1);
  assert.ok(distinct(run('palette', patch(), { palette: 'grey4', dither: 100 })) > 1);
});

test('scanlines darken evenly spaced rows', () => {
  const img = run('scanlines', mid(100), { spacing: 10, darkness: 60, thickness: 50, mask: false });
  const rows = [];
  for (let y = 0; y < 100; y++) rows.push(bright(img, 0, y) < 128);
  const darkCount = rows.filter(Boolean).length;
  assert.ok(darkCount > 30 && darkCount < 70, `about half the rows should darken, saw ${darkCount}`);
  // Spacing is 10% of 100px, so the pattern must repeat every 10 rows.
  for (let y = 0; y + 10 < 100; y++) assert.equal(rows[y], rows[y + 10], `period broke at ${y}`);
});

test('the RGB mask leaves one channel per column', () => {
  const img = run('scanlines', mid(60), { spacing: 50, darkness: 0, mask: true, maskStrength: 100 });
  for (let x = 0; x < 6; x++) {
    const pixel = at(img, x, 0);
    const lit = [pixel[0], pixel[1], pixel[2]].filter((v) => v > 0);
    assert.equal(lit.length, 1, `column ${x} should light one phosphor, not ${lit.length}`);
  }
});

test('solarize reverses past the threshold and leaves the rest', () => {
  const ramp = image(256, 2, (x) => [x, x, x, 255]);
  run('solarize', ramp, { threshold: 50, softness: 0, amount: 100 });
  assert.equal(bright(ramp, 20, 0), 20, 'below the cut, untouched');
  assert.equal(bright(ramp, 220, 0), 35, 'above it, the negative');
});

test('solarize can reverse the shadows instead', () => {
  const ramp = image(256, 2, (x) => [x, x, x, 255]);
  run('solarize', ramp, { threshold: 50, softness: 0, below: true });
  assert.equal(bright(ramp, 20, 0), 235, 'the shadows flipped');
  assert.equal(bright(ramp, 220, 0), 220, 'the highlights did not');
});

// ---------- geometry: twirl, ripple, warp, kaleidoscope, block shuffle ----------

/** A cross of bright lines through the centre, easy to follow when bent. */
const cross = (size) => image(size, size, (x, y) => {
  const c = (size - 1) / 2;
  return (Math.abs(x - c) < 2 || Math.abs(y - c) < 2) ? [255, 255, 255, 255] : [20, 20, 20, 255];
});

test('twirl spins the middle and leaves the rim', () => {
  const img = run('twirl', cross(81), { angle: 180, radius: 50, falloff: 2 });
  // The arm pointing right from the centre has been carried round; the same
  // spot well outside the radius has not.
  const source = cross(81);
  assert.ok(bright(img, 60, 40) < 200, 'the arm moved off the centre row');
  // Radius 50% of the half-diagonal reaches 28px, so this pixel is outside it.
  // It sits on the cross's own arm, so the untouched value is 255, not the
  // background — hence comparing against the source rather than a constant.
  assert.equal(bright(img, 79, 40), bright(source, 79, 40), 'past the radius nothing changed');
  assert.equal(bright(img, 40, 40), 255, 'the exact centre stays put');
});

test('twirl never leaves a gap, whatever the angle', () => {
  // A rotation preserves radius, so there is nowhere it could read from
  // outside the frame — this is the one geometric effect with no edge control.
  for (const angle of [-720, -90, 90, 720]) {
    const img = run('twirl', image(64, 64, () => [10, 20, 30, 255]), { angle, radius: 150 });
    for (let i = 3; i < img.data.length; i += 4) {
      assert.equal(img.data[i], 255, `angle ${angle} punched a hole`);
    }
  }
});

test('ripple bends rows one way and columns the other', () => {
  const straight = image(64, 64, (x, y) => (y === 32 ? [255, 255, 255, 255] : [20, 20, 20, 255]));
  const rows = run('ripple', straight, { mode: 'rows', wavelength: 30, amplitude: 10, edges: 'stretch' });
  // A horizontal line displaced sideways stays a horizontal line...
  assert.equal(bright(rows, 10, 32), 255, 'rows slide along the line, so it survives');

  const column = image(64, 64, (x) => (x === 32 ? [255, 255, 255, 255] : [20, 20, 20, 255]));
  const bent = run('ripple', column, { mode: 'rows', wavelength: 30, amplitude: 10, edges: 'stretch' });
  const litAt = (y) => { for (let x = 0; x < 64; x++) if (bright(bent, x, y) > 140) return x; return null; };
  assert.notEqual(litAt(10), litAt(26), 'a vertical line should waver down its length');
});

test('ripple rings stay circular', () => {
  const img = run('ripple', cross(81), { mode: 'rings', wavelength: 20, amplitude: 6, phase: 0, edges: 'stretch' });
  // Odd size, so the same distance either side of the centre really is equal.
  for (const offset of [10, 20, 30]) {
    assert.equal(bright(img, 40 + offset, 40), bright(img, 40 - offset, 40), `asymmetric at ${offset}`);
    assert.equal(bright(img, 40, 40 + offset), bright(img, 40 + offset, 40), `not radial at ${offset}`);
  }
});

test('ripple at zero amplitude changes nothing', () => {
  const img = image(32, 32, texture);
  const copy = [...img.data];
  run('ripple', img, { amplitude: 0 });
  assert.deepEqual([...img.data], copy);
});

test('warp displaces smoothly, not per pixel', () => {
  // The test that separates a noise *field* from noise: neighbours must move
  // together. Sampling a smooth gradient, the output stays smooth.
  const gradient = image(96, 96, (x) => { const v = Math.round((x / 95) * 255); return [v, v, v, 255]; });
  run('warp', gradient, { scale: 25, amount: 10, detail: 1, edges: 'stretch' });

  let jumps = 0;
  for (let y = 0; y < 96; y++) {
    for (let x = 1; x < 96; x++) {
      if (Math.abs(bright(gradient, x, y) - bright(gradient, x - 1, y)) > 24) jumps++;
    }
  }
  assert.ok(jumps < 40, `a smooth warp should not tear the gradient, saw ${jumps} jumps`);
});

test('warp moves the image at all, and differently per seed', () => {
  const shot = (seed) => {
    const img = run('warp', cross(64), { scale: 20, amount: 12, edges: 'stretch' }, seed);
    return [...img.data];
  };
  assert.notDeepEqual(shot('one'), [...cross(64).data], 'something should move');
  assert.notDeepEqual(shot('one'), shot('two'), 'a different seed warps differently');
  assert.deepEqual(shot('one'), shot('one'), 'the same seed does not');
});

test('kaleidoscope repeats one wedge around the circle', () => {
  // A smooth gradient, because the probe rounds to whole pixels: against the
  // fast-varying `texture` a half-pixel of probe error reads as a 15-level
  // difference and the test measures its own rounding. It must not be
  // radially symmetric either, or every probe would match for free.
  const gradient = (x, y) => {
    const v = Math.round((x / 80) * 200 + (y / 80) * 40);
    return [v, v, v, 255];
  };
  const img = run('kaleidoscope', image(81, 81, gradient), { segments: 6, rotation: 0, mirror: true, edges: 'stretch' });
  // Six segments means everything repeats every 60 degrees about the centre.
  const sample = (degrees, radius) => {
    const radians = (degrees * Math.PI) / 180;
    return bright(img, Math.round(40 + Math.cos(radians) * radius), Math.round(40 + Math.sin(radians) * radius));
  };
  // Near-equal, not equal: the probe rounds to whole pixels, so two points
  // that are the same distance into their wedges still land a fraction apart
  // and the sampler interpolates each slightly differently.
  const close = (a, b, why) => assert.ok(Math.abs(a - b) <= 4, `${why}: ${a} vs ${b}`);
  const seen = new Set();
  for (const radius of [12, 24, 36]) {
    for (const base of [7, 23]) {
      seen.add(sample(base, radius));
      close(sample(base, radius), sample(base + 60, radius), `wedge broke at ${base}deg r${radius}`);
      close(sample(base, radius), sample(base + 120, radius), `wedge broke at ${base}deg r${radius}`);
    }
  }
  assert.ok(seen.size > 2, 'the probes must land on different tones, or this proves nothing');
});

test('kaleidoscope mirrors its segments unless told not to', () => {
  const shot = (mirror) => {
    const img = run('kaleidoscope', image(81, 81, texture), { segments: 4, mirror, edges: 'stretch' });
    return [...img.data];
  };
  assert.notDeepEqual(shot(true), shot(false), 'a pinwheel is not a kaleidoscope');
});

test('block shuffle moves whole blocks and leaves the rest', () => {
  const img = run('blockshuffle', image(80, 80, texture), { block: 10, shift: 20, density: 100, transparent: true });
  let empty = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) empty++;
  assert.ok(empty > 0, 'blocks that moved leave their old spot behind');

  const still = run('blockshuffle', image(80, 80, texture), { block: 10, shift: 20, density: 0 });
  const source = image(80, 80, texture);
  assert.deepEqual([...still.data], [...source.data], 'at zero density nothing moves');
});

test('block shuffle fills its gaps with a colour when asked', () => {
  const img = run('blockshuffle', image(80, 80, texture), { block: 10, shift: 25, density: 100, transparent: false, background: '#ff00ff' });
  for (let i = 3; i < img.data.length; i += 4) assert.equal(img.data[i], 255, 'nothing should be transparent');
  let magenta = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 255) magenta++;
  }
  assert.ok(magenta > 0, 'the gaps should take the colour');
});

// ---------- light: streak, star filter, light leak, tilt shift ----------

/** One bright dot on a dark field. */
const dot = (size, radius = 3) => image(size, size, (x, y) =>
  (Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2) <= radius ? [255, 255, 255, 255] : [10, 10, 10, 255]));

test('the anamorphic streak draws light out along one axis', () => {
  const img = run('streak', dot(97), { threshold: 40, length: 30, angle: 0, intensity: 200, tint: '#ffffff' });
  assert.ok(bright(img, 70, 48) > 20, 'light reaches sideways');
  assert.equal(bright(img, 48, 70), 10, 'and not up or down');
});

test('the streak angle turns the bar', () => {
  const img = run('streak', dot(97), { threshold: 40, length: 30, angle: 90, intensity: 200, tint: '#ffffff' });
  assert.ok(bright(img, 48, 70) > 20, 'at 90 degrees it runs vertically');
  assert.equal(bright(img, 70, 48), 10, 'and no longer sideways');
});

test('the star filter puts spikes on every side', () => {
  const img = run('starfilter', dot(97), { threshold: 40, points: 4, length: 25, rotation: 0, intensity: 250 });
  // Four points at rotation 0 means two crossed bars: across and down.
  for (const [x, y] of [[75, 48], [21, 48], [48, 75], [48, 21]]) {
    assert.ok(bright(img, x, y) > 15, `no spike reached ${x},${y}`);
  }
  assert.equal(bright(img, 72, 72), 10, 'but not diagonally, at this rotation');
});

test('more points make more spikes', () => {
  const spikes = (points) => {
    const img = run('starfilter', dot(97), { threshold: 40, points, length: 25, rotation: 0, intensity: 250 });
    // Walk a circle around the dot and count the lit arcs.
    const arc = [];
    for (let degrees = 0; degrees < 360; degrees++) {
      const radians = (degrees * Math.PI) / 180;
      arc.push(bright(img, Math.round(48 + Math.cos(radians) * 22), Math.round(48 + Math.sin(radians) * 22)) > 14);
    }
    // Circular, so the scan has to wrap: a spike sitting across 0 degrees is
    // one spike, and a linear scan would count its two halves separately.
    let count = 0;
    for (let i = 0; i < arc.length; i++) if (arc[i] && !arc[(i + arc.length - 1) % arc.length]) count++;
    return count;
  };
  assert.equal(spikes(2), 2);
  assert.equal(spikes(4), 4);
});

test('the light leak brightens from one side', () => {
  const img = run('lightleak', mid(64), { origin: 'left', size: 60, intensity: 120, color: '#ff8040' });
  assert.ok(bright(img, 2, 32) > bright(img, 61, 32), 'brightest at the edge it came from');
  const right = run('lightleak', mid(64), { origin: 'right', size: 60, intensity: 120, color: '#ff8040' });
  assert.ok(bright(right, 61, 32) > bright(right, 2, 32), 'and the other way round');
});

test('the light leak only ever brightens', () => {
  const before = mid(48);
  const copy = [...before.data];
  run('lightleak', before, { intensity: 200, size: 150 });
  for (let i = 0; i < before.data.length; i += 4) {
    for (let c = 0; c < 3; c++) assert.ok(before.data[i + c] >= copy[i + c], 'a leak cannot darken');
  }
});

test('tilt shift keeps a band sharp and blurs the rest', () => {
  const stripes = () => image(96, 96, (x, y) => { const v = y % 4 < 2 ? 240 : 20; return [v, v, v, 255]; });
  const img = run('tiltshift', stripes(), { position: 50, width: 20, angle: 0, softness: 10, blur: 8 });
  const contrast = (y) => Math.abs(bright(img, 48, y) - bright(img, 48, y + 2));
  assert.ok(contrast(46) > 150, 'the band keeps its stripes');
  assert.ok(contrast(4) < 60, 'the top is smeared');
  assert.ok(contrast(90) < 60, 'and so is the bottom');
});

test('the tilt shift angle turns the band', () => {
  const stripes = () => image(96, 96, (x) => { const v = x % 4 < 2 ? 240 : 20; return [v, v, v, 255]; });
  const img = run('tiltshift', stripes(), { position: 50, width: 20, angle: 90, softness: 10, blur: 8 });
  const contrast = (x) => Math.abs(bright(img, x, 48) - bright(img, x + 2, 48));
  assert.ok(contrast(46) > 150, 'a vertical band keeps its stripes');
  assert.ok(contrast(6) < 60, 'and the sides are smeared');
});

// ---------- history: echo, difference key ----------

test('echo lays several earlier stages back on', () => {
  const chain = [
    createItem('greyscale', { amount: 100 }),
    createItem('threshold', { level: 0, softness: 0, invert: false }),
    createItem('echo', { steps: 2, opacity: 100, decay: 100, mode: 'normal' }),
  ];
  // Oldest first, so step 1 — the greyscale — ends up on top.
  const out = render(chain);
  const greyOnly = render([createItem('greyscale', { amount: 100 })]);
  assert.deepEqual([...out.data], [...greyOnly.data]);
});

test('echo decays, so nearer stages show strongest', () => {
  const chain = (decay) => [
    createItem('greyscale', { amount: 100 }),
    createItem('threshold', { level: 0, softness: 0, invert: false }),
    createItem('echo', { steps: 3, opacity: 60, decay, mode: 'normal' }),
  ];
  const strong = render(chain(90));
  const weak = render(chain(10));
  assert.notDeepEqual([...strong.data], [...weak.data], 'decay should change the mix');

  // A fast decay leaves almost nothing for the older echoes, so the result
  // sits close to a single reblend of the nearest stage; a slow one does not.
  // Not identical, though: even at 10% the second echo still lands at 6%.
  const single = render([
    createItem('greyscale', { amount: 100 }),
    createItem('threshold', { level: 0, softness: 0, invert: false }),
    createItem('reblendprevious', { steps: 1, opacity: 60, mode: 'normal' }),
  ]);
  const gap = (img) => {
    let sum = 0;
    for (let i = 0; i < img.data.length; i++) sum += Math.abs(img.data[i] - single.data[i]);
    return sum;
  };
  assert.ok(gap(weak) < gap(strong) / 4, `fast decay ${gap(weak)} should sit far nearer than slow ${gap(strong)}`);
});

test('the difference key keeps what changed and cuts what did not', () => {
  // Half the image gets thresholded to white, half is already white and so
  // comes through untouched. Only the half that moved should survive.
  const fill = (x) => (x < 20 ? [40, 40, 40, 255] : [255, 255, 255, 255]);
  const out = render([
    createItem('threshold', { level: 0, softness: 0, invert: false }),
    createItem('diffkey', { steps: 1, tolerance: 10, softness: 0, invert: false }),
  ], fill, 40);

  assert.equal(at(out, 5, 5)[3], 255, 'the darks were changed, so they stay');
  assert.equal(at(out, 35, 5)[3], 0, 'the whites were already white, so they go');
});

test('the difference key can keep the unchanged half instead', () => {
  const fill = (x) => (x < 20 ? [40, 40, 40, 255] : [255, 255, 255, 255]);
  const out = render([
    createItem('threshold', { level: 0, softness: 0, invert: false }),
    createItem('diffkey', { steps: 1, tolerance: 10, softness: 0, invert: true }),
  ], fill, 40);

  assert.equal(at(out, 5, 5)[3], 0);
  assert.equal(at(out, 35, 5)[3], 255);
});

// ---------- alpha: colour key, shape mask, edge detect ----------

test('the colour key cuts its colour and keeps the rest', () => {
  const img = image(40, 8, (x) => (x < 20 ? [0, 177, 64, 255] : [200, 60, 60, 255]));
  run('colorkey', img, { color: '#00b140', tolerance: 25, brightness: 60, softness: 0 });
  assert.equal(at(img, 5, 4)[3], 0, 'the key colour is gone');
  assert.equal(at(img, 35, 4)[3], 255, 'the rest is untouched');
});

test('the colour key matches on hue, not on brightness', () => {
  // The same green at three exposures, which means scalar multiples of one
  // colour — adding to the other channels instead would change the hue too,
  // and the effect would be right to keep it.
  const img = image(3, 1, (x) => [[0, 88, 32], [0, 177, 64], [0, 239, 86]][x].concat(255));
  run('colorkey', img, { color: '#00b140', tolerance: 30, brightness: 100, softness: 0 });
  for (let x = 0; x < 3; x++) assert.equal(at(img, x, 0)[3], 0, `shade ${x} survived`);
});

test('the shape mask cuts to its shape', () => {
  const img = run('shapemask', image(81, 81, () => [200, 200, 200, 255]),
    { shape: 'circle', inset: 0, softness: 0, transparent: true });
  assert.equal(at(img, 40, 40)[3], 255, 'the middle is kept');
  assert.equal(at(img, 0, 0)[3], 0, 'the corners are cut');
  assert.equal(at(img, 40, 2)[3], 255, 'the edge midpoints are inside the circle');
});

test('every shape mask cuts something and keeps the centre', () => {
  for (const shape of ['circle', 'rounded', 'diamond', 'arch']) {
    const img = run('shapemask', image(81, 81, () => [200, 200, 200, 255]),
      { shape, inset: 5, corner: 30, softness: 0, transparent: true });
    assert.equal(at(img, 40, 40)[3], 255, `${shape} lost its middle`);
    assert.equal(at(img, 0, 0)[3], 0, `${shape} kept a corner`);
  }
});

test('the shape mask fills instead of cutting when asked', () => {
  const img = run('shapemask', image(81, 81, () => [200, 200, 200, 255]),
    { shape: 'circle', softness: 0, transparent: false, background: '#ff00ff' });
  assert.deepEqual(at(img, 0, 0), [255, 0, 255, 255], 'outside takes the colour');
  assert.deepEqual(at(img, 40, 40), [200, 200, 200, 255], 'inside is left alone');
});

test('edge detect finds edges and ignores flat areas', () => {
  const img = run('edgedetect', image(64, 64, (x) => { const v = x < 32 ? 30 : 220; return [v, v, v, 255]; }),
    { amount: 150, threshold: 0, invert: false });
  assert.ok(bright(img, 31, 32) > 120, 'the edge lights up');
  assert.equal(bright(img, 8, 32), 0, 'the flat left is black');
  assert.equal(bright(img, 56, 32), 0, 'and so is the flat right');
});

test('edge detect does not find the frame border', () => {
  // The kernels clamp at the border rather than reading past it, or every
  // image would come back with a bright rectangle drawn round it.
  const flat = run('edgedetect', image(48, 48, () => [180, 180, 180, 255]), { threshold: 0 });
  for (let i = 0; i < flat.data.length; i += 4) assert.equal(flat.data[i], 0, 'a flat image has no edges');

  // Reading past the edge instead would put NaN in the border rows, and a NaN
  // stored into a clamped array becomes 0 — indistinguishable from "no edge
  // here" on a flat image. So check a real edge still registers on row zero.
  const edge = run('edgedetect', image(48, 48, (x) => { const v = x < 24 ? 30 : 220; return [v, v, v, 255]; }),
    { amount: 150, threshold: 0 });
  assert.ok(bright(edge, 23, 0) > 120, 'the edge should reach the top row');
  assert.equal(bright(edge, 23, 0), bright(edge, 23, 24), 'and read the same as the middle');
});

test('edge detect can invert to dark lines on white', () => {
  const img = run('edgedetect', image(64, 64, (x) => { const v = x < 32 ? 30 : 220; return [v, v, v, 255]; }),
    { amount: 150, threshold: 0, invert: true });
  assert.ok(bright(img, 31, 32) < 140, 'the edge is dark');
  assert.equal(bright(img, 8, 32), 255, 'the paper is white');
});

test('the difference key notices a change in alpha alone', () => {
  // A pixel that only became transparent has changed as surely as one that
  // changed colour, so the comparison has to include alpha.
  const img = image(40, 4, () => [120, 120, 120, 255]);
  const past = { data: Uint8ClampedArray.from(img.data), width: 40, height: 4 };
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 4; y++) past.data[(y * 40 + x) * 4 + 3] = 40;
  }

  getEffect('diffkey').apply(img, {
    params: { ...defaults('diffkey'), steps: 1, tolerance: 10, softness: 0, invert: false },
    rng: rng(),
    frameAt: () => past,
  });
  assert.equal(at(img, 5, 2)[3], 255, 'alpha changed here, so it stays');
  assert.equal(at(img, 35, 2)[3], 0, 'nothing changed here, so it goes');
});
