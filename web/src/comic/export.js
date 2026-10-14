// Comic exports: a print-ready PDF (one page per sheet, at the comic's size),
// a CBZ archive of page images for comic readers, and the comic script.
import { escapeHtml } from '../util.js';
import { findById } from '../model.js';
import { makeZip } from '../zip.js';
import { imageUrl } from '../images.js';
import { COMIC_FONT_CSS } from '../gen/fonts.js';
import { formatOf, allPages, LETTERING, ratioOf } from './model.js';
import { buildPage, pageSvg, renderPageCanvas, ensureFonts } from './render.js';
import { DEFAULT_EXPORT } from '../export.js';

/** HTML for the print dialog: each comic page fills one sheet of the comic's size. */
export async function comicPrintHtml(p) {
  await ensureFonts();
  const f = formatOf(p);
  const pages = allPages(p).map(({ page }) => `<section class="sheet">${pageSvg(buildPage(p, page), { href: (o) => imageUrl(o.ref, p.id) })}</section>`);
  return {
    size: { w: f.w, h: f.h },
    html: `<!doctype html><html lang="${escapeHtml(p.language || 'en')}"><head><meta charset="utf-8"><title>${escapeHtml(p.title)}</title>
<style>${COMIC_FONT_CSS}
@page { size: ${f.w}in ${f.h}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { width: ${f.w}in; height: ${f.h}in; page-break-after: always; break-after: page; overflow: hidden; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.sheet svg { display: block; width: 100%; height: 100%; }
</style></head><body>${pages.join('\n') || '<p>No pages yet.</p>'}</body></html>`,
  };
}

function comicInfo(p, count) {
  const x = escapeHtml;
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${x(p.title)}</Title>
  ${p.author ? `<Writer>${x(p.author)}</Writer>` : ''}
  <PageCount>${count}</PageCount>
  <LanguageISO>${x(p.language || 'en')}</LanguageISO>
  <Manga>${p.comic && p.comic.rtl ? 'YesAndRightToLeft' : 'No'}</Manga>
  <Notes>Made with Bookative</Notes>
</ComicInfo>`;
}

/** CBZ: a zip of page images (JPEG) plus ComicInfo.xml, readable by most comic apps. */
export async function toCbz(p, onProgress) {
  const pages = allPages(p);
  const ratio = ratioOf(p);
  const longSide = 2400;
  const height = ratio >= 1 ? longSide : Math.round(longSide * ratio);
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderPageCanvas(p, pages[i].page, height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    files.push({ name: `${String(i + 1).padStart(3, '0')}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
    canvas.width = 0;
    if (onProgress) onProgress(i + 1, pages.length);
  }
  files.push({ name: 'ComicInfo.xml', data: comicInfo(p, pages.length) });
  return makeZip(files);
}

/** One page rendered as a PNG (for sharing a single page). */
export async function pagePng(p, page, height = 2000) {
  const canvas = await renderPageCanvas(p, page, height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------- script

const WORD_NUM = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];

function line(label, text) {
  const t = escapeHtml(text || '').replace(/\n/g, '<br>');
  return `<p><b>${escapeHtml(label)}:</b> ${t}</p>`;
}

/**
 * The comic as a script, in the usual layout: page and panel headings,
 * panel descriptions, then lettering as NAME: text. Same document model as the
 * book exports, so it goes to Word, PDF, EPUB, HTML, Markdown and text.
 */
export function buildComicScriptDoc(p, opts) {
  const o = { ...DEFAULT_EXPORT, ...opts, images: false };
  const nodes = [];
  if (o.titlePage) nodes.push({ t: 'title', title: p.title, author: p.author });
  let pageNo = 0;
  p.chapters.forEach((ch, ci) => {
    nodes.push({ t: 'chapter', label: `Chapter ${ci + 1}`, title: ch.title || '' });
    for (const page of ch.pages) {
      pageNo++;
      const word = WORD_NUM[pageNo - 1];
      nodes.push({ t: 'h2', text: `Page ${word ? `${word.charAt(0)}${word.slice(1).toLowerCase()}` : pageNo} (${page.panels.length} ${page.panels.length === 1 ? 'panel' : 'panels'})` });
      page.panels.forEach((panel, pi) => {
        nodes.push({ t: 'h3', text: `Panel ${pi + 1}` });
        let html = panel.desc ? `<p>${escapeHtml(panel.desc).replace(/\n/g, '<br>')}</p>` : '';
        for (const it of panel.items) {
          if (!it.text) continue;
          const who = it.speaker ? (findById(p.characters, it.speaker)?.name || 'Unknown').toUpperCase() : '';
          if (it.type === 'caption') html += line(who ? `CAPTION (${who})` : 'CAPTION', it.text);
          else if (it.type === 'sfx') html += line('SFX', it.text);
          else {
            const kind = it.type === 'speech' ? '' : ` (${LETTERING[it.type].toLowerCase()})`;
            html += line(`${who || 'VOICE'}${kind}`, it.text);
          }
        }
        if (html) nodes.push({ t: 'html', html });
      });
    }
  });
  return { nodes, o, pid: p.id, title: p.title, author: p.author, language: p.language || 'en' };
}
