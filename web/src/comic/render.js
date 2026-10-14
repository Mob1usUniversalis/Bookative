// Draws comic pages. A page is first turned into a list of simple shapes
// (rectangles, ellipses, paths, images, text), which is then written out as SVG
// (for the screen and print) or painted onto a canvas (for CBZ / image export),
// so every output looks the same.
import { W, ratioOf, lettered } from './model.js';
import { imageUrl, hasImage, readImageBytes, writeImageB64, mimeOf } from '../images.js';
import { toBase64 } from '../platform.js';

export const LETTER_FONT = "'Balsamiq Sans', 'Comic Sans MS', 'Segoe Print', sans-serif";
export const SFX_FONT = "'Bangers', 'Russo One', Impact, 'Arial Black', sans-serif";
const BASE = 25;
const INK = '#111111';
const LINE = 3.2;

let fontsReady = null;
/** Resolves when the lettering fonts are loaded (text is measured with them). */
export function ensureFonts() {
  if (!fontsReady) {
    const sample = 'AaЖжӘәҚқ!?';
    fontsReady = Promise.all([
      document.fonts.load(`400 ${BASE}px 'Balsamiq Sans'`, sample),
      document.fonts.load(`700 ${BASE}px 'Balsamiq Sans'`, sample),
      document.fonts.load(`400 ${BASE}px 'Bangers'`, 'ABC'),
      document.fonts.load(`400 ${BASE}px 'Russo One'`, 'АБВ'),
    ]).catch(() => null);
  }
  return fontsReady;
}

// ---------------------------------------------------------------- text

let mctx = null;
function measure(text, font) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = font;
  return mctx.measureText(text).width;
}

export function wrapText(text, size, weight, family, maxW) {
  const font = `${weight} ${size}px ${family}`;
  const lines = [];
  const pushWord = (word, line) => {
    // breaks words longer than the line
    let chunk = '';
    for (const ch of word) {
      if (chunk && measure(line + chunk + ch, font) > maxW) {
        lines.push(line + chunk);
        line = '';
        chunk = ch;
      } else chunk += ch;
    }
    return line + chunk;
  };
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (measure(test, font) <= maxW) line = test;
      else if (!line) line = pushWord(w, '');
      else {
        lines.push(line);
        line = measure(w, font) > maxW ? pushWord(w, '') : w;
      }
    }
    lines.push(line);
  }
  const widths = lines.map((l) => measure(l, font));
  return { lines, widths, width: Math.max(1, ...widths), font };
}

// ---------------------------------------------------------------- geometry helpers

const r2 = (n) => Math.round(n * 100) / 100;
const pt = (p) => `${r2(p[0])},${r2(p[1])}`;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

function ellipsePoint(cx, cy, rx, ry, t, k = 1) {
  return [cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)];
}

/** Tail from an ellipse towards (tx, ty): outline path and the patch that hides the seam. */
function tail(cx, cy, rx, ry, tx, ty, spread) {
  const dx = (tx - cx) / rx;
  const dy = (ty - cy) / ry;
  if (dx * dx + dy * dy <= 1.05) return null; // tip inside the balloon
  const t = Math.atan2(dy, dx);
  const p1 = ellipsePoint(cx, cy, rx, ry, t - spread);
  const p2 = ellipsePoint(cx, cy, rx, ry, t + spread);
  const tip = [tx, ty];
  const base = lerp(p1, p2, 0.5);
  const c1 = lerp(lerp(p1, tip, 0.5), lerp(base, tip, 0.5), 0.35);
  const c2 = lerp(lerp(p2, tip, 0.5), lerp(base, tip, 0.5), 0.35);
  const outline = `M${pt(p1)} Q${pt(c1)} ${pt(tip)} Q${pt(c2)} ${pt(p2)} Z`;
  const i1 = ellipsePoint(cx, cy, rx, ry, t - spread * 0.62, 0.9);
  const i2 = ellipsePoint(cx, cy, rx, ry, t + spread * 0.62, 0.9);
  const m = lerp(base, tip, 0.22);
  const patch = `M${pt(i1)} L${pt(m)} L${pt(i2)} Z`;
  return { outline, patch };
}

// ---------------------------------------------------------------- lettering

