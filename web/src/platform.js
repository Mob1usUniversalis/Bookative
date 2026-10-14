// Native services with browser fallbacks (for development in a desktop browser).
import { uid } from './util.js';

const bridge = window.AndroidBridge;
const pending = new Map();

window.__nativeDone = (id, ok, message) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p({ ok, message });
};

/** Calls an asynchronous bridge method; it reports back through window.__nativeDone. */
export function nativeAsync(invoke) {
  return new Promise((resolve) => {
    const id = uid();
    pending.set(id, resolve);
    invoke(id);
  });
}

export function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Saves bytes or text through the system "save as" picker. Resolves {ok, message}. */
export function saveFile(name, mime, data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (bridge) {
    return new Promise((resolve) => {
      const id = uid();
      pending.set(id, resolve);
      bridge.saveDocument(name, mime, toBase64(bytes), id);
    });
  }
  const blob = new Blob([bytes], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  return Promise.resolve({ ok: true, message: 'downloaded' });
}

/**
 * Opens the print dialog for a full HTML document (Android offers "Save as PDF").
 * size: { w, h } in inches for a custom paper size (comic pages); A4 otherwise.
 */
export function printHtml(title, html, size = null) {
  if (bridge) {
    bridge.printHtml(title, html, size ? Math.round(size.w * 1000) : 0, size ? Math.round(size.h * 1000) : 0);
    return;
  }
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

export function shareText(subject, text) {
  if (bridge) return bridge.shareText(subject, text);
  if (navigator.share) return navigator.share({ title: subject, text }).catch(() => {});
  navigator.clipboard?.writeText(text);
}

export function setChrome(color, lightBars) {
  if (bridge) bridge.setChrome(color, lightBars);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function keepScreenOn(on) {
  if (bridge) bridge.keepScreenOn(!!on);
}

export function appVersion() {
  return bridge ? bridge.appVersion() : 'web';
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Opens the system file picker and resolves with the chosen Files (empty if cancelled). */
export function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = !!multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Opens the system file picker and resolves with a File (or null if cancelled). */
export function pickFile(accept) {
  return pickFiles(accept, false).then((f) => f[0] || null);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Sends a file through the share sheet (Quick Share, Bluetooth, messengers…). */
export async function shareFile(name, mime, data, subject = '') {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (bridge && bridge.shareFile) return bridge.shareFile(name, mime, toBase64(bytes), subject);
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: subject });
      return true;
    } catch {
      return false;
    }
  }
  return (await saveFile(name, mime, bytes)).ok;
}

/** Text of a backup that was opened with, or shared to, the app (Android only). */
export function takeIncoming() {
  try { return bridge && bridge.takeIncoming ? bridge.takeIncoming() : null; } catch { return null; }
}

// ---------------------------------------------------------------- storage location

export function storageInfo() {
  if (bridge && bridge.storageInfo) {
    try { return JSON.parse(bridge.storageInfo()); } catch { /* fall through */ }
  }
  return { kind: 'browser', label: 'This browser’s storage', ok: true };
}

export const canChooseFolder = () => !!(bridge && bridge.chooseFolder);

/** Opens the system folder picker; resolves { uri, label, projects } or null. */
export async function chooseFolder() {
  const r = await nativeAsync((id) => bridge.chooseFolder(id));
  if (!r.ok) {
    if (r.message !== 'cancelled') throw new Error(r.message);
    return null;
  }
  return JSON.parse(r.message);
}

/** Moves the library to a folder (uri) or back to app storage (''). */
export async function switchStorage(uri, copy, onProgress) {
  window.__storageProgress = (done, total) => onProgress && onProgress(done, total);
  const r = await nativeAsync((id) => bridge.switchStorage(uri || '', !!copy, id));
  window.__storageProgress = null;
  if (!r.ok) throw new Error(r.message);
  return JSON.parse(r.message);
}
