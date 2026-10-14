// Comic projects: page formats, panel layouts, and the page / panel / lettering
// data. Positions are fractions of the page (0–1 on both axes), so a page keeps
// its composition when the format changes.
import { uid, now } from '../util.js';
import { getProject, touch } from '../store.js';
import { countWords } from '../text.js';
import { todayKey } from '../util.js';

export const PAGE_FORMATS = {
  comic: { label: 'Comic book (6.6 × 10.2 in)', w: 6.625, h: 10.25 },
  manga: { label: 'Manga (B6, 5 × 7.2 in)', w: 5.04, h: 7.17 },
  a4: { label: 'A4 album (8.3 × 11.7 in)', w: 8.27, h: 11.69 },
  square: { label: 'Square (8 × 8 in)', w: 8, h: 8 },
  strip: { label: 'Strip (10 × 3.3 in)', w: 10, h: 3.3 },
};

export const LETTERING = {
  speech: 'Speech',
  thought: 'Thought',
  whisper: 'Whisper',
  shout: 'Shout',
  caption: 'Caption',
  sfx: 'Sound effect',
};

export const W = 1000; // page width in drawing units; height = W * ratio

export function formatOf(p = getProject()) {
  return PAGE_FORMATS[p?.comic?.format] || PAGE_FORMATS.comic;
}

export const ratioOf = (p = getProject()) => {
  const f = formatOf(p);
  return f.h / f.w;
};

// Rows of panels; each row has a relative height and relative column widths.
export const LAYOUTS = [
  { id: 'splash', label: 'Splash page', rows: [[1, [1]]] },
  { id: 'two', label: 'Two tiers', rows: [[1, [1]], [1, [1]]] },
  { id: 'three', label: 'Three tiers', rows: [[1, [1]], [1, [1]], [1, [1]]] },
  { id: 'cinema', label: 'Four wide panels', rows: [[1, [1]], [1, [1]], [1, [1]], [1, [1]]] },
  { id: 'grid4', label: 'Four-panel grid', rows: [[1, [1, 1]], [1, [1, 1]]] },
  { id: 'grid6', label: 'Six-panel grid', rows: [[1, [1, 1]], [1, [1, 1]], [1, [1, 1]]] },
  { id: 'grid9', label: 'Nine-panel grid', rows: [[1, [1, 1, 1]], [1, [1, 1, 1]], [1, [1, 1, 1]]] },
  { id: 'wide-top', label: 'Wide panel, then two', rows: [[1.3, [1]], [1, [1, 1]]] },
  { id: 'wide-bottom', label: 'Two, then a wide panel', rows: [[1, [1, 1]], [1.3, [1]]] },
  { id: 'feature', label: 'Big panel over three', rows: [[2, [1]], [1, [1, 1, 1]]] },
  { id: 'stagger', label: 'Staggered', rows: [[1, [2, 1]], [1, [1]], [1, [1, 2]]] },
  { id: 'five', label: 'Five panels', rows: [[1, [1, 1]], [1.2, [1]], [1, [1, 1]]] },
  { id: 'columns', label: 'Two columns', rows: [[1, [1, 1]]] },
  { id: 'strip3', label: 'Three in a row', rows: [[1, [1, 1, 1]]] },
  { id: 'strip4', label: 'Four in a row', rows: [[1, [1, 1, 1, 1]]] },
];

const MARGIN = 40;
const GUTTER = 18;

/** Panel rectangles (fractions of the page) for a layout. */
export function layoutRects(id, ratio) {
  const t = LAYOUTS.find((l) => l.id === id) || LAYOUTS[0];
  const H = W * ratio;
  const rows = t.rows;
  const innerH = H - 2 * MARGIN - GUTTER * (rows.length - 1);
  const sumH = rows.reduce((n, r) => n + r[0], 0);
  const rects = [];
  let y = MARGIN;
  for (const [rh, cols] of rows) {
    const hgt = (innerH * rh) / sumH;
    const innerW = W - 2 * MARGIN - GUTTER * (cols.length - 1);
    const sumW = cols.reduce((n, c) => n + c, 0);
    let x = MARGIN;
    for (const cw of cols) {
      const wid = (innerW * cw) / sumW;
      rects.push({ x: x / W, y: y / H, w: wid / W, h: hgt / H });
      x += wid + GUTTER;
    }
    y += hgt + GUTTER;
  }
  return rects;
}

export function newPanel(r) {
  return { id: uid(), x: r.x, y: r.y, w: r.w, h: r.h, bg: '#ffffff', img: '', iw: 0, ih: 0, fit: { z: 1, ox: 0, oy: 0 }, drawing: '', desc: '', items: [] };
}

export function newPage(layout = 'grid6', p = getProject()) {
  return {
    id: uid(),
    status: 'todo',
    layout,
    panels: layoutRects(layout, ratioOf(p)).map(newPanel),
    notes: '',
    chars: [],
    updated: now(),
  };
}