/** Shapes for one lettering item, plus its box (for selection) in page units. */
export function letteringShapes(item, H, p) {
  const ops = [];
  const cx = item.x * W;
  const cy = item.y * H;
  const scale = item.size || 1;
  const text = lettered(item.text || '', p) || (item.type === 'sfx' ? 'BAM!' : '…');
  const empty = !item.text;

  if (item.type === 'sfx') {
    const size = BASE * 2.8 * scale;
    const lines = String(text).split('\n');
    const lh = size * 1.0;
    const widths = lines.map((l) => measure(l, `400 ${size}px ${SFX_FONT}`));
    const width = Math.max(1, ...widths);
    const y0 = cy - (lines.length * lh) / 2 + size * 0.8;
    ops.push({
      k: 'text', lines: lines.map((t, i) => ({ t, x: cx, y: y0 + i * lh })), size, weight: 400, family: SFX_FONT,
      fill: item.color || '#ffd23f', stroke: INK, sw: size * 0.16, anchor: 'middle', rot: item.rot || 0, rcx: cx, rcy: cy,
      opacity: empty ? 0.45 : 1,
    });
    const bw = width + size * 0.3;
    const bh = lines.length * lh + size * 0.2;
    return { ops, box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, tip: null };
  }

  const size = BASE * scale;
  const weight = item.type === 'shout' ? 700 : 400;
  const maxW = Math.max(size * 3, item.w * W);
  const wrap = wrapText(text, size, weight, LETTER_FONT, maxW);
  const lh = size * 1.2;
  const blockH = wrap.lines.length * lh;
  const tw = wrap.width;
  const textOp = (anchor, x) => ({
    k: 'text', size, weight, family: LETTER_FONT, fill: INK, anchor, opacity: empty ? 0.45 : 1,
    lines: wrap.lines.map((t, i) => ({ t, x, y: cy - blockH / 2 + size * 0.86 + i * lh })),
  });

  if (item.type === 'caption') {
    const pad = size * 0.55;
    const bw = tw + pad * 2;
    const bh = blockH + pad * 1.6;
    const box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    ops.push({ k: 'rect', ...box, fill: '#fff3c4', stroke: INK, sw: LINE * 0.8 });
    ops.push(textOp('start', box.x + pad));
    return { ops, box, tip: null };
  }

  const rx = tw / 2 * 1.16 + size * 0.95;
  const ry = blockH / 2 * 1.22 + size * 0.8;
  const tip = item.tx != null ? [item.tx * W, item.ty * H] : null;
  const box = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
  const dash = item.type === 'whisper' ? [size * 0.45, size * 0.3] : null;
  const fill = '#ffffff';

  if (item.type === 'thought') {
    const rnd = hash(item.id || 'x');
    const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = Math.max(8, Math.round(per / (size * 1.5)));
    const bumps = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const [x, y] = ellipsePoint(cx, cy, rx, ry, t, 0.97);
      bumps.push({ k: 'circle', cx: x, cy: y, r: size * (0.72 + rnd() * 0.25), fill, stroke: INK, sw: LINE * 0.8 });
    }
    if (tip) {
      const edge = ellipsePoint(cx, cy, rx, ry, Math.atan2((tip[1] - cy) / ry, (tip[0] - cx) / rx), 1.08);
      [0.25, 0.55, 0.85].forEach((f, i) => {
        const [x, y] = lerp(edge, tip, f);
        ops.push({ k: 'circle', cx: x, cy: y, r: size * (0.55 - i * 0.15), fill, stroke: INK, sw: LINE * 0.7 });
      });
    }
    ops.push(...bumps);
    ops.push({ k: 'ellipse', cx, cy, rx: rx * 0.97, ry: ry * 0.97, fill });
    ops.push(textOp('middle', cx));
    return { ops, box, tip };
  }

  let outline;
  if (item.type === 'shout') {
    const rnd = hash(item.id || 'x');
    const n = Math.max(14, Math.round((rx + ry) / (size * 0.55)));
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const t = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 ? 1.0 + rnd() * 0.04 : 1.2 + rnd() * 0.12;
      pts.push(ellipsePoint(cx, cy, rx, ry, t, k));
    }
    outline = { k: 'path', d: `M${pts.map(pt).join(' L')} Z`, fill, stroke: INK, sw: LINE, join: 'miter' };
  } else {
    outline = { k: 'ellipse', cx, cy, rx, ry, fill, stroke: INK, sw: LINE, dash };
  }
  const tl = tip ? tail(cx, cy, rx, ry, tip[0], tip[1], Math.min(0.32, Math.max(0.16, (size * 1.6) / Math.min(rx, ry) * 0.25))) : null;
  if (tl) ops.push({ k: 'path', d: tl.outline, fill, stroke: INK, sw: LINE, dash, join: 'round' });
  ops.push(outline);
  if (tl) ops.push({ k: 'path', d: tl.patch, fill });
  ops.push(textOp('middle', cx));
  return { ops, box, tip };
}

