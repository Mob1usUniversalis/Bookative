// Image store and import pipeline.
//
// Every project keeps its pictures as separate files (on Android in
// img/<projectId>/ of the chosen storage, in a desktop browser in localStorage).
// Text fields reference them as <img data-img="NAME" data-size="…">, and
// character/location/object pictures as "img:NAME", so the project JSON stays
// small and saving stays fast however many pictures a novel has.
import { uid } from './util.js';
import { getProject } from './store.js';
import { nativeAsync, toBase64, fromBase64, pickFiles } from './platform.js';

const bridge = window.AndroidBridge;
export const MAX_DIM = 1600;
export const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const SIZES = ['small', 'medium', 'full'];
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
const pidNow = () => getProject()?.id;
const lsKey = (pid, name) => `bookativeimg:${pid}/${name}`;

// ---------------------------------------------------------------- store

let base = null;

export function imageUrl(name, pid = pidNow()) {
  if (!name || !pid || !NAME_RE.test(name)) return TRANSPARENT;
  if (bridge) {
    if (!base) base = bridge.imageBase();
    return `${base}${pid}/${encodeURIComponent(name)}`;
  }
  const b64 = localStorage.getItem(lsKey(pid, name));
  return b64 ? `data:${mimeOf(name)};base64,${b64}` : TRANSPARENT;
}

/** Resolves a picture reference ("img:NAME", a legacy data: URL, or a bare NAME). */
export function imgSrc(ref, pid = pidNow()) {
  if (!ref) return '';
  if (ref.startsWith('data:')) return ref;
  return imageUrl(ref.startsWith('img:') ? ref.slice(4) : ref, pid);
}

export function readImageB64(name, pid = pidNow()) {
  if (!NAME_RE.test(name || '')) return null;
  return bridge ? bridge.readImage(pid, name) : localStorage.getItem(lsKey(pid, name));
}

export function readImageBytes(name, pid = pidNow()) {
  const b64 = readImageB64(name, pid);
  return b64 ? fromBase64(b64) : null;
}

export function hasImage(name, pid = pidNow()) {
  if (!name || !pid || !NAME_RE.test(name)) return false;
  return bridge ? bridge.hasImage(pid, name) : localStorage.getItem(lsKey(pid, name)) != null;
}

export function writeImageB64(name, b64, pid = pidNow()) {
  if (!NAME_RE.test(name) || !pid) return false;
  if (bridge) return bridge.writeImage(pid, name, b64);
  try {
    localStorage.setItem(lsKey(pid, name), b64);
    return true;
  } catch {
    return false;
  }
}

export function listImages(pid) {
  if (bridge) {
    try { return JSON.parse(bridge.listImages(pid)); } catch { return []; }
  }
  const prefix = `bookativeimg:${pid}/`;
  return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => ({ n: k.slice(prefix.length), m: 0 }));
}

export function deleteImage(name, pid) {
  if (bridge) return bridge.deleteImage(pid, name);
  localStorage.removeItem(lsKey(pid, name));
  return true;
}

export function deleteAllImages(pid) {
  if (bridge) return bridge.deleteImages(pid);
  for (const { n } of listImages(pid)) localStorage.removeItem(lsKey(pid, n));
  return true;
}

export function copyAllImages(from, to) {
  if (bridge) return bridge.copyImages(from, to);
  let n = 0;
  for (const { n: name } of listImages(from)) {
    const b64 = localStorage.getItem(lsKey(from, name));
    if (b64 != null && writeImageB64(name, b64, to)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- references & clean-up

// Pictures are referenced from rich text (data-img="…"), as character/location/object
// pictures ("img:…") and from comic panels ("img": "…", "drawing": "…").
const REF_RES = [
  /data-img=\\?"([A-Za-z0-9._-]+)\\?"/g,
  /"img:([A-Za-z0-9._-]+)"/g,
  /"(?:img|drawing)"\s*:\s*"([A-Za-z0-9._-]+)"/g,
];

/** Image names referenced anywhere in the given texts (project JSON, snapshots…). */
export function collectRefs(texts) {
  const refs = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const re of REF_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) refs.add(m[1]);
    }
  }
  return refs;
}

/**
 * Deletes pictures no longer used by the project or any of its snapshots.
 * Files younger than a day are kept, in case the edit that uses them was not saved yet.
 */
