# Imagizer

An in-browser image effect editor. Everything runs locally — photos are decoded,
cropped and exported on-device, and nothing is ever uploaded.

Take a photo from an iPhone, crop and position it at an exact pixel size, run it
through a chain of effects, and export it — with a seed that makes any result
reproducible.

## Running it

There is no build step and no dependencies, but ES modules need to be served over
HTTP rather than opened from the filesystem:

```sh
npm start        # or: python3 -m http.server 8000
npm test         # unit tests for the generator and every effect (node --test)
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
- **Exports.** PNG by default, preserving the alpha channel end to end, so a
  cutout stays a cutout — transparency shows as a checkerboard in the preview.
  JPEG is available but cannot store alpha, so transparency is flattened onto
  white (browsers default to black) and the app says so before you export. On
  iOS the share sheet opens so the crop can go back to the camera roll;
  elsewhere it downloads.

## Two steps

The editor is two ordered steps, mirroring the pipeline: **1 Crop** frames the
photo, **2 Effects** processes what was framed.

The stage follows the step, so the preview itself tells you which stage you are
in. Step 1 shows the whole photo, dimmed outside the crop frame, because framing
needs the surrounding context. Step 2 drops the source entirely and shows only
the finished crop at its export size — what is on screen is what the file will
contain, with nothing bleeding in around it.

Framing gestures belong to step 1 for the same reason: with no photo behind the
crop, a pan on step 2 would scrub an image that isn't on screen. Step 2 renders
the crop whether or not the chain has anything in it, since the cropped image is
what the chain is applied to. Changing the crop afterwards is fine — step 2
re-renders from the new crop.

The numbered stepper is the navigation, in both directions, and **Download** sits
below it on every screen. Beside the stepper, a gear opens a full-screen drawer
holding the seed, the export format and the chain JSON — everything that applies
to both steps rather than to one of them.

The drawer is a native `<dialog>`, so Escape, focus trapping and an inert
background come for free, and being in the top layer it leaves the editor exactly
as it was underneath: same step, same stage size, no reflow. It closes with the
button or Escape — a full-screen modal covers the gear, so the gear can only ever
open it.

Sliders are 44px tall with a 28px thumb — the native control is replaced
outright, since `accent-color` cannot grow a thumb that is a few pixels wide on
a phone.

## Effects

An effect chain runs on the cropped region: the output of each effect is the
input of the next. Each has its own settings:

| Effect | What it does |
| --- | --- |
| **Blur** | Box blur, three passes, alpha-safe |
| **Hue Rotate** | Rotates every hue by an angle |
| **Greyscale** | Desaturates by amount |
| **Colorize** | Tints with a chosen colour, keeping luminance |
| **Pixel Sort** | Sorts bright runs into streaks; max run is a share of the line |
| **Channel Sort** | The same sort confined to one RGB channel, tearing colours apart |
| **Slicer** | Cuts the image into bands and slides each one along its length |
| **Grid Gate** | Masks the image behind a regular grid of square or circular apertures |
| **Vignette** | Darkens in from the edges, heaviest in the corners |
| **Spotlight** | Darkens everything outside a circle in the middle |
| **Threshold BW** | One luminance cut, two tones |
| **Channel Threshold** | A separate cut per RGB channel, up to eight colours |
| **Atkinson Dither** | Error diffusion — the pattern follows the image |
| **Bayer Dither** | Ordered dithering, a woven crosshatch |
| **Random Dither** | A random threshold per cell — grain, not pattern |
| **Reblend Original** | Composites the untouched crop back on top |

**Grid Gate** passes pixels through a fixed grid of apertures and blocks the
rest. Cell size is a percentage of each axis and the aperture a percentage of the
cell, so the pattern keeps its shape at any crop size. A square aperture at 100%
is a no-op; a circle at 100% still blocks the cell corners, since it is inscribed
in the cell — which is why circular apertures pass π/4 of the image. As with the
slicer, blocked pixels either punch through to transparency or take a colour.

**Slicer** cuts the image into bands — horizontal ones are rows that shift left
and right, vertical ones are columns that shift up and down — with band size,
size jitter and shift all given as percentages, so a look holds at any crop size.
Shifting does not wrap, so a band leaves a gap behind it; the toggle decides
whether those gaps punch through to transparency, which a PNG export keeps, or
land on a chosen colour.

Pixel Sort and Channel Sort share one walk over the image and differ in what
moves. Pixel Sort keys on luminance and moves whole pixels, so every colour in
the image survives and only its position changes. Channel Sort keys on one
channel and moves only that channel, leaving the other two in place — pixels come
apart rather than being reordered, and the seam shows as colour fringing. Its
threshold reads that channel too, so a saturated red clears a red threshold it
would never clear on luminance.

Vignette and Spotlight share one falloff and differ only in how distance from
the centre is measured. The vignette scales each axis by its own half-size, so
its clear region is an ellipse that follows the frame and every edge midpoint
darkens equally. The spotlight scales both axes alike, so its lit region stays a
true circle — on a wide crop the vignette hugs the sides while the spotlight
leaves broad dark bands left and right.

The three dithers differ only in how each cell picks its tone, so they share the
same scaffolding — average to a grid, decide, paint back as blocks — and the same
Levels and Pixel size controls. Atkinson pushes its rounding error onto
neighbours, Bayer compares against a fixed matrix (no randomness at all, so it
ignores the seed), and Random rolls a threshold from `noiseAt(x, y)`.

The chain is plain data, `[{ id, enabled, params }, ...]`, which is what makes it
storable, shareable and undoable. Reorder with the arrows, mute a stage without
deleting it, or drop one entirely. **Randomize** builds a chain of 2–5 distinct
effects with randomised settings.

Two details make randomised chains look deliberate rather than arbitrary. Each
effect declares a `stage`, and a random chain is sorted by it — blur softens the
source, pixel sort works on real tones, threshold and dither finish. And each
param declares a `random` hint narrower than its slider range: blur goes to a
radius of 40, but a random chain that reaches for it just returns mush.

Effects run twice at different resolutions. The preview renders at screen size,
because a 1080×1080 crop is 1.2M pixels through five effects and that stalls a
phone for something displayed at a quarter of the size; the export re-runs the
chain at full crop resolution and is authoritative. Settings expressed as
proportions — pixel sort's max run, coverage — hold at both sizes, but the
dithers work per pixel, so expect the export to be finer-grained than the
preview.

### Reblend

**Reblend Original** composites the untouched crop back over the processed
image, with an opacity and a choice of twelve blend modes. Threshold a photo to
hard black and white, then reblend the original at 40% and you get the graphic
shape with the real colour pushed back through it.

The "original" is the image as it entered the chain, not the previous stage's
output — reading the previous stage would make the effect a no-op. Effects
declare `needsSource: true` to receive it, and the chain runner only takes the
copy when something asks, since it is the size of the whole crop.

Blending follows the W3C compositing spec rather than a plain cross-fade, so the
modes match `mix-blend-mode` and Photoshop, and alpha composites correctly
instead of the overlay punching a hole through a cutout. One consequence worth
knowing: soft light preserves pure black and pure white, so reblending it over a
thresholded image does nothing at all — that is the formula behaving, not a bug.

### Chain JSON

The gear panel's **Chain JSON** box serialises the chain, the seed and the crop
size as a preset you can copy, download, or paste back in:

```json
{
  "format": "imagizer.chain",
  "version": 2,
  "seed": "golden hour",
  "crop": { "width": 1080, "height": 1080 },
  "effects": [
    { "id": "blur", "params": { "radius": 6 } },
    { "id": "atkinson", "params": { "levels": 2, "scale": 2 } }
  ]
}
```

Chain plus seed is everything needed to reproduce a look — a round trip through
JSON renders pixel-identical output. Importing clamps out-of-range params, drops
effects it doesn't recognise and says how many, so a preset from a newer version
degrades instead of failing.

Version 2 renamed Pixel Sort's `maxLength` (pixels) to `maxRun` (a percentage of
the line). Version 1 presets still load — they just fall back to the default for
that one setting, which is a far better outcome than reading a stored `200` as a
percentage and clamping it to an uncapped line.

### Adding an effect

Drop a module in `src/effects/` exporting `{ id, label, stage, params, apply }`
and register it in `src/effects/index.js`. `apply(image, { params, rng })` gets a
`{ data, width, height }` image to mutate in place — the same shape as ImageData
but not the constructor, so effects are testable in Node without a DOM.

Params come in four types — `range`, `toggle`, `select` and `color` — each of
which the UI renders, the normaliser validates, and the randomiser can fill in.
Colour params are `#rrggbb` strings; random ones are drawn in HSL so they come
out vivid rather than the muddy greys uniform RGB mostly produces.