// ---------------------------------------------------------------- panels

/** Where a panel picture goes: cover-fit, then zoom and pan. */
export function picturePlacement(panel, H) {
  const px = panel.x * W;
  const py = panel.y * H;
  const pw = panel.w * W;
  const ph = panel.h * H;
  const iw = panel.iw || pw;
  const ih = panel.ih || ph;
  const z = Math.max(1, (panel.fit && panel.fit.z) || 1);
  const s = Math.max(pw / iw, ph / ih) * z;
  const dw = iw * s;
  const dh = ih * s;
  const ox = (panel.fit && panel.fit.ox) || 0;
  const oy = (panel.fit && panel.fit.oy) || 0;
  return { x: px + (pw - dw) / 2 + (ox * (dw - pw)) / 2, y: py + (ph - dh) / 2 + (oy * (dh - ph)) / 2, w: dw, h: dh, pw, ph };
}

function coverRect(panel, H, w0, h0) {
  const px = panel.x * W;
  const py = panel.y * H;
  const pw = panel.w * W;
  const ph = panel.h * H;
  const s = Math.max(pw / (w0 || pw), ph / (h0 || ph));
  const dw = (w0 || pw) * s;
  const dh = (h0 || ph) * s;
  return { x: px + (pw - dw) / 2, y: py + (ph - dh) / 2, w: dw, h: dh };
}

export function panelShapes(panel, H, { preview = false } = {}) {
  const box = { x: panel.x * W, y: panel.y * H, w: panel.w * W, h: panel.h * H };
  const ops = [{ k: 'rect', ...box, fill: panel.bg || '#ffffff' }];
  if (panel.img) ops.push({ k: 'image', ref: panel.img, preview, ...picturePlacement(panel, H), clip: box });
  if (panel.drawing) ops.push({ k: 'image', ref: panel.drawing, preview, ...coverRect(panel, H, panel.dw, panel.dh), clip: box });
  if (panel.border !== false) ops.push({ k: 'rect', ...box, fill: 'none', stroke: INK, sw: LINE * 1.15 });
  return { ops, box };
}

/**
 * Builds the shapes for a page.
 * overlay: { panel: id, item: id, adjust: bool } adds selection marks for the editor.
 */
export function buildPage(p, page, { overlay = null, preview = false } = {}) {
  const H = W * ratioOf(p);
  const panels = [];
  const lettering = [];
  const meta = { panels: {}, items: {} };
  for (const panel of page.panels) {
    const s = panelShapes(panel, H, { preview });
    panels.push({ k: 'group', attrs: { 'data-panel': panel.id }, ops: s.ops });
    meta.panels[panel.id] = s.box;
  }
  for (const panel of page.panels) {
    for (const item of panel.items) {
      const s = letteringShapes(item, H, p);
      lettering.push({ k: 'group', attrs: { 'data-item': item.id }, ops: s.ops });
      meta.items[item.id] = s;
    }
  }
  const marks = [];
  if (overlay) {
    const accent = '#3d5afe';
    if (overlay.panel && meta.panels[overlay.panel]) {
      const b = meta.panels[overlay.panel];
      marks.push({ k: 'rect', x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12, fill: 'none', stroke: accent, sw: 5, dash: overlay.adjust ? [4, 10] : [18, 10] });
    }
    const it = overlay.item && meta.items[overlay.item];
    if (it) {
      const b = it.box;
      marks.push({ k: 'rect', x: b.x - 10, y: b.y - 10, w: b.w + 20, h: b.h + 20, fill: 'none', stroke: accent, sw: 4, dash: [14, 9] });
      marks.push({ k: 'group', attrs: { 'data-handle': 'width' }, ops: [{ k: 'rect', x: b.x + b.w + 2, y: b.y + b.h / 2 - 18, w: 18, h: 36, fill: accent, rx: 5 }] });
      if (it.tip) marks.push({ k: 'group', attrs: { 'data-handle': 'tail' }, ops: [{ k: 'circle', cx: it.tip[0], cy: it.tip[1], r: 17, fill: accent, stroke: '#ffffff', sw: 4 }] });
    }
  }
  return { H, panels, lettering, marks, meta };
}

