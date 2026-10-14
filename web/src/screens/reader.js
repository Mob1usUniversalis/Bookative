// Reading view: the book as turning pages, or the comic page by page.
import { h, icon, fmtNum } from '../util.js';
import { getProject, getSettings, setSettings } from '../store.js';
import { isComic } from '../model.js';
import { buildDoc, readerHtml, DEFAULT_EXPORT } from '../export.js';
import { allPages } from '../comic/model.js';
import { buildPage, pageSvg, ensureFonts } from '../comic/render.js';
import { goBack } from '../router.js';
import { empty } from '../ui.js';

const GAP = 48;

export function readerScreen({ start }) {
  const p = getProject();
  const comic = isComic(p);
  const rtl = comic && p.comic && p.comic.rtl;
  const saved = (getSettings().readPos || {})[p.id] || 0;
  let index = start != null ? Math.max(0, parseInt(start, 10) || 0) : null;
  let count = 1;
  let chrome = true;

  const progress = h('span', { class: 'reader-progress' });
  const slider = h('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', class: 'reader-slider', 'aria-label': 'Page' });
  const top = h('header', { class: 'reader-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => goBack() }, icon('back')),
    h('div', { class: 'reader-title' }, p.title || 'Untitled'),
    progress);
  const bottom = h('footer', { class: 'reader-bottom' }, slider);
  const viewport = h('div', { class: 'reader-viewport' });
  const root = h('div', { class: `reader${comic ? ' reader-comic' : ' reader-book'}` }, viewport, top, bottom);

  const pages = comic ? allPages(p) : [];
  let flow = null;
  let pageW = 0;

  function showChrome(on) {
    chrome = on;
    root.classList.toggle('chrome-hidden', !chrome);
  }

  function update() {
    index = Math.max(0, Math.min(count - 1, index || 0));
    progress.textContent = `${fmtNum(index + 1)} / ${fmtNum(count)}`;
    slider.max = String(Math.max(0, count - 1));
    slider.value = String(rtl ? count - 1 - index : index);
    if (comic) {
      const entry = pages[index];
      viewport.innerHTML = entry ? pageSvg(buildPage(p, entry.page), { className: 'reader-page' }) : '';
      const svg = viewport.firstElementChild;
      if (svg) {
        const r = viewport.getBoundingClientRect();
        const ratio = svg.viewBox.baseVal.height / svg.viewBox.baseVal.width;
        const w = Math.min(r.width - 20, (r.height - 20) / ratio);
        svg.style.width = `${Math.floor(w)}px`;
        svg.style.height = `${Math.floor(w * ratio)}px`;
      }
    } else if (flow) {
      // Overflowing columns are scrolled into view (transforms on multi-column boxes are unreliable).
      const frame = flow.parentElement;
      const left = index * (pageW + GAP);
      if (Math.abs(frame.scrollLeft - left) > pageW * 1.5) frame.scrollLeft = left;
      else frame.scrollTo({ left, behavior: 'smooth' });
    }
    const pos = { ...(getSettings().readPos || {}) };
    pos[p.id] = count > 1 ? index / (count - 1) : 0;
    setSettings({ readPos: pos });
  }

  function turn(dir) {
    const next = index + (rtl ? -dir : dir);
    if (next < 0 || next >= count) return;
    index = next;
    update();
  }

  function layoutBook() {
    const r = viewport.getBoundingClientRect();
    pageW = Math.floor(r.width - 40);
    const pageH = Math.floor(r.height - 72);
    flow.style.width = `${pageW}px`;
    flow.style.height = `${pageH}px`;
    flow.style.columnWidth = `${pageW}px`;
    flow.style.columnGap = `${GAP}px`;
    flow.style.setProperty('--page-h', `${pageH}px`);
    const frac = index == null ? saved : null;
    count = Math.max(1, Math.round((flow.scrollWidth + GAP) / (pageW + GAP)));
    if (frac != null) index = Math.round(frac * (count - 1));
    update();
  }

  if (comic) {
    count = Math.max(1, pages.length);
    if (index == null) index = Math.round(saved * (count - 1));
    if (!pages.length) {
      viewport.replaceChildren(empty({ icon: 'comic', title: 'No pages yet', text: 'Add pages to a chapter to read the comic here.' }));
    } else {
      ensureFonts().then(update);
    }
  } else {
    const o = { ...DEFAULT_EXPORT, ...(getSettings().exportOpts || {}), content: 'novel', titlePage: true, images: true, indent: getSettings().para !== 'spaced' };
    flow = h('div', { class: 'reader-flow', html: readerHtml(buildDoc(p, o)) });
    viewport.replaceChildren(h('div', { class: 'reader-frame' }, flow));
    const ready = () => requestAnimationFrame(() => requestAnimationFrame(layoutBook));
    const imgs = flow.querySelectorAll('img');
    let pending = imgs.length;
    if (!pending) ready();
    for (const img of imgs) {
      const done = () => { if (--pending === 0) layoutBook(); };
      if (img.complete) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    }
    if (pending) ready();
  }

  // ---------------------------------------------------------------- input
  let down = null;
  viewport.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  viewport.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      turn(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const w = viewport.clientWidth;
      if (e.clientX < w * 0.3) turn(-1);
      else if (e.clientX > w * 0.7) turn(1);
      else showChrome(!chrome);
    }
  });
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    index = rtl ? count - 1 - v : v;
    update();
  });
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') turn(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1);
  };
  const onResize = () => {
    if (!comic && flow) layoutBook();
    else if (comic) update();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  showChrome(true);
  setTimeout(() => showChrome(false), 2500);

  return {
    el: root,
    cleanup: () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}
