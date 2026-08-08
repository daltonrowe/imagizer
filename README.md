# Imagizer

An in-browser image effect editor. Everything runs locally — photos are decoded,
cropped and exported on-device, and nothing is ever uploaded.

This first slice covers the input stage: **take a photo from an iPhone, crop it to
a chosen pixel size, and position the photo inside that crop.**

## Running it

There is no build step and no dependencies, but ES modules need to be served over
HTTP rather than opened from the filesystem:

```sh
npx http-server -p 8000 .    # or: python3 -m http.server 8000
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

## Layout

```
index.html      markup + control panel
styles.css      layout, including the phone/landscape/desktop arrangements
src/app.js      wiring: presets, inputs, file loading, export
src/cropper.js  pan/zoom geometry and the crop render
src/image.js    File -> upright, size-capped working canvas
src/storage.js  localStorage with private-mode-safe fallbacks
```

The cropper stores its state in *source image pixels* — `center` is the point of
the photo under the middle of the frame, and `zoom` is relative to a cover fit.
That means the framing survives rotating the phone, resizing the window and
changing the crop size, and it maps directly onto the `drawImage()` source rect
used for export.

## Next

The effects stage plugs in between `src/image.js` and the export: the working
canvas is the input, and `cropper.toBlob()` is the last step in the pipeline.