// ---------------------------------------------------------------- SVG output

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function styleAttrs(o) {
  let a = '';
  a += ` fill="${o.fill || 'none'}"`;
  if (o.stroke) a += ` stroke="${o.stroke}" stroke-width="${r2(o.sw || 1)}"`;
  if (o.dash) a += ` stroke-dasharray="${o.dash.map(r2).join(' ')}"`;
  if (o.join) a += ` stroke-linejoin="${o.join}"`;
  if (o.opacity != null && o.opacity !== 1) a += ` opacity="${o.opacity}"`;
  return a;
}

let clipSeq = 0;

/** hrefFor(op) gives the address of an image op. */
export function opsToSvg(ops, hrefFor) {
  let out = '';
  for (const o of ops) {
    switch (o.k) {
      case 'group': {
        const attrs = Object.entries(o.attrs || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
        out += `<g${attrs}>${opsToSvg(o.ops, hrefFor)}</g>`;
        break;
      }
      case 'rect':
        out += `<rect x="${r2(o.x)}" y="${r2(o.y)}" width="${r2(o.w)}" height="${r2(o.h)}"${o.rx ? ` rx="${o.rx}"` : ''}${styleAttrs(o)}/>`;
        break;
      case 'ellipse':
        out += `<ellipse cx="${r2(o.cx)}" cy="${r2(o.cy)}" rx="${r2(o.rx)}" ry="${r2(o.ry)}"${styleAttrs(o)}/>`;
        break;
      case 'circle':
        out += `<circle cx="${r2(o.cx)}" cy="${r2(o.cy)}" r="${r2(o.r)}"${styleAttrs(o)}/>`;
        break;
      case 'path':
        out += `<path d="${o.d}"${styleAttrs(o)}/>`;
        break;
      case 'image': {
        const href = hrefFor(o);
        if (!href) break;
        const id = `cp${++clipSeq}`;
        const c = o.clip;
        out += `<clipPath id="${id}"><rect x="${r2(c.x)}" y="${r2(c.y)}" width="${r2(c.w)}" height="${r2(c.h)}"/></clipPath>`;
        out += `<image clip-path="url(#${id})" href="${esc(href)}" x="${r2(o.x)}" y="${r2(o.y)}" width="${r2(o.w)}" height="${r2(o.h)}" preserveAspectRatio="none"/>`;
        break;
      }
      case 'text': {
        const anchor = o.anchor === 'start' ? 'start' : 'middle';
        let attrs = ` font-family="${esc(o.family)}" font-size="${r2(o.size)}" font-weight="${o.weight}" text-anchor="${anchor}" fill="${o.fill}"`;
        if (o.stroke) attrs += ` stroke="${o.stroke}" stroke-width="${r2(o.sw)}" stroke-linejoin="round" paint-order="stroke"`;
        if (o.rot) attrs += ` transform="rotate(${r2(o.rot)} ${r2(o.rcx)} ${r2(o.rcy)})"`;
        if (o.opacity != null && o.opacity !== 1) attrs += ` opacity="${o.opacity}"`;
        out += `<text${attrs}>${o.lines.map((l) => `<tspan x="${r2(l.x)}" y="${r2(l.y)}">${esc(l.t)}</tspan>`).join('')}</text>`;
        break;
      }
    }
  }
  return out;
}

export function previewName(name) {
  return name.replace(/\.(\w+)$/, (m, ext) => `.p.${ext === 'gif' ? 'png' : ext}`);
}

const pendingPreviews = new Set();

/** Small copy of a picture for page thumbnails; created in the background when missing. */
export function previewUrl(name) {
  const pn = previewName(name);
  if (hasImage(pn)) return imageUrl(pn);
  if (!pendingPreviews.has(name)) {
    pendingPreviews.add(name);
    setTimeout(() => makePreview(name).finally(() => pendingPreviews.delete(name)), 50);
  }
  return imageUrl(name);
}

async function makePreview(name) {
  const bytes = readImageBytes(name);
  if (!bytes) return;
  const blob = new Blob([bytes], { type: mimeOf(name) });
  let img;
  try {
    img = await createImageBitmap(blob);
  } catch {
    return;
  }
  const s = Math.min(1, 420 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const png = name.endsWith('.png') || name.endsWith('.gif');
  const out = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.8));
  if (!out) return;
  writeImageB64(previewName(name), toBase64(new Uint8Array(await out.arrayBuffer())));
}

