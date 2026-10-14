// Persistence: one JSON file per project, an index file, settings and
// daily snapshots. On Android the files live in the app's private storage
// (through window.AndroidBridge); in a desktop browser localStorage is used.
import { debounce, now, todayKey, uid } from './util.js';
import { gcImages, deleteAllImages } from './images.js';

const bridge = typeof window !== 'undefined' ? window.AndroidBridge : null;
export const isAndroid = !!bridge;

const backend = bridge
  ? {
      list: () => {
        try { return JSON.parse(bridge.listFiles()); } catch { return []; }
      },
      read: (n) => bridge.readFile(n),
      write: (n, s) => bridge.writeFile(n, s),
      remove: (n) => bridge.deleteFile(n),
    }
  : {
      list: () => Object.keys(localStorage).filter((k) => k.startsWith('bookative:')).map((k) => k.slice(10)),
      read: (n) => localStorage.getItem('bookative:' + n),
      write: (n, s) => {
        try { localStorage.setItem('bookative:' + n, s); return true; } catch { return false; }
      },
      remove: (n) => { localStorage.removeItem('bookative:' + n); return true; },
    };

const projFile = (id) => `p-${id}.json`;
const MAX_SNAPSHOTS = 5;

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS = {
  theme: 'system',
  font: 'serif',
  size: 18,
  lineHeight: 1.7,
  para: 'indent',
  spell: true,
  keepAwake: true,
  lastRoute: '',
};

let settings = null;

export function getSettings() {
  if (!settings) {
    let s = {};
    try { s = JSON.parse(backend.read('settings.json') || '{}') || {}; } catch { s = {}; }
    settings = { ...DEFAULT_SETTINGS, ...s };
  }
  return settings;
}

const saveSettingsSoon = debounce(() => backend.write('settings.json', JSON.stringify(settings)), 300);

export function setSettings(patch) {
  Object.assign(getSettings(), patch);
  saveSettingsSoon();
}

export function flushSettings() {
  saveSettingsSoon.flush();
}

// ---------------------------------------------------------------- index

let index = null;

function readIndex() {
  let idx = null;
  try { idx = JSON.parse(backend.read('index.json') || 'null'); } catch { idx = null; }
  const files = backend.list().filter((n) => /^p-.+\.json$/.test(n));
  if (!Array.isArray(idx)) idx = [];
  // Recover entries for project files the index doesn't know about.
  const known = new Set(idx.map((e) => projFile(e.id)));
  for (const f of files) {
    if (known.has(f)) continue;
    try {
      const p = JSON.parse(backend.read(f));
      if (p && p.id) idx.push(metaOf(p));
    } catch { /* unreadable file: skip */ }
  }
  const present = new Set(files);
  return idx.filter((e) => present.has(projFile(e.id)));
}

function writeIndex() {
  backend.write('index.json', JSON.stringify(index));
}