## Seeded randomness

Effects that involve randomness — grain, glitch, scatter, dithering — draw from a
single seed shown in the control panel, so a look is reproducible and shareable:
the same seed gives the same result on any device, in any session. The seed is
free text (type `golden hour` if you like), persists in `localStorage`, and the
🎲 button rolls a fresh readable one.

Effects never call `Math.random()`. They take a **named stream** from the root
generator instead:

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
src/pipeline.js the render order: crop first, then effects
src/image.js    File -> upright, size-capped working canvas
src/effects/    one module per effect, plus the registry and chain runner
src/random.js   seeded, forkable deterministic generator
src/storage.js  localStorage with private-mode-safe fallbacks
test/           unit tests (node --test)
```

The cropper stores its state in *source image pixels* — `center` is the point of
the photo under the middle of the frame, and `zoom` is relative to a cover fit.
That means the framing survives rotating the phone, resizing the window and
changing the crop size, and it maps directly onto the `drawImage()` source rect
used for export.

## Pipeline

    File -> upright working canvas -> crop -> effect chain -> PNG/JPEG
            src/image.js             cropper  src/effects    export

The crop is always step one and effects always step two, so effects see the
framed region and nothing else: a pixel sort finds its run boundaries at the crop
edges, a dither diffuses error only within the crop, and a blur samples only
pixels the crop includes.

That order lives in `src/pipeline.js`, which both the preview and the export call
— they differ only in the pixel size the crop is rendered at. Keeping the
sequence in one function is what stops the two paths from drifting apart, and
`test/pipeline.test.mjs` asserts the ordering directly against a recording
context.
