import { loadImageFile } from './image.js';
import { createCropper, MIN_ZOOM, MAX_ZOOM } from './cropper.js';
import { loadSettings, saveSettings, clampSize, MIN_SIZE, MAX_SIZE } from './storage.js';

const PRESETS = [
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Portrait', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Landscape', w: 1920, h: 1080 },
  { label: 'Wallpaper', w: 1290, h: 2796 },
  { label: 'Avatar', w: 512, h: 512 },
];

const JPEG_QUALITY = 0.92;

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
  format: document.getElementById('format'),
  exportBtn: document.getElementById('export'),
  pick: document.getElementById('pick'),
  file: document.getElementById('file'),
  download: document.getElementById('download'),
  quality: document.getElementById('quality'),
  toast: document.getElementById('toast'),
};

const settings = loadSettings();
let sourceName = 'photo';

const cropper = createCropper({
  stage: el.stage,
  layerHost: el.layerHost,
  frame: el.frame,
  onChange: updateReadout,
});

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

el.zoom.addEventListener('input', () => cropper.setZoom(Number(el.zoom.value)));
el.reset.addEventListener('click', () => cropper.reset());

function updateReadout(stats) {
  if (!stats) {
    el.quality.hidden = true;
    el.zoomVal.textContent = '1.00×';
    return;
  }
  el.zoom.value = String(stats.zoom);
  el.zoomVal.textContent = `${stats.zoom.toFixed(2)}×`;

  el.quality.hidden = false;
  el.quality.classList.toggle('warn', stats.upscaled);
  el.quality.textContent = stats.upscaled
    ? `Upscaled — ${Math.round(stats.sampled.w)}×${Math.round(stats.sampled.h)} source px`
    : `${stats.source.w}×${stats.source.h} source`;
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
    cropper.setSource(canvas);
    el.stage.classList.remove('empty-state');
    el.empty.hidden = true;
    el.exportBtn.disabled = false;
    toast('');
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
});

el.exportBtn.addEventListener('click', async () => {
  if (!cropper.hasSource()) return;
  el.exportBtn.disabled = true;
  try {
    const type = settings.format;
    const blob = await cropper.toBlob(type, type === 'image/jpeg' ? JPEG_QUALITY : undefined);
    const name = `${sourceName}-${settings.cropW}x${settings.cropH}.${type === 'image/png' ? 'png' : 'jpg'}`;
    await deliver(blob, name, type);
  } catch (error) {
    toast(error.message || 'Export failed.');
  } finally {
    el.exportBtn.disabled = false;
  }
});

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
    return;
  }
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (duration > 0) toastTimer = setTimeout(() => { el.toast.hidden = true; }, duration);
}

const onResize = () => cropper.resize();
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
el.stage.classList.add('empty-state');
renderPresets();
cropper.setCrop(settings.cropW, settings.cropH);
saveSettings(settings); // pin the defaults on a first visit
