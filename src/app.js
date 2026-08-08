import { loadImageFile, hasTransparency } from './image.js';
import { createCropper, MIN_ZOOM, MAX_ZOOM } from './cropper.js';
import { loadSettings, saveSettings, clampSize, MIN_SIZE, MAX_SIZE } from './storage.js';
import { createRng, randomSeed, normalizeSeed } from './random.js';
import {
  EFFECTS,
  getEffect,
  createItem,
  normalizeChain,
  randomChain,
  chainToJSON,
  chainFromJSON,
} from './effects/index.js';
import { renderPipeline } from './pipeline.js';

const PRESETS = [
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Portrait', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Landscape', w: 1920, h: 1080 },
  { label: 'Wallpaper', w: 1290, h: 2796 },
  { label: 'Avatar', w: 512, h: 512 },
];

const JPEG_QUALITY = 0.92;

/** JPEG cannot store alpha; transparency flattens onto this instead of black. */
const JPEG_MATTE = '#ffffff';

const el = {
  stage: document.getElementById('stage'),
  layerHost: document.getElementById('layerHost'),
  frame: document.getElementById('frame'),
  empty: document.getElementById('empty'),
  presets: document.getElementById('presets'),
  cropW: document.getElementById('cropW'),
  cropH: document.getElementById('cropH'),
  swap: document.getElementById('swap'),
  zoom: document.getElementById('zoom'),
  zoomVal: document.getElementById('zoomVal'),
  reset: document.getElementById('reset'),
  seed: document.getElementById('seed'),
  randomize: document.getElementById('randomize'),
  preview: document.getElementById('preview'),
  tabCrop: document.getElementById('tabCrop'),
  tabEffects: document.getElementById('tabEffects'),
  paneCrop: document.getElementById('paneCrop'),
  paneEffects: document.getElementById('paneEffects'),
  tabSettings: document.getElementById('tabSettings'),
  settings: document.getElementById('settings'),
  settingsClose: document.getElementById('settingsClose'),
  chainList: document.getElementById('chain'),
  chainEmpty: document.getElementById('chainEmpty'),
  addEffect: document.getElementById('addEffect'),
  randomizeChain: document.getElementById('randomizeChain'),
  json: document.getElementById('json'),
  jsonCopy: document.getElementById('jsonCopy'),
  jsonDownload: document.getElementById('jsonDownload'),
  jsonApply: document.getElementById('jsonApply'),
  format: document.getElementById('format'),
  exportBtn: document.getElementById('export'),
  pick: document.getElementById('pick'),
  file: document.getElementById('file'),
  download: document.getElementById('download'),
  toast: document.getElementById('toast'),
};

const settings = loadSettings();
let sourceName = 'photo';
let sourceHasAlpha = false;

const cropper = createCropper({
  stage: el.stage,
  layerHost: el.layerHost,
  frame: el.frame,
  onChange: updateReadout,
});

// ---------- seeded randomness ----------

/**
 * The root generator for the current seed. Each effect takes a named stream
 * from it, so the whole chain is reproducible and independent stage by stage.
 * Nothing in the app calls Math.random() — that is what makes a look shareable.
 */
let rng = createRng(settings.seed);

/** Re-run everything downstream of the seed. */
function reseed() {
  rng = createRng(settings.seed);
  schedulePreview();
}

function applySeed(next, { syncInput = true } = {}) {
  const seed = normalizeSeed(next) || settings.seed;
  if (syncInput) el.seed.value = seed;
  if (seed === settings.seed) return;
  settings.seed = seed;
  saveSettings(settings);
  reseed();
}

el.seed.addEventListener('input', () => applySeed(el.seed.value, { syncInput: false }));
el.seed.addEventListener('focus', () => el.seed.select());
// Restore the stored text if the field was left empty or padded with spaces.
el.seed.addEventListener('blur', () => { el.seed.value = settings.seed; });
el.randomize.addEventListener('click', () => applySeed(randomSeed()));

