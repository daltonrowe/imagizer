import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The storage module reaches for `localStorage` at call time, so a stub set on
 * `globalThis` before importing is enough — no DOM required.
 */
let store = null;
globalThis.localStorage = {
  getItem: () => store,
  setItem: (_key, value) => { store = value; },
};

const { loadSettings, saveSettings, MAX_CROPS } = await import('../src/storage.js');

const from = (stored) => {
  store = stored === null ? null : JSON.stringify(stored);
  return loadSettings();
};

test('a first visit gets one crop and its own seed', () => {
  const settings = from(null);
  assert.deepEqual(settings.crops, [{ w: 1080, h: 1080 }]);
  assert.equal(settings.active, 0);
  assert.ok(settings.seed.length > 0);
});

test('a version 2 single crop becomes a list of one', () => {
  // The earlier migrations dropped the affected field; this one does not need
  // to, because a single crop is a crop list with one entry and nothing about
  // it has to be guessed.
  const settings = from({ version: 2, cropW: 1200, cropH: 630, seed: 'keep-me' });
  assert.deepEqual(settings.crops, [{ w: 1200, h: 630 }]);
  assert.equal(settings.seed, 'keep-me', 'the seed survives the migration');
});

test('framing is never restored from storage', () => {
  // Sizes are worth remembering between visits; a centre is a point in one
  // particular photo, and that photo is not persisted, so restoring it would
  // land somewhere arbitrary on whatever gets opened next.
  const settings = from({
    version: 3,
    crops: [
      { w: 1080, h: 1080, center: { x: 400, y: 250 }, zoom: 2.5 },
      { w: 1080, h: 1920 },
    ],
    active: 1,
    seed: 's',
  });
  assert.deepEqual(settings.crops, [{ w: 1080, h: 1080 }, { w: 1080, h: 1920 }]);
  assert.equal(settings.active, 1, 'which crop you were on does carry over');
});

test('framing is stripped on the way out too', () => {
  saveSettings({
    crops: [{ w: 800, h: 600, center: { x: 1, y: 2 }, zoom: 3 }],
    active: 0,
    seed: 's',
    format: 'image/png',
    chain: [],
    version: 3,
  });
  assert.deepEqual(JSON.parse(store).crops, [{ w: 800, h: 600 }]);
});

test('rubbish in the crop list is repaired rather than trusted', () => {
  const settings = from({
    version: 3,
    crops: [
      { w: 'wide', h: 400 },
      { w: 99999, h: 4 },
      { w: 800, h: 600, zoom: 'lots', center: { x: 'here' } },
    ],
    seed: 's',
  });
  assert.deepEqual(settings.crops[0], { w: 1080, h: 400 }, 'an unreadable size falls back');
  assert.deepEqual(settings.crops[1], { w: 8192, h: 16 }, 'sizes are clamped to the limits');
  assert.deepEqual(settings.crops[2], { w: 800, h: 600 }, 'unreadable framing is simply dropped');
});

test('the crop list is capped, and the active index with it', () => {
  const settings = from({
    version: 3,
    crops: Array.from({ length: 20 }, (_, i) => ({ w: 100 + i, h: 100 })),
    active: 19,
    seed: 's',
  });
  assert.equal(settings.crops.length, MAX_CROPS);
  assert.equal(settings.active, MAX_CROPS - 1, 'an index past the end is pulled back');
});

test('an empty crop list falls back to the default rather than none', () => {
  const settings = from({ version: 3, crops: [], seed: 's' });
  assert.deepEqual(settings.crops, [{ w: 1080, h: 1080 }]);
  assert.equal(settings.active, 0);
});

test('a negative or unreadable active index lands on the first crop', () => {
  for (const active of [-3, 'second', undefined, NaN]) {
    const settings = from({ version: 3, crops: [{ w: 100, h: 100 }, { w: 200, h: 200 }], active, seed: 's' });
    assert.equal(settings.active, 0, `active: ${String(active)}`);
  }
});
