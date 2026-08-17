import test from 'node:test';
import assert from 'node:assert/strict';

import { clampCenter, defaultView, isUpscaled, sourceRect, viewSize } from '../src/framing.js';

const photo = { width: 4000, height: 3000 };
const close = (a, b, why) => assert.ok(Math.abs(a - b) < 0.001, `${why}: ${a} vs ${b}`);

test('zoom 1 is the cover fit, whatever shape either one is', () => {
  // Square crop on a landscape photo: height is the limit, so the window is a
  // 3000-square. Nothing is left over vertically, which is what "cover" means.
  const square = viewSize(photo, { w: 1080, h: 1080 }, 1);
  close(square.w, 3000, 'square width');
  close(square.h, 3000, 'square height');

  // Wider than the photo: now width is the limit and the window loses height.
  const wide = viewSize(photo, { w: 1600, h: 400 }, 1);
  close(wide.w, 4000, 'wide width');
  close(wide.h, 1000, 'wide height');

  // Taller than the photo: height is the limit again.
  const tall = viewSize(photo, { w: 1080, h: 1920 }, 1);
  close(tall.h, 3000, 'tall height');
  close(tall.w, 1687.5, 'tall width');
});

test('the window keeps the crop aspect ratio at every zoom', () => {
  for (const zoom of [1, 1.5, 3, 8]) {
    for (const crop of [{ w: 1080, h: 1080 }, { w: 1200, h: 630 }, { w: 1080, h: 1920 }]) {
      const view = viewSize(photo, crop, zoom);
      close(view.w / view.h, crop.w / crop.h, `aspect at zoom ${zoom}`);
    }
  }
});

test('zooming in halves the window', () => {
  const one = viewSize(photo, { w: 1080, h: 1080 }, 1);
  const two = viewSize(photo, { w: 1080, h: 1080 }, 2);
  close(two.w, one.w / 2, 'width');
  close(two.h, one.h / 2, 'height');
});

test('a zoom of zero cannot divide by zero', () => {
  const view = viewSize(photo, { w: 1080, h: 1080 }, 0);
  assert.ok(Number.isFinite(view.w) && Number.isFinite(view.h));
});

test('the centre is pulled back so the crop is always covered', () => {
  const view = viewSize(photo, { w: 1080, h: 1080 }, 2); // a 1500-square window
  // Dragged hard into the top-left corner.
  const corner = clampCenter(photo, view, { x: -900, y: -900 });
  close(corner.x, 750, 'left edge');
  close(corner.y, 750, 'top edge');

  const far = clampCenter(photo, view, { x: 99999, y: 99999 });
  close(far.x, 3250, 'right edge');
  close(far.y, 2250, 'bottom edge');
});

test('a window wider than the photo centres on it instead', () => {
  // At zoom 1 a square crop's window is 3000 tall — the whole photo height —
  // so there is nowhere to move vertically and the clamp must not invert.
  const view = viewSize(photo, { w: 1080, h: 1080 }, 1);
  const centred = clampCenter(photo, view, { x: 2000, y: 0 });
  close(centred.y, 1500, 'vertical centre');
  close(centred.x, 2000, 'horizontal is still free');
});

test('the source rect lands inside the photo', () => {
  for (const zoom of [1, 2, 5]) {
    for (const crop of [{ w: 1080, h: 1080 }, { w: 1200, h: 630 }, { w: 640, h: 1600 }]) {
      const rect = sourceRect(photo, { crop, center: { x: -500, y: 9000 }, zoom });
      assert.ok(rect.x >= -0.001, `left edge at zoom ${zoom}`);
      assert.ok(rect.y >= -0.001, `top edge at zoom ${zoom}`);
      assert.ok(rect.x + rect.w <= photo.width + 0.001, `right edge at zoom ${zoom}`);
      assert.ok(rect.y + rect.h <= photo.height + 0.001, `bottom edge at zoom ${zoom}`);
    }
  }
});

test('two crops of one photo read the same framing independently', () => {
  // The reason this module exists: a framing is data, so several crops can be
  // drawn from one photo without any of them being the active one.
  const centre = { x: 1200, y: 900 };
  const square = sourceRect(photo, { crop: { w: 1080, h: 1080 }, center: centre, zoom: 2 });
  const story = sourceRect(photo, { crop: { w: 1080, h: 1920 }, center: centre, zoom: 2 });

  close(square.w / square.h, 1, 'the square stays square');
  close(story.w / story.h, 1080 / 1920, 'the story stays tall');
  // Same centre, so the two windows are concentric where the clamp allows.
  close(square.x + square.w / 2, story.x + story.w / 2, 'shared horizontal centre');
  close(square.y + square.h / 2, story.y + story.h / 2, 'shared vertical centre');
});

test('a new crop starts centred at zoom 1', () => {
  assert.deepEqual(defaultView(photo), { center: { x: 2000, y: 1500 }, zoom: 1 });
});

test('upscaling is reported when the crop outruns the photo', () => {
  assert.equal(isUpscaled(photo, { w: 1080, h: 1080 }, 1), false, '3000px of photo for 1080px of crop');
  assert.equal(isUpscaled(photo, { w: 1080, h: 1080 }, 4), true, 'zoomed to 750px for 1080px of crop');
  assert.equal(isUpscaled(photo, { w: 6000, h: 6000 }, 1), true, 'a crop larger than the photo');
});
