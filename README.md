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
- **Crops to several sizes at once.** Add up to six crops of one photo, each
  framed independently, all previewed together and exported in one go — a square
  post, a story and a link card off the same shot without three trips through
  the editor.
- **Remembers the sizes.** The crop sizes (and export format) are written to
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

## Several crops

A crop is a size *plus* a framing — `{ w, h, center, zoom }` — and the editor
holds a list of them. One is active at a time: it is the one on the stage, the
one the presets and the width/height fields edit, and the only one that takes
pan and pinch. The rest keep their framing as plain data until it is their turn.

They share the photo, the seed and the effect chain, which is the point. A set
of sizes of one picture should look like a set, so the chain runs on each crop
with the same seed rather than each being its own edit. Effects that vary by
position — the dithers, grain, bokeh — key on the pixel coordinate, so the
pattern lines up across crops instead of each one getting its own scatter.

Because a crop can be drawn without being the active one, `src/framing.js` holds
the geometry with no DOM in it: given a photo, a size, a centre and a zoom, it
returns the `drawImage` source rect. `cropper.drawView(view, …)` renders any
framing; `drawCrop` is the same call with the live one filled in. The
alternative — making each crop active in turn and putting the stage back
afterwards — would have made previewing a list of crops a sequence of side
effects.

Only the sizes persist. A framing is a point in one particular photo and the
photo is never stored, so a centre restored onto next week's image would land
somewhere arbitrary; loading a new photo starts every crop centred again. Sizes
are worth remembering between visits, and they are what carries over.

Six is the cap. Every crop in the grid renders the whole chain at its own size,
so this is the one place where preview cost scales with how much you have set
up.

## Two steps

The editor is two ordered steps, mirroring the pipeline: **1 Crop** frames the
photo, **2 Effects** processes what was framed.

The stage follows the step, so the preview itself tells you which stage you are
in. Step 1 shows the whole photo, dimmed outside the crop frame, because framing
needs the surrounding context. Step 2 drops the source entirely and shows only
the finished crop at its export size — what is on screen is what the file will
contain, with nothing bleeding in around it.

With more than one crop, step 2 lays them all out side by side instead, sized on
their longest edge so a tall crop and a wide one read as the same size. A single
crop keeps the frame-aligned preview: it is already the exact shape and place
the file will be, and a grid of one would move it for no reason. The crop
outline goes away with the grid, since it describes the active crop and says
nothing useful once every crop is on screen.

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
| **Sharpen** | Unsharp mask, with a threshold so it spares flat areas |
| **Tilt Shift** | Keeps a band sharp and blurs the rest, at any angle |
| **Lens Distortion** | Barrel and pincushion — bends straight lines like a real lens |
| **Chromatic Aberration** | Lens fringing: red and blue part company toward the edges |
| **Levels** | Brightness, contrast, gamma and saturation |
| **Hue Rotate** | Rotates every hue by an angle |
| **Greyscale** | Desaturates by amount |
| **Invert** | Negative, per channel |
| **Colorize** | Tints with a chosen colour, keeping luminance |
| **Duotone** | Maps luminance onto a two-colour ramp |
| **Bloom** | Blurs the highlights and screens them back as a halo |
| **Bokeh** | Turns highlights into out-of-focus aperture discs |
| **Anamorphic Streak** | Draws each highlight out into a flare bar |
| **Star Filter** | Puts diffraction spikes on every point of light |
| **Light Leak** | A warm gradient flare in from one edge |
| **Pixel Sort** | Sorts bright runs into streaks; max run is a share of the line |
| **Channel Sort** | The same sort confined to one RGB channel, tearing colours apart |
| **Channel Shift** | Slides one channel across the frame, wrapping or not |
| **Slicer** | Cuts the image into bands and slides each one along its length |
| **Block Shuffle** | Displaces a grid of blocks, leaving holes behind |
| **Twirl** | Spins the middle and leaves the rim |
| **Ripple** | Sinusoidal waves — rings, rows or columns |
| **Noise Warp** | Displaces by a smooth noise field |
| **Kaleidoscope** | Folds the frame into a wedge and mirrors it around |
| **Scale Repeat** | Stacks scaled copies of the image on itself — the droste |
| **Colour Key** | Knocks a colour out to transparency, matching on hue |
| **Vignette** | Darkens in from the edges, heaviest in the corners |
| **Spotlight** | Darkens everything outside a circle in the middle |
| **Posterize** | Reduces to a few flat tones, per channel or by luminance |
| **Palette** | Snaps to a fixed palette, with ordered dithering |
| **Solarize** | Reverses everything past a threshold |
| **Pixelate** | Flat blocks, averaged or sampled |
| **Edge Detect** | Sobel outlines as a greyscale map |
| **Threshold BW** | One luminance cut, two tones |
| **Channel Threshold** | A separate cut per RGB channel, up to eight colours |
| **Grid Gate** | Masks the image behind a regular grid of square or circular apertures |
| **Shape Mask** | Cuts the frame to a circle, arch, diamond or rounded rectangle |
| **Halftone** | Print screen: tone carried by dot size, mono or CMYK |
| **Atkinson Dither** | Error diffusion — the pattern follows the image |
| **Bayer Dither** | Ordered dithering, a woven crosshatch |
| **Random Dither** | A random threshold per cell — grain, not pattern |
| **Film Grain** | Normally distributed grain, strongest in the midtones |
| **Scanlines** | CRT lines, with an optional RGB phosphor mask |
| **Reblend Original** | Composites the untouched crop back over or under the result |
| **Reblend Previous** | The same, reaching back a chosen number of stages instead |
| **Echo** | Lays several earlier stages back on, each fainter |
| **Difference Key** | Keeps only what an earlier stage changed |

