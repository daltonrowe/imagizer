/**
 * Crop geometry, in source-image pixels and nothing else.
 *
 * The cropper stores a framing as a `center` (the point of the photo under the
 * middle of the frame) and a `zoom` relative to a cover fit. Everything needed
 * to turn that into a `drawImage` source rect is here, deliberately free of the
 * DOM: the on-screen frame is a consequence of the crop's aspect ratio, not an
 * input to the maths, which is what lets a crop be drawn without being the one
 * currently on screen.
 *
 * That is the whole reason this is a separate module. Previewing and exporting
 * several crops at once means rendering framings other than the active one, and
 * a function that reads the cropper's live state cannot do that.
 */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * The visible window in source pixels.
 *
 * At zoom 1 this is the largest region of the photo with the crop's aspect
 * ratio that fits inside it — the cover fit — so zoom 1 always fills the frame
 * exactly whatever shape either one is.
 */
export function viewSize(source, crop, zoom = 1) {
  const aspect = crop.w / crop.h;
  const width = Math.min(source.width, source.height * aspect) / Math.max(zoom, 1e-6);
  return { w: width, h: width / aspect };
}

/**
 * Pull a centre back until the window sits inside the photo, so the crop is
 * always fully covered and can never be dragged off an edge. A window larger
 * than the photo on an axis has nowhere to go, so it centres on it.
 */
export function clampCenter(source, view, center) {
  return {
    x: view.w >= source.width
      ? source.width / 2
      : clamp(center.x, view.w / 2, source.width - view.w / 2),
    y: view.h >= source.height
      ? source.height / 2
      : clamp(center.y, view.h / 2, source.height - view.h / 2),
  };
}

/** The `drawImage` source rect for a framing: clamped, in source pixels. */
export function sourceRect(source, { crop, center, zoom }) {
  const view = viewSize(source, crop, zoom);
  const middle = clampCenter(source, view, center);
  return { x: middle.x - view.w / 2, y: middle.y - view.h / 2, w: view.w, h: view.h };
}

/** A framing centred on the whole photo at zoom 1 — what a new crop starts as. */
export function defaultView(source) {
  return { center: { x: source.width / 2, y: source.height / 2 }, zoom: 1 };
}

/** True when the crop asks for more pixels than the photo can supply. */
export function isUpscaled(source, crop, zoom) {
  const view = viewSize(source, crop, zoom);
  return view.w < crop.w - 0.5 || view.h < crop.h - 0.5;
}
