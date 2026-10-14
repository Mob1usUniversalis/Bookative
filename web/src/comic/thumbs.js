// Small pictures of layouts and pages for lists and pickers.
import { W, layoutRects } from './model.js';
import { buildPage, pageSvg, ensureFonts } from './render.js';

const r2 = (n) => Math.round(n * 10) / 10;

export function layoutThumb(id, ratio) {
  const H = W * ratio;
  const rects = layoutRects(id, ratio)
    .map((r) => `<rect x="${r2(r.x * W)}" y="${r2(r.y * H)}" width="${r2(r.w * W)}" height="${r2(r.h * H)}" rx="6"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${r2(H)}"><rect width="${W}" height="${r2(H)}" class="lt-page"/><g class="lt-panels">${rects}</g></svg>`;
}

/** Fills `el` with a picture of the page once it scrolls into view (and empties it when far away). */
const observer = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (!el.isConnected) {
        observer.unobserve(el);
        continue;
      }
      if (e.isIntersecting) {
        if (!el.dataset.drawn) {
          el.dataset.drawn = '1';
          ensureFonts().then(() => {
            if (el.isConnected && el.__draw) el.innerHTML = el.__draw();
          });
        }
      } else if (el.dataset.drawn) {
        delete el.dataset.drawn;
        el.innerHTML = '';
      }
    }
  }, { rootMargin: '600px 0px' })
  : null;

export function pageThumb(el, p, page) {
  el.__draw = () => pageSvg(buildPage(p, page, { preview: true }), { className: 'thumb-svg' });
  if (observer) observer.observe(el);
  else ensureFonts().then(() => { el.innerHTML = el.__draw(); });
  return el;
}