export function listProjects() {
  if (!index) index = readIndex();
  return [...index].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function metaOf(p) {
  let words = 0;
  let pages = 0;
  for (const ch of p.chapters || []) {
    for (const s of ch.scenes || []) words += s.words || 0;
    pages += (ch.pages || []).length;
  }
  return {
    id: p.id,
    title: p.title,
    author: p.author,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    words,
    pages,
    mode: p.mode || 'book',
    chapters: (p.chapters || []).length,
  };
}

/** Rebuilds the project list from the files themselves (after moving or syncing the library). */
export function rebuildIndex() {
  index = [];
  for (const f of backend.list()) {
    if (!/^p-.+\.json$/.test(f)) continue;
    try {
      const p = JSON.parse(backend.read(f));
      if (p && p.id) index.push(metaOf(p));
    } catch { /* unreadable file: skip */ }
  }
  writeIndex();
}

/** Forgets cached state, e.g. when another device may have changed the library. */
export function refreshIndex() {
  if (current) flush();
  index = readIndex();
}

// ---------------------------------------------------------------- projects

let current = null;
let lastSavedJson = '';
const listeners = new Set();

export function onSaveState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(state) {
  for (const fn of listeners) fn(state);
}

export function getProject() {
  return current;
}

export function openProject(id) {
  if (current && current.id === id) return current;
  flush();
  const raw = backend.read(projFile(id));
  if (!raw) return null;
  try {
    current = migrate(JSON.parse(raw));
  } catch {
    return null;
  }
  lastSavedJson = raw;
  scheduleImageCleanup(id);
  return current;
}

// Unused pictures are removed once per session, the first time a project is opened.
const cleaned = new Set();
function scheduleImageCleanup(id) {
  if (cleaned.has(id)) return;
  cleaned.add(id);
  setTimeout(() => {
    try {
      gcImages(id, projectTexts(id));
    } catch (e) {
      console.error(e);
    }
  }, 1500);
}

/** The saved project file and all its snapshots, as raw JSON strings. */
export function projectTexts(id) {
  const texts = [backend.read(projFile(id))];
  for (const s of listSnapshots(id)) texts.push(backend.read(s.file));
  if (current && current.id === id) texts.push(JSON.stringify(current));
  return texts.filter(Boolean);
}

export function closeProject() {
  flush();
  current = null;
}

function writeProject(p) {
  const json = JSON.stringify(p);
  if (json === lastSavedJson && p === current) return true;
  snapshotIfNeeded(p.id);
  const ok = backend.write(projFile(p.id), json);
  if (ok && p === current) lastSavedJson = json;
  if (!index) index = readIndex();
  const i = index.findIndex((e) => e.id === p.id);
  const m = metaOf(p);
  if (i >= 0) index[i] = m;
  else index.push(m);
  writeIndex();
  return ok;
}

const saveSoon = debounce(() => {
  if (!current) return;
  const ok = writeProject(current);
  emit(ok ? 'saved' : 'error');
}, 700);

/** Marks the open project as changed; it is written to disk shortly after. */
export function touch() {
  if (!current) return;
  current.updatedAt = now();
  emit('pending');
  saveSoon();
}

export function flush() {
  if (saveSoon.pending()) saveSoon.flush();
  flushSettings();
}

export function createProject(p) {
  writeProject(p);
  return p;
}

export function deleteProject(id) {
  if (current && current.id === id) {
    saveSoon.cancel();
    current = null;
  }
  backend.remove(projFile(id));
  for (const s of listSnapshots(id)) backend.remove(s.file);
  deleteAllImages(id);
  if (!index) index = readIndex();
  index = index.filter((e) => e.id !== id);
  writeIndex();
}

export function readProjectRaw(id) {
  if (current && current.id === id) {
    flush();
  }
  const raw = backend.read(projFile(id));
  return raw ? migrate(JSON.parse(raw)) : null;
}

// ---------------------------------------------------------------- snapshots
// Before the first save of each day the previous version is copied aside,
// keeping the last few days so a bad edit or deletion can be undone.

const snapName = (id, day) => `s-${id}-${day.replace(/-/g, '')}.json`;
const snapshotDone = new Set();

function snapshotIfNeeded(id) {
  const day = todayKey();
  const key = id + day;
  if (snapshotDone.has(key)) return;
  snapshotDone.add(key);
  const name = snapName(id, day);
  if (backend.read(name)) return;
  const prev = backend.read(projFile(id));
  if (!prev) return;
  backend.write(name, prev);
  const snaps = listSnapshots(id).filter((s) => !s.beforeRestore);
  for (const s of snaps.slice(MAX_SNAPSHOTS)) backend.remove(s.file);
}

export function listSnapshots(id) {
  const re = new RegExp(`^s-${id.replace(/[^A-Za-z0-9]/g, '')}-(\\d{8})(r?)\\.json$`);
  return backend
    .list()
    .map((f) => {
      const m = f.match(re);
      if (!m) return null;
      const d = m[1];
      return { file: f, day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, beforeRestore: !!m[2] };
    })
    .filter(Boolean)
    .sort((a, b) => (b.day + (b.beforeRestore ? 1 : 0)).localeCompare(a.day + (a.beforeRestore ? 1 : 0)));
}

export function readSnapshot(file) {
  try { return migrate(JSON.parse(backend.read(file))); } catch { return null; }
}

/** Replaces the open project with a snapshot (the current state is snapshotted first). */
export function restoreSnapshot(file) {
  const snap = readSnapshot(file);
  if (!snap || !current || snap.id !== current.id) return false;
  flush();
  backend.write(`s-${current.id}-${todayKey().replace(/-/g, '')}r.json`, JSON.stringify(current));
  snap.updatedAt = now();
  current = snap;
  lastSavedJson = '';
  writeProject(current);
  return true;
}

// ---------------------------------------------------------------- schema

export const STATUSES = ['todo', 'tocomplete', 'completed'];

export function migrate(p) {
  p.schema = p.schema || 1;
  p.architecture = p.architecture || {};
  for (const k of ['premise', 'fabula', 'setting']) {
    p.architecture[k] = p.architecture[k] || { text: '', status: 'todo' };
  }
  for (const k of ['strands', 'characters', 'locations', 'objects', 'chapters', 'notes', 'events']) {
    if (!Array.isArray(p[k])) p[k] = [];
  }
  p.goal = p.goal || { words: 0, deadline: '', daily: 0 };
  p.stats = p.stats || { days: {} };
  p.stats.days = p.stats.days || {};
  p.mode = p.mode === 'comic' ? 'comic' : 'book';
  p.comic = { format: 'comic', rtl: false, caps: true, ...(p.comic || {}) };
  for (const ch of p.chapters) {
    ch.scenes = ch.scenes || [];
    ch.pages = ch.pages || [];
    for (const pg of ch.pages) {
      pg.panels = pg.panels || [];
      pg.chars = pg.chars || [];
      pg.status = pg.status || 'todo';
      for (const pn of pg.panels) {
        pn.items = pn.items || [];
        pn.fit = pn.fit || { z: 1, ox: 0, oy: 0 };
      }
    }
    ch.reason = ch.reason || { text: '', status: 'todo' };
    ch.notes = ch.notes || '';
    for (const s of ch.scenes) {
      s.revisions = s.revisions && s.revisions.length ? s.revisions : [{ id: uid(), text: '', created: now() }];
      if (s.rev == null || s.rev >= s.revisions.length) s.rev = s.revisions.length - 1;
      for (const k of ['chars', 'locs', 'objs', 'strands']) if (!Array.isArray(s[k])) s[k] = [];
      s.status = s.status || 'todo';
    }
  }
  return p;
}