**Posterize** is the same tone quantisation the dithers do, without the
dithering, so the bands stay flat. Per channel snaps red, green and blue
independently for at most levels³ colours — the screen-print look, inventing
hues the photo never had. Luminance mode snaps brightness and scales the
channels to match, so each pixel keeps its own hue and far more colours survive.

**Grid Gate** passes pixels through a fixed grid of apertures and blocks the
rest. One cell size covers both axes, as a percentage of the shorter side, and
the aperture is a percentage of the cell, so the pattern keeps its shape at any
crop size. Measuring against the shorter side is what keeps the cells square on
a crop that isn't: a percentage per axis would stretch them with the frame and
make the square aperture a rectangle. A square aperture at 100% is a no-op; a
circle at 100% still blocks the cell corners, since it is inscribed in the cell
— which is why circular apertures pass π/4 of the image. As with the slicer,
blocked pixels either punch through to transparency or take a colour.

**Slicer** cuts the image into bands — horizontal ones are rows that shift left
and right, vertical ones are columns that shift up and down — with band size,
size jitter and shift all given as percentages, so a look holds at any crop size.
Cross shift displaces a band across the stack as well as along it, so bands land
on their neighbours and leave their own row empty. Shifting does not wrap, so a
band leaves a gap behind it; the toggle decides whether those gaps punch through
to transparency, which a PNG export keeps, or land on a chosen colour.

**Lens Distortion** is the radial map a lens applies to geometry: an output
pixel at distance r from the centre reads the source at r·(1 + k·r²), with r
measured against the half-diagonal so the same Amount looks the same on any
aspect ratio. Positive Amount magnifies the centre relative to the edges, which
draws the corners in and bows straight lines outward — barrel, what a wide-angle
lens does. Negative pushes content outward and bows lines in, which is
pincushion.

The two directions leave different messes. Barrel reads from beyond the source
at the corners, so the frame ends up with empty ones and Edges decides what goes
there — transparency a PNG keeps, a colour, or the edge pixel smeared outward.
Pincushion reads from inside the source, pushing its outer ring off-frame and
covering everything. Zoom scales the whole map, which is the usual way to crop a
barrel's empty corners back out of shot.

**Chromatic Aberration** and **Channel Shift** both pull the colour channels
apart, and the difference is where. The aberration is a lens: the fringe is zero
at the optical centre and grows outward, with Edge bias deciding how fast — 1
scales each channel evenly, 3 keeps the middle of the frame clean and piles the
fringing into the corners. Amount is the fringe width at the corners as a share
of the half-diagonal, and the fringe pair chooses which channel goes out and
which comes in — it is the same radial idea as the lens, applied per channel
instead of to the image as a whole. Channel Shift is flat instead: one channel, moved by a
percentage of the width and height, which is the printing-misregistration look
rather than a lens. It will move alpha too, which slides the cutout out from
under its own colour.

**Bloom** and **Bokeh** both spread the highlights above a threshold and screen
the result back on, so they only ever brighten and stacking them approaches
white instead of overshooting. Bloom blurs that layer into a halo — the sharp
image survives underneath, which is what makes it bloom rather than blur. Bokeh
splats each highlight as an aperture disc: circles for a lens wide open,
hexagons for one stopped down onto its blades, rings for the doughnuts a mirror
lens makes. A true defocus is a disc-shaped convolution costing the disc's area
per pixel, far too slow for a live preview; splatting the highlights is what
people recognise anyway, and it stacks over a Blur when the soft background is
wanted too. Bokeh lays its grid out in cells across the image rather than in
pixels and jitters each cell from its index, so the discs land in the same
places in the preview as in the export instead of rearranging themselves on
download.

