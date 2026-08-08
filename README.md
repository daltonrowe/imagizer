# Imagizer

An in-browser image effect editor. Everything runs locally — photos are decoded,
cropped and exported on-device, and nothing is ever uploaded.

This first slice covers the input stage: **take a photo from an iPhone, crop it to
a chosen pixel size, and position the photo inside that crop.**

## Running it

There is no build step and no dependencies, but ES modules need to be served over
HTTP rather than opened from the filesystem:

```sh
npm start        # or: python3 -m http.server 8000
npm test         # unit tests for the seeded generator (node --test)
```

Then open `http://localhost:8000`. To try it on a phone, serve it over your LAN or
any static host (GitHub Pages, Netlify, …) — the whole app is static files.

## What it does

- **Accepts photos from an iPhone.** The picker opens the camera roll (or camera)
  and accepts anything the browser can decode. EXIF orientation is applied on
  decode, so portrait shots aren't sideways, and photos are normalised once into a
  working canvas capped at 4096px on the long edge — which keeps 48MP originals
  inside iOS's canvas limits. Drag-and-drop and paste work on desktop.
- **Crops to an exact pixel size.** Presets for the usual social/wallpaper sizes,
  plus free width/height entry and a swap button for flipping the orientation. The
  export is rendered at exactly the requested pixel dimensions.
- **Remembers the size.** The crop size (and export format) are written to
  `localStorage` and restored on the next visit, so a repeated crop is one tap.
- **Positions the photo in the crop.** Drag to pan, pinch or scroll to zoom,
  double-tap to reset. The photo is clamped so it can never be dragged away from
  an edge of the frame — the crop is always fully covered.
- **Exports.** JPEG or PNG. On iOS the share sheet opens so the crop can go back
  to the camera roll; elsewhere it downloads.

A badge in the header shows the source resolution, and turns amber when the crop
asks for more pixels than the photo can supply at the current zoom.

## Seeded randomness

Effects that involve randomness — grain, glitch, scatter, dithering — draw from a
single seed shown in the control panel, so a look is reproducible and shareable:
the same seed gives the same result on any device, in any session. The seed is
free text (type `golden hour` if you like), persists in `localStorage`, and the
🎲 button rolls a fresh readable one.

Nothing draws from the generator yet, so changing the seed is currently invisible.
The plumbing is in place for the effects to come.

Effects should never call `Math.random()`. They take a **named stream** from the
root generator instead:

```js
const grain = rng.fork('grain');
grain.gaussian(0, 12);       // normal distribution, the shape film grain wants
grain.noiseAt(x, y);         // stateless per-pixel value in [0, 1)
```

Streams are derived from the seed *by name*, not by draw order, so adding an
effect, reordering the stack or toggling one off never disturbs another effect's
output — the failure mode of a single shared sequence, where one new draw
re-shuffles everything downstream. `noiseAt(x, y)` matters for the same reason at
the pixel level: a value that depends only on the coordinate means a preview and
a full-size export agree, however the work is chunked.

Under the hood it is sfc32 seeded by a cyrb128 hash, with the guarantees covered
by `npm test`: reproducibility, stream independence, uniform distribution, and
inclusive integer bounds.

## Layout

```
index.html      markup + control panel
styles.css      layout, including the phone/landscape/desktop arrangements
src/app.js      wiring: presets, inputs, seed, file loading, export
src/cropper.js  pan/zoom geometry and the crop render
src/image.js    File -> upright, size-capped working canvas
src/random.js   seeded, forkable deterministic generator
src/storage.js  localStorage with private-mode-safe fallbacks
test/           unit tests (node --test)
```

The cropper stores its state in *source image pixels* — `center` is the point of
the photo under the middle of the frame, and `zoom` is relative to a cover fit.
That means the framing survives rotating the phone, resizing the window and
changing the crop size, and it maps directly onto the `drawImage()` source rect
used for export.

## Next

The effects stage plugs in between `src/image.js` and the export: the working
canvas is the input, `rng.fork('<effect>')` supplies the randomness, and
`cropper.toBlob()` is the last step in the pipeline. `applyEffects()` in
`src/app.js` is where the stack will run — it already re-runs on a seed change.
