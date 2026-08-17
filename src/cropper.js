/**
 * Pan/zoom cropper.
 *
 * The geometry is stored in *source image pixels* rather than screen pixels:
 *   - `center` is the point of the photo sitting under the middle of the frame
 *   - `zoom` is relative to a "cover" fit, so zoom 1 always fills the crop
 * That makes the position survive rotating the phone, resizing the window and
 * changing the crop size, and it maps straight onto a drawImage() source rect.
 */

import { clampCenter as clampToSource, isUpscaled, sourceRect, viewSize as windowFor } from './framing.js';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

const FRAME_PADDING = 16;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

export function createCropper({ stage, layerHost, frame, onChange }) {
  const pointers = new Map();

  let source = null;         // normalised HTMLCanvasElement
  let crop = { w: 1080, h: 1080 };
  let zoom = 1;
  let center = { x: 0, y: 0 };
  let layout = null;         // { fw, fh, left, top, baseScale }
  let pinch = null;          // { distance, zoom, midpoint }
  let lastTap = 0;
  let lastTapPos = { x: 0, y: 0 };
  let interactive = true;    // off once framing is done and we are showing the result

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function measure() {
    if (!source) {
      layout = null;
      return;
    }
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const availW = Math.max(1, stageW - FRAME_PADDING * 2);
    const availH = Math.max(1, stageH - FRAME_PADDING * 2);
    const aspect = crop.w / crop.h;

    let fw = availW;
    let fh = fw / aspect;
    if (fh > availH) {
      fh = availH;
      fw = fh * aspect;
    }

    layout = {
      fw,
      fh,
      left: (stageW - fw) / 2,
      top: (stageH - fh) / 2,
      baseScale: Math.max(fw / source.width, fh / source.height),
    };
  }

  /** Size of the visible window in source-image pixels. */
  const viewSize = () => windowFor(source, crop, zoom);

  function clampCenter() {
    if (!source) return;
    center = clampToSource(source, viewSize(), center);
  }

  /** Top-left of the visible window, in source-image pixels. */
  function origin() {
    const view = viewSize();
    return { x: center.x - view.w / 2, y: center.y - view.h / 2 };
  }

  function render() {
    if (!source) {
      frame.style.display = 'none';
      return;
    }
    if (!layout) measure();
    clampCenter();

    frame.style.display = '';
    frame.style.width = `${layout.fw}px`;
    frame.style.height = `${layout.fh}px`;
    frame.style.transform = `translate(${layout.left}px, ${layout.top}px)`;

    const scale = layout.baseScale * zoom;
    const start = origin();
    const tx = layout.left - start.x * scale;
    const ty = layout.top - start.y * scale;
    source.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

    onChange?.(stats());
  }

  function stats() {
    if (!source) return null;
    const view = viewSize();
    return {
      zoom,
      crop: { ...crop },
      source: { w: source.width, h: source.height },
      sampled: { w: view.w, h: view.h },
      upscaled: isUpscaled(source, crop, zoom),
    };
  }

  /** Zoom around a point given in stage-relative CSS pixels. */
  function zoomAt(nextZoom, px, py) {
    if (!layout) return;
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (clamped === zoom) return;

    const before = layout.baseScale * zoom;
    const start = origin();
    // Point of the photo currently under (px, py).
    const anchorX = start.x + (px - layout.left) / before;
    const anchorY = start.y + (py - layout.top) / before;

    zoom = clamped;
    const after = layout.baseScale * zoom;
    const view = viewSize();
    center.x = anchorX - (px - layout.left) / after + view.w / 2;
    center.y = anchorY - (py - layout.top) / after + view.h / 2;
    render();
  }

  function panBy(dx, dy) {
    if (!layout) return;
    const scale = layout.baseScale * zoom;
    center.x -= dx / scale;
    center.y -= dy / scale;
    render();
  }

  function stagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  // ---------- interaction ----------

  function capture(pointerId, on) {
    try {
      if (on) stage.setPointerCapture(pointerId);
      else if (stage.hasPointerCapture?.(pointerId)) stage.releasePointerCapture(pointerId);
    } catch {
      /* pointer already gone; capture is an optimisation, not a requirement */
    }
  }

  function onPointerDown(event) {
    if (!source || !interactive) return;
    capture(event.pointerId, true);
    pointers.set(event.pointerId, stagePoint(event));
    stage.classList.add('dragging');

    if (pointers.size === 2) {
      pinch = { ...pinchState(), zoom };
    } else if (pointers.size === 1) {
      detectDoubleTap(event);
    }
  }

  function detectDoubleTap(event) {
    const now = performance.now();
    const point = stagePoint(event);
    const near = Math.hypot(point.x - lastTapPos.x, point.y - lastTapPos.y) < DOUBLE_TAP_SLOP;
    if (now - lastTap < DOUBLE_TAP_MS && near) {
      reset();
      lastTap = 0;
    } else {
      lastTap = now;
      lastTapPos = point;
    }
  }

  function onPointerMove(event) {
    if (!source || !pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const point = stagePoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2) {
      if (!pinch) return;
      const next = pinchState();
      if (pinch.distance > 0) {
        zoomAt(pinch.zoom * (next.distance / pinch.distance), next.midpoint.x, next.midpoint.y);
      }
      panBy(next.midpoint.x - pinch.midpoint.x, next.midpoint.y - pinch.midpoint.y);
      pinch.midpoint = next.midpoint;
      return;
    }

    panBy(point.x - previous.x, point.y - previous.y);
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    capture(event.pointerId, false);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) stage.classList.remove('dragging');
  }

  function onWheel(event) {
    if (!source || !interactive) return;
    event.preventDefault();
    const point = stagePoint(event);
    // ctrlKey means a trackpad pinch; both gestures want the same response.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0022));
    zoomAt(zoom * factor, point.x, point.y);
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', () => { if (interactive) reset(); });

  // ---------- public API ----------

  function setSource(canvas) {
    source = canvas;
    source.className = 'layer';
    layerHost.replaceChildren(source);
    reset();
  }

  function setCrop(w, h) {
    crop = { w, h };
    measure();
    render();
  }

  function setZoom(next) {
    if (!layout) return;
    zoomAt(next, layout.left + layout.fw / 2, layout.top + layout.fh / 2);
  }

  function reset() {
    if (!source) return;
    zoom = MIN_ZOOM;
    center = { x: source.width / 2, y: source.height / 2 };
    measure();
    render();
  }

  function resize() {
    if (!source) return;
    measure();
    render();
  }

  /**
   * Draw the framed region into a context at the given size.
   *
   * The size is a parameter because the preview renders at screen resolution
   * while the export renders at full crop size — same framing, different pixel
   * counts, one code path.
   *
   * Alpha is preserved, so transparency in the photo survives into a PNG.
   * Pass `background` for formats that cannot store alpha: without it browsers
   * flatten JPEG onto black. An opaque photo covers the fill completely.
   */
  function drawCrop(ctx, width, height, { background = null } = {}) {
    if (!source) throw new Error('No photo loaded.');
    const view = viewSize();
    const start = origin();

    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, start.x, start.y, view.w, view.h, 0, 0, width, height);
  }

  /**
   * Draw an arbitrary framing — not necessarily the one on screen.
   *
   * This is what lets several crops preview and export at once: each is a
   * plain `{ crop, center, zoom }`, and none of them has to become the active
   * one first. `drawCrop` is the same call with the live framing filled in.
   */
  function drawView(view, ctx, width, height, { background = null } = {}) {
    if (!source) throw new Error('No photo loaded.');
    const rect = sourceRect(source, view);

    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
  }

  /** The live framing, as plain data the app can store per crop. */
  function getView() {
    return { crop: { ...crop }, center: { ...center }, zoom };
  }

  /** Restore a stored framing. Out-of-range values are clamped as usual. */
  function setView(view) {
    if (!view) return;
    if (view.crop) crop = { w: view.crop.w, h: view.crop.h };
    if (view.center) center = { ...view.center };
    if (Number.isFinite(view.zoom)) zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
    measure();
    render();
  }

  /**
   * Enable or disable framing gestures. Positioning belongs to the crop step;
   * once the stage is showing the finished crop there is no surrounding photo
   * to drag against, so a pan there would just scrub an image that isn't shown.
   */
  function setInteractive(on) {
    interactive = Boolean(on);
    if (interactive) return;
    pointers.clear();
    pinch = null;
    stage.classList.remove('dragging');
  }

  /** Where the crop frame sits within the stage, in CSS pixels. */
  function getFrame() {
    if (!layout) return null;
    return { left: layout.left, top: layout.top, width: layout.fw, height: layout.fh };
  }

  return {
    setSource,
    setCrop,
    setZoom,
    reset,
    resize,
    render,
    // Step one of the render pipeline; see src/pipeline.js for where it is run.
    drawCrop,
    drawView,
    getView,
    setView,
    getFrame,
    setInteractive,
    hasSource: () => Boolean(source),
    getStats: stats,
  };
}