// Debug seam: lets a console session or a test inspect the live state.
globalThis.imagizer = {
  getRng: () => rng,
  getSettings: () => ({ ...settings }),
  getChain: () => structuredClone(chain),
};

// ---------- effect chain ----------

let chain = normalizeChain(settings.chain);

/**
 * Push the chain everywhere it needs to go: storage, the list UI, the JSON
 * panel and the preview. Everything that mutates the chain ends here, so the
 * four views can never drift apart.
 */
function updateChain(next, { rebuild = true } = {}) {
  chain = normalizeChain(next);
  settings.chain = chain;
  saveSettings(settings);
  if (rebuild) renderChain();
  syncChainMeta();
  schedulePreview();
}

function syncChainMeta() {
  el.chainEmpty.hidden = chain.length > 0;
  // Leave the JSON alone while it is being edited, or typing would fight back.
  if (document.activeElement !== el.json) el.json.value = currentJSON();
}

function currentJSON() {
  return chainToJSON({
    chain,
    seed: settings.seed,
    crop: { w: settings.cropW, h: settings.cropH },
  });
}

/**
 * Which effect cards are expanded, by position. Reordering, removing or muting
 * an effect does rebuild the list, and without this every open card would snap
 * shut underneath the hand that touched it.
 */
let openCards = new Set();

function renderChain() {
  el.chainList.replaceChildren(...chain.map((item, index) => renderChainItem(item, index)));
}

function renderChainItem(item, index) {
  const effect = getEffect(item.id);
  const enabled = item.enabled !== false;

  const li = document.createElement('li');
  li.className = `effect${enabled ? '' : ' off'}`;

  const details = document.createElement('details');
  details.open = openCards.has(index);
  details.addEventListener('toggle', () => {
    if (details.open) openCards.add(index);
    else openCards.delete(index);
  });

  const summary = document.createElement('summary');
  summary.innerHTML = `
    <span class="effect-index">${index + 1}</span>
    <span class="effect-name">${effect.label}</span>`;

  const tools = document.createElement('span');
  tools.className = 'effect-tools';
  tools.append(
    tool('↑', 'Move up', index === 0, () => move(index, -1)),
    tool('↓', 'Move down', index === chain.length - 1, () => move(index, 1)),
    tool(enabled ? '◉' : '○', enabled ? 'Disable' : 'Enable', false, () => setEnabled(index, !enabled), enabled),
    tool('✕', 'Remove', false, () => remove(index)),
  );
  summary.append(tools);
  details.append(summary, renderParams(effect, item, index));
  li.append(details);
  return li;
}

