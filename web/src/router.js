// Hash router with hierarchical "up" navigation (Android back goes to the parent screen).
import { openProject, closeProject, getProject, setSettings, flush } from './store.js';
import { releaseFields, flushAllFields } from './editor.js';
import { findScene } from './model.js';
import { findPage } from './comic/model.js';
import { closeTopOverlay } from './ui.js';

const routes = [];
let current = { path: null, cleanup: null };
const scrollMem = new Map();
let restoreNext = false;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler });
}

export function currentPath() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  return h || '/';
}

export function navigate(path, { replace = false, back = false } = {}) {
  if (back) restoreNext = true;
  const target = '#' + path;
  if (location.hash === target || (path === '/' && !location.hash)) {
    render();
    return;
  }
  if (replace) location.replace(target);
  else location.hash = path;
}

export const go = (path) => navigate(path);

export function parentOf(path) {
  const seg = path.split('/').filter(Boolean);
  if (!seg.length) return null;
  if (seg[0] !== 'p') return '/';
  const base = `/p/${seg[1]}`;
  if (seg.length === 2) return '/';
  const kind = seg[2];
  if (kind === 'sc') {
    if (seg.length > 4) return `${base}/sc/${seg[3]}`;
    const f = getProject() && findScene(seg[3]);
    return f ? `${base}/ch/${f.chapter.id}` : `${base}/chapters`;
  }
  if (kind === 'ch') return seg.length > 4 ? `${base}/ch/${seg[3]}` : `${base}/chapters`;
  if (kind === 'pg') {
    if (seg.length > 4) return `${base}/pg/${seg[3]}`;
    const f = getProject() && findPage(seg[3]);
    return f ? `${base}/ch/${f.chapter.id}` : `${base}/chapters`;
  }
  if (kind === 'read') return base;
  if (kind === 'strands') return `${base}/arch`;
  if (seg.length > 3) return '/' + seg.slice(0, -1).join('/');
  return base;
}

export function goBack() {
  if (closeTopOverlay()) return true;
  if (current.onBack && current.onBack()) return true;
  const parent = parentOf(currentPath());
  if (parent == null) return false;
  navigate(parent, { replace: true, back: true });
  return true;
}

/** Re-renders the current screen, keeping its scroll position. */
export function rerender() {
  restoreNext = true;
  render();
}

function saveScroll() {
  const c = document.querySelector('#app .content');
  if (c && current.path) scrollMem.set(current.path, c.scrollTop);
}

export function render() {
  const path = currentPath();
  const restore = restoreNext || path === current.path;
  restoreNext = false;
  saveScroll();
  releaseFields();
  if (current.cleanup) {
    // `true` when the same screen is being redrawn rather than left.
    try { current.cleanup(path === current.path); } catch (e) { console.error(e); }
  }
  current = { path, cleanup: null, onBack: null };
  document.body.classList.remove('focus-mode');

  let match = null;
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      match = { r, params };
      break;
    }
  }
  if (!match) {
    navigate('/', { replace: true });
    return;
  }
  const { params } = match;
  if (params.pid) {
    if (!openProject(params.pid)) {
      navigate('/', { replace: true });
      return;
    }
  } else {
    closeProject();
  }

  let result;
  try {
    result = match.r.handler(params);
  } catch (e) {
    console.error(e);
    result = null;
  }
  if (!result) {
    // The item no longer exists (deleted, or a stale link): go up a level.
    const parent = parentOf(path);
    navigate(parent || '/', { replace: true, back: true });
    return;
  }
  const el = result instanceof Node ? result : result.el;
  if (!(result instanceof Node)) {
    current.cleanup = result.cleanup || null;
    current.onBack = result.onBack || null;
  }
  const app = document.getElementById('app');
  app.replaceChildren(el);
  const content = el.querySelector('.content');
  if (content) content.scrollTop = restore ? scrollMem.get(path) || 0 : 0;
  if (!restore) scrollMem.delete(path);
  setSettings({ lastRoute: path });
}

export function start() {
  window.addEventListener('hashchange', render);
  window.appBack = goBack;
  window.appFlush = () => {
    flushAllFields();
    flush();
    return true;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window.appFlush();
  });
  window.addEventListener('pagehide', () => window.appFlush());
  render();
}