const defaultHref = (o) => (o.preview ? previewUrl(o.ref) : imageUrl(o.ref));

/** Full SVG document for a page. */
export function pageSvg(built, { width = null, height = null, href = defaultHref, css = '', className = '' } = {}) {
  const H = built.H;
  const size = width ? ` width="${width}" height="${height || r2((width * H) / W)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${r2(H)}"${size}${className ? ` class="${className}"` : ''}>`
    + (css ? `<style>${css}</style>` : '')
    + `<rect width="${W}" height="${r2(H)}" fill="#ffffff"/>`
    + `<g class="layer-panels">${opsToSvg(built.panels, href)}</g>`
    + `<g class="layer-lettering">${opsToSvg(built.lettering, href)}</g>`
    + `<g class="layer-marks">${opsToSvg(built.marks, href)}</g>`
    + '</svg>';
}

// ---------------------------------------------------------------- canvas output

function paint(ctx, o) {
  if (o.fill && o.fill !== 'none') {
    ctx.fillStyle = o.fill;
    ctx.fill();
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.sw || 1;
    ctx.lineJoin = o.join || 'round';
    ctx.setLineDash(o.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** images: Map(ref -> decoded image) */
export function drawOps(ctx, ops, images) {
  for (const o of ops) {
    ctx.save();
    if (o.opacity != null) ctx.globalAlpha = o.opacity;
    switch (o.k) {
      case 'group':
        drawOps(ctx, o.ops, images);
        break;
      case 'rect':
        ctx.beginPath();
        ctx.rect(o.x, o.y, o.w, o.h);
        paint(ctx, o);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(o.cx, o.cy, o.rx, o.ry, 0, 0, Math.PI * 2);
        paint(ctx, o);
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
        paint(ctx, o);
        break;
      case 'path': {
        const path = new Path2D(o.d);
        if (o.fill && o.fill !== 'none') {
          ctx.fillStyle = o.fill;
          ctx.fill(path);
        }
        if (o.stroke) {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.sw || 1;
          ctx.lineJoin = o.join || 'round';
          ctx.setLineDash(o.dash || []);
          ctx.stroke(path);
        }
        break;
      }
      case 'image': {
        const img = images.get(o.ref);
        if (!img) break;
        ctx.beginPath();
        ctx.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h);
        ctx.clip();
        ctx.drawImage(img, o.x, o.y, o.w, o.h);
        break;
      }
      case 'text': {
        ctx.font = `${o.weight} ${o.size}px ${o.family}`;
        ctx.textAlign = o.anchor === 'start' ? 'left' : 'center';
        ctx.textBaseline = 'alphabetic';
        if (o.rot) {
          ctx.translate(o.rcx, o.rcy);
          ctx.rotate((o.rot * Math.PI) / 180);
          ctx.translate(-o.rcx, -o.rcy);
        }
        for (const l of o.lines) {
          if (o.stroke) {
            ctx.strokeStyle = o.stroke;
            ctx.lineWidth = o.sw;
            ctx.lineJoin = 'round';
            ctx.strokeText(l.t, l.x, l.y);
          }
          ctx.fillStyle = o.fill;
          ctx.fillText(l.t, l.x, l.y);
        }
        break;
      }
    }
    ctx.restore();
  }
}

function imageRefs(ops, out = new Set()) {
  for (const o of ops) {
    if (o.k === 'group') imageRefs(o.ops, out);
    else if (o.k === 'image') out.add(o.ref);
  }
  return out;
}

/** Renders a page to a canvas `height` pixels tall. Returns the canvas. */
export async function renderPageCanvas(p, page, height) {
  await ensureFonts();
  const built = buildPage(p, page);
  const scale = height / built.H;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, built.H);
  const images = new Map();
  for (const ref of imageRefs([...built.panels])) {
    const bytes = readImageBytes(ref);
    if (!bytes) continue;
    try {
      images.set(ref, await createImageBitmap(new Blob([bytes], { type: mimeOf(ref) })));
    } catch { /* unreadable picture: leave the panel empty */ }
  }
  drawOps(ctx, built.panels, images);
  drawOps(ctx, built.lettering, images);
  for (const img of images.values()) if (img.close) img.close();
  return canvas;
}
