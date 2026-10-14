import {
  createElement as lucideCreate,
  ArrowLeftRight, BookOpenText, Brush, CaseUpper, ChevronLeft, Cloud, Columns2, Ellipsis, Eraser, Frame, Hand, LayoutGrid, LayoutPanelLeft, Megaphone, MessageCircle, MessageSquareDashed, Palette, RectangleHorizontal, Rows2, Text, Zap, ZoomIn,
  ClipboardPaste, ImagePlus, AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowLeft, ArrowUpDown, Bold, BookOpen, Box, CalendarClock, ChartColumn, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Compass, Copy, Download, EllipsisVertical, Eye, Feather, FileText, FolderInput, History, Image, Info, Italic, Landmark, Layers, Library, Lightbulb, List, ListOrdered, MapPin, Maximize2, Minimize2, Moon, MoveRight, NotebookPen, PenLine, Pencil, Plus, Quote, Redo2, RotateCcw, ScrollText, Search, Settings, Shapes, Share2, StickyNote, Strikethrough, Sun, SunMoon, Tags, Target, Trash2, Type, Underline, Undo2, Upload, User, Users, Waypoints, X,
} from 'lucide';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const now = () => new Date().toISOString();

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  d.flush = (...args) => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...args);
    }
  };
  d.cancel = () => {
    clearTimeout(t);
    t = null;
  };
  d.pending = () => t !== null;
  return d;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tiny DOM builder: h('div', {class: 'x', onclick}, child, [children]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'ref') v(el);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

const ICONS = {
  back: ArrowLeft, plus: Plus, more: EllipsisVertical, check: Check, close: X,
  edit: Pencil, trash: Trash2, up: ChevronUp, down: ChevronDown, chevron: ChevronRight,
  search: Search, settings: Settings, book: BookOpen, user: User, users: Users,
  place: MapPin, object: Box, strands: Waypoints, timeline: CalendarClock,
  chart: ChartColumn, download: Download, upload: Upload, note: StickyNote,
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough,
  ul: List, ol: ListOrdered, quote: Quote, alignLeft: AlignLeft,
  alignCenter: AlignCenter, alignRight: AlignRight, alignJustify: AlignJustify,
  undo: Undo2, redo: Redo2, focus: Maximize2, unfocus: Minimize2, tags: Tags,
  history: History, image: Image, share: Share2, copy: Copy, reorder: ArrowUpDown,
  file: FileText, layers: Layers, feather: Feather, target: Target, info: Info,
  arch: Landmark, library: Library, pen: PenLine, clock: Clock, eye: Eye,
  shapes: Shapes, import: FolderInput, restore: RotateCcw, move: MoveRight,
  type: Type, sun: Sun, moon: Moon, system: SunMoon, compass: Compass,
  notebook: NotebookPen, idea: Lightbulb, scroll: ScrollText, imageAdd: ImagePlus, clipboard: ClipboardPaste,
  eraser: Eraser, panels: LayoutGrid, speech: MessageCircle, thought: Cloud, whisper: MessageSquareDashed, shout: Megaphone, caption: RectangleHorizontal, sfx: Zap, splitH: Rows2, splitV: Columns2, brush: Brush, palette: Palette, read: BookOpenText, comic: LayoutPanelLeft, zoom: ZoomIn, frame: Frame, hand: Hand, dots: Ellipsis, left: ChevronLeft, swap: ArrowLeftRight, caps: CaseUpper, text: Text,
};

export function icon(name, size = 22) {
  const node = ICONS[name];
  if (!node) return h('span');
  const el = lucideCreate(node);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('stroke-width', '1.75');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

export const fmtNum = (n) => (n || 0).toLocaleString('en-US');

export function plural(n, one, many) {
  return `${fmtNum(n)} ${n === 1 ? one : many || one + 's'}`;
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('en-GB', opts);
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400 && new Date().getDate() === d.getDate()) {
    return 'today ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 86400 * 2) return 'yesterday';
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return fmtDate(iso);
}

/** Formats a story-time value from <input type="datetime-local"> or "YYYY-MM-DD". */
export function fmtStoryTime(v) {
  if (!v) return '';
  const [date, time] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  if (!y) return v;
  const dt = new Date(Date.UTC(2000, (m || 1) - 1, d || 1));
  const month = dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  let s = `${d || ''} ${month} ${y}`.trim();
  if (time) s += `, ${time.slice(0, 5)}`;
  return s;
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function initials(name) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

export function slug(s) {
  return (s || 'untitled')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

export function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length) return false;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return true;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const ROMAN = (n) => {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};