export function newLettering(type, panel, p = getProject()) {
  const ratio = ratioOf(p);
  const count = panel.items.length;
  const sfx = type === 'sfx';
  const caption = type === 'caption';
  // Place new lettering near the top-left of the panel, stacking downwards.
  const x = panel.x + panel.w * (caption ? 0.32 : 0.38);
  const y = panel.y + Math.min(panel.h * 0.85, panel.h * (caption ? 0.12 : 0.22) + count * (90 / (W * ratio)));
  return {
    id: uid(),
    type,
    text: '',
    speaker: '',
    x: sfx ? panel.x + panel.w * 0.5 : x,
    y: sfx ? panel.y + panel.h * 0.5 : y,
    w: Math.min(0.42, Math.max(0.16, panel.w * 0.62)),
    tx: caption || sfx ? null : panel.x + panel.w * 0.62,
    ty: caption || sfx ? null : Math.min(panel.y + panel.h * 0.92, y + (110 / (W * ratio))),
    size: 1,
    rot: sfx ? -8 : 0,
    color: sfx ? '#ffd23f' : '',
  };
}

/** Moves lettering with its panel when the panel's rectangle changes. */
export function moveLettering(item, from, to) {
  const rel = (v, a, s) => (s ? (v - a) / s : 0.5);
  const map = (v, a, s, b, t) => b + rel(v, a, s) * t;
  item.x = map(item.x, from.x, from.w, to.x, to.w);
  item.y = map(item.y, from.y, from.h, to.y, to.h);
  if (item.tx != null) {
    item.tx = map(item.tx, from.x, from.w, to.x, to.w);
    item.ty = map(item.ty, from.y, from.h, to.y, to.h);
  }
  item.w = Math.max(0.1, Math.min(0.9, item.w * (to.w / (from.w || 1)) ** 0.5));
}

/** Applies a new layout, keeping pictures, drawings and lettering in panel order. */
export function applyLayout(page, layoutId, p = getProject()) {
  const rects = layoutRects(layoutId, ratioOf(p));
  const old = page.panels;
  const panels = rects.map((r, i) => {
    const prev = old[i];
    if (!prev) return newPanel(r);
    const from = { x: prev.x, y: prev.y, w: prev.w, h: prev.h };
    for (const it of prev.items) moveLettering(it, from, r);
    return { ...prev, ...r };
  });
  page.panels = panels;
  page.layout = layoutId;
  return Math.max(0, old.length - rects.length);
}

export function splitPanel(page, panel, direction, p = getProject()) {
  const ratio = ratioOf(p);
  const i = page.panels.indexOf(panel);
  const a = { ...panel };
  const b = newPanel(panel);
  if (direction === 'h') {
    const g = GUTTER / (W * ratio);
    const h2 = (panel.h - g) / 2;
    a.h = h2;
    b.y = panel.y + h2 + g;
    b.h = h2;
  } else {
    const g = GUTTER / W;
    const w2 = (panel.w - g) / 2;
    a.w = w2;
    b.x = panel.x + w2 + g;
    b.w = w2;
  }
  // lettering stays where it is visually, but belongs to the half it sits in
  const keep = [];
  for (const it of panel.items) {
    const inB = direction === 'h' ? it.y > b.y : it.x > b.x;
    (inB ? b.items : keep).push(it);
  }
  a.items = keep;
  page.panels.splice(i, 1, a, b);
  page.layout = 'custom';
  return [a, b];
}

// ---------------------------------------------------------------- lookups

export function allPages(p = getProject()) {
  const out = [];
  let n = 0;
  p.chapters.forEach((ch, ci) => (ch.pages || []).forEach((page, pi) => out.push({ page, chapter: ch, ci, pi, number: ++n })));
  return out;
}

export function findPage(id, p = getProject()) {
  return allPages(p).find((x) => x.page.id === id) || null;
}

export function pageNumber(page, p = getProject()) {
  const f = findPage(page.id, p);
  return f ? f.number : 0;
}

export function letteringOf(page) {
  const out = [];
  page.panels.forEach((panel, pi) => panel.items.forEach((item) => out.push({ item, panel, pi })));
  return out;
}

export function pageWords(page) {
  let n = 0;
  for (const { item } of letteringOf(page)) n += countWords(item.text || '', true);
  return n;
}

export function comicStats(p = getProject()) {
  const pages = allPages(p);
  let panels = 0;
  let items = 0;
  let words = 0;
  for (const { page } of pages) {
    panels += page.panels.length;
    for (const { item } of letteringOf(page)) {
      items++;
      words += countWords(item.text || '', true);
    }
  }
  return { pages: pages.length, panels, items, words };
}

/** Characters on a page: speakers of its lettering plus characters tagged by hand. */
export function pageCharacters(page) {
  const set = new Set(page.chars || []);
  for (const { item } of letteringOf(page)) if (item.speaker) set.add(item.speaker);
  return [...set];
}

/** Call after changing a page; counts new lettering words towards today's total. */
export function pageChanged(page, wordsBefore, p = getProject()) {
  page.updated = now();
  p.lastPage = page.id;
  if (wordsBefore != null) {
    const delta = pageWords(page) - wordsBefore;
    if (delta > 0) {
      const k = todayKey();
      p.stats.days[k] = (p.stats.days[k] || 0) + delta;
    }
  }
  if (page.status === 'todo' && page.panels.some((x) => x.img || x.drawing || x.items.length)) page.status = 'tocomplete';
  touch();
}

export function lettered(text, p = getProject()) {
  if (!text) return '';
  return p?.comic?.caps ? text.toLocaleUpperCase(p.language || undefined) : text;
}
