/**
 * Turns a user-supplied File into a canvas we can pan, zoom and crop from.
 *
 * iPhone photos arrive with an EXIF orientation flag and at up to ~48MP, so we
 * decode once into a normalised, upright, size-capped canvas and use that as
 * the single source of truth for both the on-screen preview and the export.
 */

/** Longest edge of the working canvas. Also keeps us inside iOS canvas limits. */
export const MAX_WORKING_EDGE = 4096;

export async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const source = await decode(file);
  const canvas = normalise(source);
  if (typeof source.close === 'function') source.close();
  return canvas;
}

async function decode(file) {
  // Preferred path: the decoder applies EXIF orientation for us.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* older Safari ignores the options bag or rejects — fall through */
    }
  }
  return decodeViaElement(file);
}

function decodeViaElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image. HEIC photos may need to be exported as JPEG."));
    };
    img.src = url;
  });
}

function normalise(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error("Couldn't read that image.");

  const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