Neither touches alpha. Glow that spread past a cutout's edge would have to
invent opacity there and quietly grow the silhouette, so instead the subject's
own shape clips its own glow — the same choice the vignette and the aberration
make.

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
proportions — pixel sort's max run, coverage, bloom's radius, bokeh's disc size
and placement — hold at both sizes, but the dithers work per pixel, so expect
the export to be finer-grained than the preview.

**Levels** is the groundwork the rest of the chain stands on. Everything here
reacts to tone — a threshold cuts where the luminance is, a pixel sort walks the
runs that clear it, a bloom picks the highlights — so a flat photo gives flat
results whatever else is stacked on it. Brightness, contrast and gamma collapse
into one lookup table; saturation needs each pixel's own luminance, so it
happens after.

**Sharpen** and **Tilt Shift** are both the blur with the sign or the mask
changed. Sharpen subtracts a blurred copy to find the detail and adds it back,
with a threshold so film grain and flat sky are spared. Tilt shift blurs the
whole frame once and mixes it back in outside a band, which is what a lens
actually does — one out-of-focus radius, not a gradient of them.

**Duotone** and **Palette** both throw the original colours away, and differ in
what they put back. Duotone re-reads brightness as a position between two chosen
ends, so two pixels of equal luminance come out identical however different they
started. Palette matches against a specific list — Game Boy, CGA, sixteen — so
the output contains those colours and no others, with ordered dithering to mix
adjacent entries rather than band between them.

**Solarize** is the darkroom accident: flash the paper mid-develop and everything
already exposed comes back reversed, with a bright line where the two directions
meet. Softness is how wide that line runs. **Pixelate** and **Edge Detect** are
the two blunt reductions — flat blocks, and Sobel gradients as a greyscale map.
Edge detect stays grey on purpose: Duotone and the reblends already colour things
better than an ink control here would, so edge detect then duotone is ink on
paper, and edge detect then reblend is line art over the photo.

**Halftone** carries tone in the size of a dot rather than the density of
scattered pixels, which is the whole difference from the three dithers and why a
halftone stays readable where a dither turns to mush. CMYK mode runs four screens
at 15°, 75°, 0° and 45° — angles chosen to be maximally out of step, because
plates that line up interfere into blotches instead of reading as colour.

**Film Grain** is normally distributed rather than uniform, which is what
separates silver halide from television static: most of it is subtle and the
occasional speck is not. It is also strongest in the midtones, because fully
exposed or fully unexposed film has no partly-developed crystals left to vary.
**Scanlines** measures its spacing as a share of the height so the line count
survives export, and its RGB mask reproduces the fact that a colour CRT has no
white phosphor — only red, green and blue stripes. Stack Lens Distortion in
front for the bulge of the glass.

**Anamorphic Streak**, **Star Filter** and **Light Leak** join Bloom and Bokeh on
the shared rule that light only ever brightens and never touches alpha. The first
two smear the highlight layer along one or more directions — a gather with the
taps spread across the length rather than one per pixel, which is what keeps a
long streak affordable. Star filter's points go in twos because a cross-screen
filter is ruled lines, and each ruling makes a spike in both directions.

**Twirl**, **Ripple**, **Noise Warp** and **Kaleidoscope** all resample through
the same bilinear sampler and share the same Edges control, except twirl: a
rotation preserves radius, so it is the one geometric effect that cannot leave a
gap. Noise warp's lattice and Block Shuffle's grid are both measured in cells
across the image rather than in pixels, so the same seed distorts the preview and
the export identically instead of rearranging itself on download.

**Scale Repeat** lays copies of the image back over itself, each one a scaling
of the image *as it arrived* rather than of the copy before it — so the sizes are
`factor`, `factor²`, `factor³`. Compounding from the original is what keeps them
clean: chaining each off the last would resample an already resampled image and
the innermost copy would be mush. Under 100% they nest inward from the origin,
which is the picture-within-a-picture; over 100% they grow outward and each
covers more than the last. At exactly 100% every copy lands on the original — a
no-op in Normal, and very much not one in a mode that accumulates, where eight
multiplies is a different image from one. Copies go down largest first so the
last lands on top, which is what makes a shrinking stack read as depth.

