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
    'atkinson', 'bayer', 'blur', 'channelthreshold', 'colorize', 'greyscale',
    'huerotate', 'pixelsort', 'randomdither', 'reblend', 'spotlight',
    'threshold', 'vignette',
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

  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const item = randomChain(createRng(`c${i}`)).find((entry) => entry.id === 'colorize');
    if (!item) continue;
    assert.match(item.params.color, /^#[0-9a-f]{6}$/);
    seen.add(item.params.color);
  }
  assert.ok(seen.size > 5, `random colours should vary, saw ${seen.size}`);
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