function tool(glyph, title, disabled, onClick, pressed) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool';
  button.textContent = glyph;
  button.title = title;
  button.setAttribute('aria-label', title);
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
  button.disabled = disabled;
  button.addEventListener('click', (event) => {
    // Without this the click also toggles the <details> the button sits in.
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderParams(effect, item, index) {
  const wrap = document.createElement('div');
  wrap.className = 'params';

  // Params that only apply in some states — a gap colour is meaningless while
  // the gaps are transparent. They are built either way and shown or hidden
  // afterwards, so nothing has to be rebuilt when the control they follow moves.
  const conditional = [];
  const refresh = () => {
    const current = chain[index]?.params ?? item.params;
    for (const entry of conditional) entry.field.hidden = !entry.showWhen(current);
  };

  for (const spec of effect.params) {
    const value = item.params[spec.key];

    if (spec.type === 'toggle') {
      const label = document.createElement('label');
      label.className = 'param param-toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
      input.addEventListener('change', () => {
        setParam(index, spec.key, input.checked);
        refresh();
      });
      label.append(input, document.createTextNode(spec.label));
      wrap.append(label);
      if (spec.showWhen) conditional.push({ field: label, showWhen: spec.showWhen });
      continue;
    }

    const field = document.createElement('div');
    field.className = 'param';
    const head = document.createElement('div');
    head.className = 'param-head';
    const readout = document.createElement('span');
    readout.className = 'param-value';
    head.append(Object.assign(document.createElement('span'), { textContent: spec.label }), readout);
    field.append(head);

    if (spec.type === 'color') {
      readout.textContent = value;
      readout.classList.add('mono');
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'param-color';
      input.value = value;
      input.addEventListener('input', () => {
        readout.textContent = input.value;
        setParam(index, spec.key, input.value);
      });
      field.append(input);
      wrap.append(field);
      if (spec.showWhen) conditional.push({ field, showWhen: spec.showWhen });
      continue;
    }

    if (spec.type === 'select') {
      readout.textContent = '';
      const select = document.createElement('select');
      for (const option of spec.options) {
        select.append(new Option(option.label, option.value, false, option.value === value));
      }
      select.addEventListener('change', () => {
        setParam(index, spec.key, select.value);
        refresh();
      });
      field.append(select);
    } else {
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'slider';
      Object.assign(input, { min: spec.min, max: spec.max, step: spec.step, value });
      readout.textContent = formatValue(value, spec);
      input.addEventListener('input', () => {
        readout.textContent = formatValue(Number(input.value), spec);
        setParam(index, spec.key, Number(input.value));
      });
      field.append(input);
    }
    wrap.append(field);
    if (spec.showWhen) conditional.push({ field, showWhen: spec.showWhen });
  }

  refresh();
  return wrap;
}

const formatValue = (value, spec) => `${value}${spec.unit ?? ''}`;

/**
 * Changing a param never rebuilds the list. The control already displays its own
 * new value, so there is nothing to refresh — and a rebuild would recreate the
 * <details> it lives in, collapsing the card mid-edit.
 */
function setParam(index, key, value) {
  const next = chain.map((item, i) => (
    i === index ? { ...item, params: { ...item.params, [key]: value } } : item
  ));
  updateChain(next, { rebuild: false });
}

function setEnabled(index, enabled) {
  updateChain(chain.map((item, i) => (i === index ? { ...item, enabled } : item)));
}

function remove(index) {
  // Cards after the removed one shift down a slot; their open state goes too.
  const shifted = new Set();
  for (const open of openCards) {
    if (open < index) shifted.add(open);
    else if (open > index) shifted.add(open - 1);
  }
  openCards = shifted;
  updateChain(chain.filter((_, i) => i !== index));
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= chain.length) return;
  const next = [...chain];
  [next[index], next[target]] = [next[target], next[index]];

  // The open state belongs to the effect, so it moves with it.
  const from = openCards.has(index);
  const to = openCards.has(target);
  openCards.delete(index);
  openCards.delete(target);
  if (to) openCards.add(index);
  if (from) openCards.add(target);

  updateChain(next);
}

el.addEffect.addEventListener('change', () => {
  const id = el.addEffect.value;
  el.addEffect.value = '';
  if (!id) return;
  updateChain([...chain, createItem(id)]);
});

el.randomizeChain.addEventListener('click', () => {
  // A fresh generator, not the art seed: the button has to give something new
  // each press, while the chain it produces is captured as data in the JSON.
  openCards.clear();
  updateChain(randomChain(createRng(randomSeed())));
  showEffectsTab();
});

// ---------- chain JSON ----------

el.jsonCopy.addEventListener('click', async () => {
  const text = currentJSON();
  try {
    await navigator.clipboard.writeText(text);
    toast('Chain JSON copied.');
  } catch {
    // Clipboard needs a secure context and permission; selecting the text is
    // the reliable fallback on iOS.
    el.json.value = text;
    el.json.focus();
    el.json.select();
    toast('Copy blocked — the JSON is selected, copy it manually.');
  }
});

el.jsonDownload.addEventListener('click', () => {
  const blob = new Blob([currentJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  el.download.href = url;
  el.download.download = `imagizer-${settings.seed.replace(/\s+/g, '-')}.json`;
  el.download.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

el.jsonApply.addEventListener('click', () => {
  try {
    const preset = chainFromJSON(el.json.value);
    if (preset.seed) applySeed(preset.seed);
    if (preset.crop) applyCrop(preset.crop.w, preset.crop.h);
    openCards.clear();
    updateChain(preset.chain);
    toast(preset.dropped
      ? `Applied — ${preset.dropped} unknown effect${preset.dropped > 1 ? 's' : ''} skipped.`
      : 'Chain applied.');
  } catch (error) {
    toast(error.message);
  }
});

// ---------- steps ----------

/**
 * The editor is two ordered steps that mirror the render pipeline: frame the
 * photo, then process what was framed. The stage follows along — step 1 shows
 * the untouched photo you are positioning, step 2 shows the processed crop —
 * so the preview itself says which stage you are looking at.
 */
let step = 'crop';

function syncPanes() {
  const effects = step === 'effects';

  el.tabCrop.setAttribute('aria-selected', String(!effects));
  el.tabEffects.setAttribute('aria-selected', String(effects));
  el.paneCrop.hidden = effects;
  el.paneEffects.hidden = !effects;

  // Step 2 shows the finished crop alone — the source photo around it is
  // framing context that belongs to step 1, and gestures go with it.
  el.stage.classList.toggle('result', effects);
  cropper.setInteractive(!effects);
}

function showStep(next) {
  const previous = step;
  step = next === 'effects' ? 'effects' : 'crop';
  syncPanes();
  // Only a step change alters what the stage renders.
  if (step !== previous) invalidatePreview();
}

const showEffectsTab = () => showStep('effects');

el.tabCrop.addEventListener('click', () => showStep('crop'));
el.tabEffects.addEventListener('click', () => showStep('effects'));

// ---------- settings drawer ----------

/**
 * Seed, export format and the chain JSON live in a modal drawer rather than a
 * pane: they apply to both steps, and as a dialog they leave the editor exactly
 * as it was underneath — same step, same stage, no reflow.
 */
el.tabSettings.addEventListener('click', () => {
  // The gear can only open it: a full-screen modal covers the gear, so the way
  // back out is the close button or Escape. The guard is for safety, since
  // showModal() throws on an already-open dialog.
  if (el.settings.open) return;
  el.settings.showModal();
  el.tabSettings.setAttribute('aria-expanded', 'true');
});

el.settingsClose.addEventListener('click', () => el.settings.close());

// Fires for the close button and for Escape alike, so the gear tracks both.
// (Set here rather than on `toggle`, which dialogs only started firing
// recently and Safari may not send at all.)
el.settings.addEventListener('close', () => el.tabSettings.setAttribute('aria-expanded', 'false'));

// ---------- preview ----------

/**
 * The preview renders at screen resolution rather than crop resolution: a
 * 1080x1080 export is 1.2M pixels through five effects, which is a visible
 * stall on a phone for something the screen shows at a quarter of the size.
 * The export always re-runs the chain at full size.
 */
const PREVIEW_MAX_EDGE = 1400;
let previewTimer = 0;

/** Re-render shortly; the old frame stays up meanwhile. */
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 90);
}

/**
 * For changes that move or resize the frame. The existing preview is the wrong
 * shape or in the wrong place, so it has to go rather than linger misaligned.
 */
function invalidatePreview() {
  el.preview.hidden = true;
  schedulePreview();
}

function renderPreview() {
  const frame = cropper.getFrame();
  // Step 1 shows the untouched photo you are framing. Step 2 shows the crop on
  // its own — always, even with an empty chain, because the cropped image is
  // what the chain is applied to and the stage has nothing else on it.
  if (step !== 'effects' || !cropper.hasSource() || !frame) {
    el.preview.hidden = true;
    return;
  }

  // Cap the working size by the crop itself, so a small crop is never upscaled
  // for the preview and then downscaled again by the browser.
  const density = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(
    settings.cropW / frame.width,
    PREVIEW_MAX_EDGE / Math.max(frame.width, frame.height),
    density,
  );
  const width = Math.max(1, Math.round(frame.width * Math.max(scale, 0.5)));
  const height = Math.max(1, Math.round(frame.height * Math.max(scale, 0.5)));

  el.preview.width = width;
  el.preview.height = height;
  renderPipeline({
    ctx: el.preview.getContext('2d', { willReadFrequently: true }),
    drawCrop: cropper.drawCrop,
    width,
    height,
    chain,
    rng,
  });

  positionPreview(frame);
  el.preview.hidden = false;
}

function positionPreview(frame) {
  el.preview.style.width = `${frame.width}px`;
  el.preview.style.height = `${frame.height}px`;
  el.preview.style.transform = `translate(${frame.left}px, ${frame.top}px)`;
}

// No gesture handling for the preview: framing only happens on step 1, where
// the preview is hidden anyway, and hiding it on a stray tap during step 2
// would blank the stage with nothing to bring it back.

// ---------- crop size ----------

function renderPresets() {
  el.presets.replaceChildren(...PRESETS.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.innerHTML = `${preset.label}<small>${preset.w}&times;${preset.h}</small>`;
    button.setAttribute('aria-pressed', String(preset.w === settings.cropW && preset.h === settings.cropH));
    button.addEventListener('click', () => applyCrop(preset.w, preset.h));
    return button;
  }));
}

function applyCrop(w, h, { syncInputs = true } = {}) {
  settings.cropW = clampSize(w, settings.cropW);
  settings.cropH = clampSize(h, settings.cropH);
  if (syncInputs) {
    el.cropW.value = settings.cropW;
    el.cropH.value = settings.cropH;
  }
  saveSettings(settings);
  renderPresets();
  cropper.setCrop(settings.cropW, settings.cropH);
  updateReadout(cropper.getStats());
  invalidatePreview();
}

function readSizeInputs() {
  // Allow a temporarily empty/short field while typing; only commit valid values.
  const w = Number(el.cropW.value);
  const h = Number(el.cropH.value);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  if (w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) return;
  applyCrop(w, h, { syncInputs: false });
}

el.cropW.addEventListener('input', readSizeInputs);
el.cropH.addEventListener('input', readSizeInputs);

// Snap the fields back to the stored values when the user leaves them blank.
for (const input of [el.cropW, el.cropH]) {
  input.addEventListener('blur', () => {
    el.cropW.value = settings.cropW;
    el.cropH.value = settings.cropH;
  });
}

el.swap.addEventListener('click', () => applyCrop(settings.cropH, settings.cropW));

// ---------- zoom ----------

el.zoom.addEventListener('input', () => {
  cropper.setZoom(Number(el.zoom.value));
  invalidatePreview();
});
el.reset.addEventListener('click', () => {
  cropper.reset();
  invalidatePreview();
});

function updateReadout(stats) {
  if (!stats) {
    el.zoomVal.textContent = '1.00×';
    return;
  }
  el.zoom.value = String(stats.zoom);
  el.zoomVal.textContent = `${stats.zoom.toFixed(2)}×`;

  // Keep the effect preview glued to the frame as it moves or resizes.
  const frame = cropper.getFrame();
  if (frame && !el.preview.hidden) positionPreview(frame);
}

// ---------- loading a photo ----------

el.pick.addEventListener('click', () => el.file.click());
el.empty.addEventListener('click', () => el.file.click());

el.file.addEventListener('change', () => {
  const file = el.file.files?.[0];
  if (file) openFile(file);
  el.file.value = ''; // allow re-picking the same photo
});

async function openFile(file) {
  try {
    toast('Loading photo…', 0);
    const canvas = await loadImageFile(file);
    sourceName = file.name?.replace(/\.[^.]+$/, '') || 'photo';
    sourceHasAlpha = hasTransparency(canvas);
    cropper.setSource(canvas);
    el.stage.classList.remove('empty-state');
    el.empty.hidden = true;
    el.exportBtn.disabled = false;
    toast(sourceHasAlpha && settings.format === 'image/jpeg'
      ? 'This photo has transparency — switch to PNG to keep it.'
      : '');
    invalidatePreview();
  } catch (error) {
    toast(error.message || "Couldn't open that photo.");
  }
}

// drag & drop / paste, for desktop
el.stage.addEventListener('dragover', (event) => {
  event.preventDefault();
  el.stage.classList.add('dropping');
});
el.stage.addEventListener('dragleave', () => el.stage.classList.remove('dropping'));
el.stage.addEventListener('drop', (event) => {
  event.preventDefault();
  el.stage.classList.remove('dropping');
  const file = event.dataTransfer?.files?.[0];
  if (file) openFile(file);
});
window.addEventListener('paste', (event) => {
  const file = [...(event.clipboardData?.files || [])][0];
  if (file) openFile(file);
});

// ---------- export ----------

el.format.addEventListener('change', () => {
  settings.format = el.format.value;
  saveSettings(settings);
  if (settings.format === 'image/jpeg' && sourceHasAlpha) {
    toast('JPEG has no alpha channel — transparency will be filled with white.');
  }
});

el.exportBtn.addEventListener('click', async () => {
  if (!cropper.hasSource()) return;
  el.exportBtn.disabled = true;
  try {
    const type = settings.format;
    const jpeg = type === 'image/jpeg';

    // Same pipeline as the preview — crop, then effects — but at full crop
    // resolution, which makes this the authoritative render.
    const canvas = document.createElement('canvas');
    canvas.width = settings.cropW;
    canvas.height = settings.cropH;
    renderPipeline({
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      drawCrop: cropper.drawCrop,
      width: canvas.width,
      height: canvas.height,
      // PNG keeps the alpha channel; JPEG cannot, so flatten predictably.
      background: jpeg ? JPEG_MATTE : null,
      chain,
      rng,
    });

    const blob = await canvasToBlob(canvas, type, jpeg ? JPEG_QUALITY : undefined);
    const name = `${sourceName}-${settings.cropW}x${settings.cropH}.${jpeg ? 'jpg' : 'png'}`;
    await deliver(blob, name, type);
  } catch (error) {
    toast(error.message || 'Export failed.');
  } finally {
    el.exportBtn.disabled = false;
  }
});

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed.'))),
      type,
      quality,
    );
  });
}