export function gcImages(pid, texts) {
  const refs = collectRefs(texts);
  // small previews (NAME.p.ext) live as long as their picture
  const bases = new Set([...refs].map((r) => r.replace(/\.\w+$/, '')));
  const now = Date.now();
  let removed = 0;
  for (const { n, m } of listImages(pid)) {
    if (refs.has(n)) continue;
    const pm = /^(.+)\.p\.\w+$/.exec(n);
    if (pm && bases.has(pm[1])) continue;
    if (m && now - m < 86400000) continue;
    if (deleteImage(n, pid)) removed++;
  }
  return removed;
}

// ---------------------------------------------------------------- formats

/** Reads type and pixel size from the file header: { type, w, h }. */
export function sniff(b) {
  const out = { type: null, w: 0, h: 0 };
  if (!b || b.length < 12) return out;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    out.type = 'png';
    out.w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
    out.h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  } else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    out.type = 'gif';
    out.w = b[6] | (b[7] << 8);
    out.h = b[8] | (b[9] << 8);
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    out.type = 'jpeg';
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        out.h = (b[i + 5] << 8) | b[i + 6];
        out.w = (b[i + 7] << 8) | b[i + 8];
        break;
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  } else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    out.type = 'webp';
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') {
      out.w = (b[26] | (b[27] << 8)) & 0x3fff;
      out.h = (b[28] | (b[29] << 8)) & 0x3fff;
    } else if (chunk === 'VP8L') {
      out.w = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      out.h = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    } else if (chunk === 'VP8X') {
      out.w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      out.h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    }
  }
  return out;
}

async function decode(blob) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch { /* fall through (e.g. SVG) */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), type, quality);
  });
}

/** Decodes, scales to `max` and re-encodes as JPEG (PNG when there is transparency). */
async function reencode(bytes, mime, max) {
  let src;
  try {
    src = await decode(new Blob([bytes], { type: mime || '' }));
  } catch {
    return null;
  }
  const w0 = src.naturalWidth || src.width;
  const h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) return null;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  let alpha = false;
  if (!/jpe?g/.test(mime || '')) {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) { alpha = true; break; }
    }
  }
  if (alpha) {
    const out = await canvasToBytes(canvas, 'image/png');
    return out && { bytes: out, ext: 'png', w, h };
  }
  if (!/jpe?g/.test(mime || '')) {
    // flatten onto white so anti-aliased edges look right
    const flat = document.createElement('canvas');
    flat.width = w;
    flat.height = h;
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#fff';
    fctx.fillRect(0, 0, w, h);
    fctx.drawImage(canvas, 0, 0);
    const out = await canvasToBytes(flat, 'image/jpeg', 0.86);
    return out && { bytes: out, ext: 'jpg', w, h };
  }
  const out = await canvasToBytes(canvas, 'image/jpeg', 0.86);
  return out && { bytes: out, ext: 'jpg', w, h };
}

function nativeConvert(bytes, max) {
  if (!bridge || !bridge.convertImage) return null;
  const r = bridge.convertImage(toBase64(bytes), max);
  if (!r) return null;
  const { mime, b64 } = JSON.parse(r);
  const out = fromBase64(b64);
  const info = sniff(out);
  return { bytes: out, ext: mime === 'image/png' ? 'png' : 'jpg', w: info.w, h: info.h };
}

export class ImageError extends Error {
  constructor(message, quiet = false) {
    super(message);
    this.quiet = quiet;
  }
}

/**
 * Stores an image in the project. Small PNGs and GIFs (animations) are kept
 * byte for byte; everything else is resized to MAX_DIM and re-encoded, which
 * also bakes in the camera's rotation. Returns { name, w, h }.
 */
export async function importBytes(bytes, mimeHint, { max = MAX_DIM, pid = pidNow() } = {}) {
  if (!bytes || !bytes.length) throw new ImageError('The image is empty');
  const info = sniff(bytes);
  let out = null;
  if (info.type === 'gif' && bytes.length <= 8e6 && info.w && Math.max(info.w, info.h) <= 3000) {
    out = { bytes, ext: 'gif', w: info.w, h: info.h };
  } else if (info.type === 'png' && info.w && Math.max(info.w, info.h) <= max && bytes.length <= 2e6) {
    out = { bytes, ext: 'png', w: info.w, h: info.h };
  } else {
    out = await reencode(bytes, info.type ? `image/${info.type}` : mimeHint, max);
    if (!out) out = nativeConvert(bytes, max);
  }
  if (!out) throw new ImageError('This image format can’t be read');
  if (out.w * out.h <= 4) throw new ImageError('Tracking pixel', true);
  const name = `${uid()}.${out.ext}`;
  if (!writeImageB64(name, toBase64(out.bytes), pid)) throw new ImageError('There is no room to store the image');
  return { name, w: out.w, h: out.h };
}

