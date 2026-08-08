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
  assert.deepEqual(ids.slice().sort(), ['atkinson', 'blur', 'greyscale', 'pixelsort', 'reblend', 'threshold']);
  for (const effect of EFFECTS) {
    assert.equal(typeof effect.label, 'string');
    assert.equal(typeof effect.stage, 'number');
    assert.equal(typeof effect.apply, 'function');
    for (const spec of effect.params) {
      assert.ok(['range', 'toggle', 'select'].includes(spec.type), `${effect.id}.${spec.key}`);
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
    params: { direction: 'horizontal', threshold: 0, maxLength: 600, coverage: 100, reverse: false },
    rng: rng(),
  });

  const after = [...row.data].filter((_, i) => i % 4 === 0);
  assert.deepEqual(after.slice().sort((a, b) => a - b), before, 'sorting must not invent or lose pixels');
  for (let x = 1; x < 32; x++) assert.ok(after[x] >= after[x - 1], 'run should end up ascending');
});

test('pixel sort reverses and works vertically', () => {
  const column = image(1, 32, (_x, y) => { const v = ((y * 37) % 64) + 190; return [v, v, v, 255]; });
  getEffect('pixelsort').apply(column, {
    params: { direction: 'vertical', threshold: 0, maxLength: 600, coverage: 100, reverse: true },
    rng: rng(),
  });
  const values = Array.from({ length: 32 }, (_, y) => at(column, 0, y)[0]);
  for (let y = 1; y < 32; y++) assert.ok(values[y] <= values[y - 1], 'reverse should sort descending');
});

test('pixel sort leaves dark pixels below the threshold alone', () => {
  const row = image(32, 1, (x) => (x < 16 ? [10, 10, 10, 255] : [200 + (x % 8), 200, 200, 255]));
  const darkBefore = Array.from({ length: 16 }, (_, x) => at(row, x, 0));
  getEffect('pixelsort').apply(row, {
    params: { direction: 'horizontal', threshold: 128, maxLength: 600, coverage: 100, reverse: false },
    rng: rng(),
  });
  for (let x = 0; x < 16; x++) assert.deepEqual(at(row, x, 0), darkBefore[x]);
});

test('pixel sort is reproducible from the seed and varies with it', () => {
  const run = (seed) => {
    const img = image(48, 48, texture);
    getEffect('pixelsort').apply(img, {
      params: { direction: 'horizontal', threshold: 100, maxLength: 200, coverage: 50, reverse: false },
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
  assert.equal(normalizeParams(sort, { maxLength: 201 }).maxLength, 200, 'should snap to the step');
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