async function deliver(blob, name, type) {
  const file = new File([blob], name, { type });

  // On iOS this opens the share sheet, which is the only way to get the crop
  // back into the camera roll. Falls back to a plain download elsewhere.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      /* share unavailable at runtime — fall through to download */
    }
  }

  const url = URL.createObjectURL(blob);
  el.download.href = url;
  el.download.download = name;
  el.download.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Saved ${name}`);
}

// ---------- misc ----------

let toastTimer = 0;
function toast(message, duration = 2600) {
  clearTimeout(toastTimer);
  if (!message) {
    el.toast.hidden = true;
    el.toast.textContent = '';
    return;
  }
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (duration > 0) toastTimer = setTimeout(() => { el.toast.hidden = true; }, duration);
}

const onResize = () => {
  cropper.resize();
  invalidatePreview();
};
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(onResize).observe(el.stage);
} else {
  window.addEventListener('resize', onResize);
}
window.addEventListener('orientationchange', () => setTimeout(onResize, 150));

// Stop iOS from rubber-banding the page while dragging inside the stage.
document.addEventListener('touchmove', (event) => {
  if (el.stage.contains(event.target)) event.preventDefault();
}, { passive: false });

// ---------- boot ----------

el.zoom.min = String(MIN_ZOOM);
el.zoom.max = String(MAX_ZOOM);
el.cropW.value = settings.cropW;
el.cropH.value = settings.cropH;
el.format.value = settings.format;
el.seed.value = settings.seed;
el.stage.classList.add('empty-state');
el.addEffect.replaceChildren(
  new Option('Add effect…', ''),
  ...EFFECTS.map((effect) => new Option(effect.label, effect.id)),
);
renderPresets();
renderChain();
syncChainMeta();
syncPanes();
invalidatePreview();
cropper.setCrop(settings.cropW, settings.cropH);
saveSettings(settings); // pin the defaults on a first visit