// ---------------------------------------------------------------- sources

function parseNative(json) {
  const { mime, b64 } = JSON.parse(json);
  return { bytes: fromBase64(b64), mime: mime || '' };
}

function ownImageFromUrl(url) {
  if (!bridge) return null;
  if (!base) base = bridge.imageBase();
  if (!url.startsWith(base)) return null;
  const [pid, name] = url.slice(base.length).split('/');
  return pid && name ? { pid, name: decodeURIComponent(name) } : null;
}

async function bytesFromUrl(url) {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/.exec(url);
    if (!m) throw new ImageError('Unreadable image data');
    const bytes = m[3] ? fromBase64(m[4].replace(/\s+/g, '')) : new TextEncoder().encode(decodeURIComponent(m[4]));
    return { bytes, mime: m[1] };
  }
  if (url.startsWith('blob:')) {
    const r = await fetch(url);
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') || '' };
  }
  const own = ownImageFromUrl(url);
  if (own) {
    const bytes = readImageBytes(own.name, own.pid);
    if (!bytes) throw new ImageError('The image is missing');
    return { bytes, mime: mimeOf(own.name) };
  }
  if (url.startsWith('content:') && bridge) {
    const r = bridge.readUri(url);
    if (!r) throw new ImageError('The image is not accessible');
    return parseNative(r);
  }
  if (/^https?:/i.test(url)) {
    if (bridge) {
      const r = await nativeAsync((id) => bridge.fetchUrl(url, id));
      if (!r.ok) throw new ImageError(r.message || 'Could not download the image');
      return parseNative(r.message);
    }
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new ImageError(`The server answered ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') || '' };
  }
  throw new ImageError('Unsupported image address');
}

/**
 * source: { file: Blob } | { url } | { clipboard: true } | { reuse: NAME }
 * Resolves to { name, w, h }.
 */
export async function resolveSource(src, opts) {
  if (src.reuse) return { name: src.reuse };
  let bytes;
  let mime = '';
  if (src.file) {
    bytes = new Uint8Array(await src.file.arrayBuffer());
    mime = src.file.type;
  } else if (src.clipboard) {
    const r = bridge && bridge.readClipboardImage();
    if (!r) throw new ImageError('There is no image on the clipboard');
    ({ bytes, mime } = parseNative(r));
  } else if (src.url) {
    ({ bytes, mime } = await bytesFromUrl(src.url));
  } else {
    throw new ImageError('Nothing to insert');
  }
  return importBytes(bytes, mime, opts);
}

export function clipboardHasImage() {
  try { return !!(bridge && bridge.hasClipboardImage && bridge.hasClipboardImage()); } catch { return false; }
}

/** Lets the writer choose a picture for a character, location or object; returns "img:NAME" or null. */
export async function pickPicture() {
  const [file] = await pickFiles('image/*', false);
  if (!file) return null;
  const r = await resolveSource({ file }, { max: 1200 });
  return `img:${r.name}`;
}

/** Image bytes and size for exporting a reference ("NAME", "img:NAME" or a data: URL). */
export function exportImage(ref, pid = pidNow()) {
  if (!ref) return null;
  let bytes;
  let name;
  if (ref.startsWith('data:')) {
    const m = /^data:([^;,]*);base64,(.*)$/.exec(ref);
    if (!m) return null;
    bytes = fromBase64(m[2]);
    name = null;
  } else {
    name = ref.startsWith('img:') ? ref.slice(4) : ref;
    bytes = readImageBytes(name, pid);
  }
  if (!bytes) return null;
  const info = sniff(bytes);
  if (!info.type) return null;
  const ext = info.type === 'jpeg' ? 'jpg' : info.type;
  return {
    bytes,
    ext,
    mime: info.type === 'jpeg' ? 'image/jpeg' : `image/${info.type}`,
    w: info.w || 800,
    h: info.h || 600,
    name: name || `${uid()}.${ext}`,
    url: ref.startsWith('data:') ? ref : imageUrl(name, pid),
  };
}
