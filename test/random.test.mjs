import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRng,
  randomSeed,
  normalizeSeed,
  DEFAULT_SEED,
  MAX_SEED_LENGTH,
} from '../src/random.js';

const draw = (rng, n = 8) => Array.from({ length: n }, () => rng.next());

test('the same seed reproduces the same sequence', () => {
  assert.deepEqual(draw(createRng('sunset')), draw(createRng('sunset')));
});

test('different seeds diverge, including near-identical ones', () => {
  assert.notDeepEqual(draw(createRng('sunset')), draw(createRng('sunsew')));
  assert.notDeepEqual(draw(createRng('a')), draw(createRng('b')));
  assert.notDeepEqual(draw(createRng('1')), draw(createRng('2')));
});

test('output stays in [0, 1) and is roughly uniform', () => {
  const rng = createRng('uniform');
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100_000; i++) {
    const value = rng.next();
    assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
    buckets[Math.floor(value * 10)]++;
  }
  for (const count of buckets) assert.ok(Math.abs(count - 10_000) < 600, `skewed: ${buckets}`);
});

test('forks are independent of each other and of draw order', () => {
  const expected = draw(createRng('seed').fork('grain'));

  // Exhausting a sibling stream must not shift this one.
  const rng = createRng('seed');
  const grain = rng.fork('grain');
  const glitch = rng.fork('glitch');
  draw(glitch, 500);
  draw(rng, 500);
  assert.deepEqual(draw(grain), expected);

  // ...and forking in the opposite order gives the same streams.
  const other = createRng('seed');
  const glitch2 = other.fork('glitch');
  const grain2 = other.fork('grain');
  assert.deepEqual(draw(grain2), expected);
  assert.notDeepEqual(draw(glitch2), expected);
});

test('forks follow the seed, and nest by path', () => {
  assert.notDeepEqual(
    draw(createRng('one').fork('grain')),
    draw(createRng('two').fork('grain')),
  );
  assert.equal(createRng('s').fork('a').fork('b').stream, 'a/b');
  assert.deepEqual(
    draw(createRng('s').fork('a').fork('b')),
    draw(createRng('s', 'a/b')),
  );
});

test('reset rewinds to the first draw', () => {
  const rng = createRng('reset');
  const first = draw(rng);
  draw(rng, 50);
  rng.reset();
  assert.deepEqual(draw(rng), first);
});

test('int covers both ends of an inclusive range', () => {
  const rng = createRng('ints');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const value = rng.int(3, 7);
    assert.ok(Number.isInteger(value) && value >= 3 && value <= 7, `out of range: ${value}`);
    seen.add(value);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
  assert.equal(createRng('x').int(5, 5), 5);
});

test('float, bool and sign respect their bounds', () => {
  const rng = createRng('bounds');
  for (let i = 0; i < 1000; i++) {
    const value = rng.float(-2, 5);
    assert.ok(value >= -2 && value < 5);
    assert.ok([-1, 1].includes(rng.sign()));
  }
  assert.equal(rng.bool(0), false);
  assert.equal(rng.bool(1), true);
});

test('gaussian lands near the requested mean and deviation', () => {
  const rng = createRng('bell');
  const samples = Array.from({ length: 50_000 }, () => rng.gaussian(10, 2));
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const deviation = Math.sqrt(
    samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length,
  );
  assert.ok(Math.abs(mean - 10) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(deviation - 2) < 0.05, `deviation ${deviation}`);
});

test('shuffle permutes deterministically without mutating the input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const once = createRng('cards').shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(once.slice().sort((a, b) => a - b), input);
  assert.deepEqual(once, createRng('cards').shuffle(input));
  assert.notDeepEqual(once, createRng('dice').shuffle(input));
});

test('pick is deterministic and handles an empty list', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(createRng('p').pick(items), createRng('p').pick(items));
  assert.equal(createRng('p').pick([]), undefined);
});

test('noiseAt depends only on the coordinate, not on draw order', () => {
  const rng = createRng('grain-seed').fork('grain');
  const before = rng.noiseAt(12, 34);
  draw(rng, 100);
  assert.equal(rng.noiseAt(12, 34), before);
  assert.equal(createRng('grain-seed').fork('grain').noiseAt(12, 34), before);

  assert.notEqual(rng.noiseAt(13, 34), before);
  assert.notEqual(rng.noiseAt(12, 35), before);
  assert.notEqual(createRng('other').fork('grain').noiseAt(12, 34), before);
  assert.notEqual(createRng('grain-seed').fork('glitch').noiseAt(12, 34), before);
});

test('noiseAt is uniform across a pixel grid', () => {
  const rng = createRng('field');
  const buckets = new Array(10).fill(0);
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const value = rng.noiseAt(x, y);
      assert.ok(value >= 0 && value < 1);
      buckets[Math.floor(value * 10)]++;
    }
  }
  for (const count of buckets) assert.ok(Math.abs(count - 4000) < 400, `skewed: ${buckets}`);
});

test('generated seeds are readable and unambiguous', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomSeed(), /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  }
  assert.equal(new Set(Array.from({ length: 200 }, randomSeed)).size > 190, true);
});

test('normalizeSeed accepts any text and bounds its length', () => {
  assert.equal(normalizeSeed('  golden hour  '), 'golden hour');
  assert.equal(normalizeSeed(''), '');
  assert.equal(normalizeSeed(null), '');
  assert.equal(normalizeSeed(12345), '12345');
  assert.equal(normalizeSeed('x'.repeat(100)).length, MAX_SEED_LENGTH);
  assert.equal(normalizeSeed(DEFAULT_SEED), DEFAULT_SEED);
});