Cost scales with iterations, since each is a pass over the frame: a 1080² export
is around 230ms at four and 870ms at twelve.

**Colour Key** matches on hue and saturation with brightness as a separate, much
looser tolerance. A green wall is one colour to the eye but hundreds to the
pixels, all sharing a hue and differing only in how much light fell on them, so a
plain RGB distance would cut the lit parts and leave the shadowed ones.
**Shape Mask** measures every shape as a signed distance from its edge, which is
what lets one softness control feather all of them.

### Reblend

**Reblend Original** composites the untouched crop back over the processed
image, with an opacity, a choice of twelve blend modes, and an order. Threshold a photo to
hard black and white, then reblend the original at 40% and you get the graphic
shape with the real colour pushed back through it.

The "original" is the image as it entered the chain, not the previous stage's
output — reading the previous stage would make the effect a no-op. Effects
declare `needsSource: true` to receive it, and the chain runner only takes the
copy when something asks, since it is the size of the whole crop.

**Reblend Previous** does the same compositing but reaches back a chosen number
of stages: 1 is the image as it stood before the previous effect ran, 2 is
before the two previous, and so on. That makes it a way to soften a single stage
rather than return all the way to the photo — blur, dither, then reblend one
step back at 50% and the dither reads as texture over a still-blurred image. A
count that runs off the front of the chain lands on the chain input, which is
exactly what Reblend Original would have given.

Steps count *applied* effects, so muting one in the middle of the chain shifts
what a given count reaches — which matches what the list looks like with the
muted card greyed out. Effects declare `historyDepth(params)` to ask for
intermediate images and receive `frameAt(steps)`; the runner keeps only as far
back as the deepest reach in the chain, so a twelve-stage chain whose reblend
looks one step back holds three frames, not twelve.

**Echo** reaches back all the distances at once instead of one: each step is
composited at a decaying opacity, oldest first so the nearest stage ends on top.
**Difference Key** compares against an earlier stage and cuts away everything
that came through unchanged, which leaves precisely the footprint of the effects
in between — the sorted streaks without the photo they came from. Both declare
`historyDepth`, so the runner keeps exactly as many frames as they ask for.

Order puts the incoming image above or below the current one, and the blend
mode always applies to whichever ends up on top — the pair really is swapped,
which for an asymmetric mode like Colour Dodge or Soft Light is a different
picture rather than a reversed opacity. Opacity stays with the incoming image
at either end of the stack, since that is the layer being added, so zero is a
no-op both ways.

Underneath behaves the way layers do, which is worth knowing before it looks
broken: an opaque image hides what goes behind it, so Normal mode under a
finished picture does nothing at all. It earns its keep where the current image
is transparent — reblend the photo under a grid-gated threshold and it fills the
holes while the graphic stays on top — and with any mode that genuinely mixes
the two.

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
  "version": 4,
  "seed": "golden hour",
  "crops": [
    { "width": 1080, "height": 1080 },
    { "width": 1080, "height": 1920 }
  ],
  "effects": [
    { "id": "blur", "params": { "radius": 6 } },
    { "id": "atkinson", "params": { "levels": 2, "scale": 2 } }
  ]
}
```

Presets carry sizes, not framings, for the same reason storage does not: a
centre means nothing to whoever opens it with a different photo.

Chain plus seed is everything needed to reproduce a look — a round trip through
JSON renders pixel-identical output. Importing clamps out-of-range params, drops
effects it doesn't recognise and says how many, so a preset from a newer version
degrades instead of failing.

Version 2 renamed Pixel Sort's `maxLength` (pixels) to `maxRun` (a percentage of
the line). Version 3 merged Grid Gate's `cellWidth` and `cellHeight` into one
`cell`. Version 4 widened `crop` into `crops` — the one migration so far that
loses nothing, since a single crop is a list of one and there is no guess to
make. Older presets still load — they just fall back to the default for that
one setting, which is a far better outcome than reading a stored `200` as a
percentage and clamping it to an uncapped line, or picking one of two axes and
silently changing the other.

### Adding an effect

Drop a module in `src/effects/` exporting `{ id, label, stage, params, apply }`
and register it in `src/effects/index.js`. `apply(image, { params, rng })` gets a
`{ data, width, height }` image to mutate in place — the same shape as ImageData
but not the constructor, so effects are testable in Node without a DOM.

Params come in four types — `range`, `toggle`, `select` and `color` — each of
which the UI renders, the normaliser validates, and the randomiser can fill in.
A param can add `showWhen(params)` to declare when it applies: a gap colour hides
itself while the gaps are set to transparent.
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
