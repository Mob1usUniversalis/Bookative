// Export: turns a project into a neutral list of document nodes and renders
// it as plain text, Markdown, HTML (also used for PDF printing), DOCX or EPUB.
// Pictures travel with every format except plain text.
import { htmlToBlocks, isEmptyHtml } from './text.js';
import { makeZip } from './zip.js';
import { CHARACTER_SECTIONS } from './questions.js';
import { ARCH_ITEMS, ensureSections, sceneText, locationLabel, locationSub, chapterLabel } from './model.js';
import { ROMAN } from './util.js';
import { FONT_CSS } from './gen/fonts.js';
import { exportImage, imgSrc as pictureSrc } from './images.js';
import { toBase64 } from './platform.js';

export const DEFAULT_EXPORT = {
  content: 'novel', // novel | bible | everything
  titlePage: true,
  chapterLabel: 'word', // word | number | roman | none
  chapterTitles: true,
  sceneTitles: false,
  separator: '* * *', // '* * *' | '#' | '⁂' | 'blank'
  indent: true,
  images: true,
};

// ---------------------------------------------------------------- document model

function chapterLabelText(i, style) {
  if (style === 'word') return `Chapter ${i + 1}`;
  if (style === 'number') return String(i + 1);
  if (style === 'roman') return ROMAN(i + 1);
  return '';
}

function novelNodes(p, nodes, o) {
  p.chapters.forEach((ch, i) => {
    const label = chapterLabelText(i, o.chapterLabel);
    const title = o.chapterTitles ? ch.title || '' : '';
    nodes.push({ t: 'chapter', label, title: title || (!label ? chapterLabel(ch, p) : '') });
    ch.scenes.forEach((s, j) => {
      if (j > 0 && o.separator !== 'none') nodes.push({ t: 'sep', text: o.separator === 'blank' ? '' : o.separator });
      if (o.sceneTitles && s.title) nodes.push({ t: 'h2', text: s.title });
      const html = sceneText(s);
      if (!isEmptyHtml(html)) nodes.push({ t: 'html', html });
    });
  });
}

function bibleNodes(p, nodes, o) {
  const picture = (item) => {
    if (o.images && item.image) nodes.push({ t: 'image', ref: item.image, size: 'small' });
  };
  const arch = ARCH_ITEMS.filter((a) => !isEmptyHtml(p.architecture[a.key].text));
  if (arch.length || p.strands.length) {
    nodes.push({ t: 'part', text: 'Architecture' });
    for (const a of arch) {
      nodes.push({ t: 'h2', text: a.title });
      nodes.push({ t: 'html', html: p.architecture[a.key].text });
    }
    if (p.strands.length) {
      nodes.push({ t: 'h2', text: 'Narrative strands' });
      for (const s of p.strands) {
        nodes.push({ t: 'h3', text: s.title || 'Untitled strand' });
        if (!isEmptyHtml(s.description)) nodes.push({ t: 'html', html: s.description });
      }
    }
  }

  const mains = p.characters.filter((c) => c.kind === 'main');
  const secondary = p.characters.filter((c) => c.kind !== 'main');
  if (p.characters.length) {
    nodes.push({ t: 'part', text: 'Characters' });
    for (const c of mains) {
      nodes.push({ t: 'h2', text: c.name });
      picture(c);
      const secs = ensureSections(c);
      for (const def of CHARACTER_SECTIONS) {
        const sec = secs[def.key];
        if (sec.mode === 'freetext') {
          if (isEmptyHtml(sec.text)) continue;
          nodes.push({ t: 'h3', text: def.title });
          nodes.push({ t: 'html', html: sec.text });
        } else {
          const answered = def.questions.map((q, qi) => [q, sec.answers[qi]]).filter(([, a]) => !isEmptyHtml(a));
          if (!answered.length) continue;
          nodes.push({ t: 'h3', text: def.title });
          for (const [q, a] of answered) {
            nodes.push({ t: 'q', text: q });
            nodes.push({ t: 'html', html: a });
          }
        }
      }
      if (!isEmptyHtml(c.notes)) {
        nodes.push({ t: 'h3', text: 'Notes' });
        nodes.push({ t: 'html', html: c.notes });
      }
    }
    if (secondary.length) {
      nodes.push({ t: 'h2', text: 'Secondary characters' });
      for (const c of secondary) {
        nodes.push({ t: 'h3', text: c.name });
        picture(c);
        if (!isEmptyHtml(c.description)) nodes.push({ t: 'html', html: c.description });
      }
    }
  }

  if (p.locations.length) {
    nodes.push({ t: 'part', text: 'Locations' });
    for (const l of p.locations) {
      nodes.push({ t: 'h2', text: locationLabel(l) });
      const sub = locationSub(l);
      if (sub) nodes.push({ t: 'meta', text: sub });
      picture(l);
      if (!isEmptyHtml(l.description)) nodes.push({ t: 'html', html: l.description });
    }
  }

  if (p.objects.length) {
    nodes.push({ t: 'part', text: 'Objects' });
    for (const ob of p.objects) {
      nodes.push({ t: 'h2', text: ob.name || 'Unnamed object' });
      picture(ob);
      if (!isEmptyHtml(ob.description)) nodes.push({ t: 'html', html: ob.description });
    }
  }

  const planned = p.chapters.filter((ch) => !isEmptyHtml(ch.reason.text) || !isEmptyHtml(ch.notes));
  if (planned.length) {
    nodes.push({ t: 'part', text: 'Chapter plans' });
    for (const ch of planned) {
      nodes.push({ t: 'h2', text: chapterLabel(ch, p) });
      if (!isEmptyHtml(ch.reason.text)) {
        nodes.push({ t: 'h3', text: 'Purpose of the chapter' });
        nodes.push({ t: 'html', html: ch.reason.text });
      }
      if (!isEmptyHtml(ch.notes)) {
        nodes.push({ t: 'h3', text: 'Notes' });
        nodes.push({ t: 'html', html: ch.notes });
      }
    }
  }

  if (p.notes.length) {
    nodes.push({ t: 'part', text: 'Notes' });
    for (const n of p.notes) {
      nodes.push({ t: 'h2', text: n.title || 'Untitled note' });
      if (!isEmptyHtml(n.text)) nodes.push({ t: 'html', html: n.text });
    }
  }
}

export function buildDoc(p, opts) {
  const o = { ...DEFAULT_EXPORT, ...opts };
  const nodes = [];
  if (o.titlePage) nodes.push({ t: 'title', title: p.title, author: p.author });
  if (o.content === 'bible' || o.content === 'everything') bibleNodes(p, nodes, o);
  if (o.content === 'everything' && p.chapters.length) nodes.push({ t: 'part', text: 'Manuscript' });
  if (o.content === 'novel' || o.content === 'everything') novelNodes(p, nodes, o);
  return { nodes, o, pid: p.id, title: p.title, author: p.author, language: p.language || 'en' };
}

/** Looks up pictures for an export (cached; null when pictures are switched off or missing). */
function imageLookup(doc) {
  const cache = new Map();
  return (ref) => {
    if (!doc.o.images || !ref) return null;
    if (!cache.has(ref)) {
      let info = null;
      try { info = exportImage(ref, doc.pid); } catch (e) { console.error(e); }
      cache.set(ref, info);
    }
    return cache.get(ref);
  };
}


// ---------------------------------------------------------------- helpers

const xml = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !r.br && !last.br && !!last.b === !!r.b && !!last.i === !!r.i && !!last.u === !!r.u && !!last.s === !!r.s) {
      last.text += r.text;
    } else out.push({ ...r });
  }
  return out;
}

const runsText = (runs) => runs.map((r) => (r.br ? '\n' : r.text)).join('');

function chapterHeadingText(n) {
  return [n.label, n.title].filter(Boolean).join(n.label && /^\d+$|^[IVXLCDM]+$/.test(n.label) ? '. ' : ': ');
}

// ---------------------------------------------------------------- text & markdown

export function toText(doc) {
  const out = [];
  for (const n of doc.nodes) {
    switch (n.t) {
      case 'title':
        out.push(n.title.toUpperCase(), n.author ? `by ${n.author}` : '', '', '');
        break;
      case 'part':
        out.push('', '', n.text.toUpperCase(), '='.repeat(Math.min(60, n.text.length)), '');
        break;
      case 'chapter':
        out.push('', '', chapterHeadingText(n), '');
        break;
      case 'h2':
      case 'h3':
        out.push('', n.text, '');
        break;
      case 'q':
        out.push(n.text);
        break;
      case 'meta':
        out.push(n.text, '');
        break;
      case 'sep':
        out.push(n.text ? `        ${n.text}` : '', '');
        break;
      case 'image':
        if (doc.o.images) out.push('[Picture]', '');
        break;
      case 'html':
        for (const b of htmlToBlocks(n.html)) {
          if (b.type === 'img') {
            if (doc.o.images) out.push('[Picture]', '');
            continue;
          }
          const t = runsText(b.runs);
          if (b.type === 'li') out.push((b.ordered ? `${b.index}. ` : '• ') + t);
          else if (b.type === 'quote') out.push(t.split('\n').map((l) => '    ' + l).join('\n'), '');
          else out.push(t, '');
        }
        break;
    }
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function mdEscape(s) {
  return s.replace(/([\\*_`~\[\]])/g, '\\$1');
}

function mdRuns(runs) {
  return mergeRuns(runs)
    .map((r) => {
      if (r.br) return '  \n';
      let t = mdEscape(r.text);
      const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
      let [, lead, core, trail] = m;
      if (!core) return t;
      if (r.s) core = `~~${core}~~`;
      if (r.i) core = `*${core}*`;
      if (r.b) core = `**${core}**`;
      if (r.u) core = `<u>${core}</u>`;
      return lead + core + trail;
    })
    .join('');
}

/** Returns { text, images: [{ name, bytes }] }; with pictures the caller zips them with the text. */
export function toMarkdown(doc) {
  const out = [];
  const lookup = imageLookup(doc);
  const used = new Map();
  const picture = (ref) => {
    const info = lookup(ref);
    if (!info) return;
    used.set(info.name, info.bytes);
    out.push(`![](images/${info.name})`, '');
  };
  for (const n of doc.nodes) {
    switch (n.t) {
      case 'image':
        picture(n.ref);
        break;
      case 'title':
        out.push(`# ${n.title}`, '');
        if (n.author) out.push(`*${mdEscape(n.author)}*`, '');
        break;
      case 'part':
        out.push(`# ${n.text}`, '');
        break;
      case 'chapter':
        out.push(`## ${chapterHeadingText(n)}`, '');
        break;
      case 'h2':
        out.push(`### ${n.text}`, '');
        break;
      case 'h3':
        out.push(`#### ${n.text}`, '');
        break;
      case 'q':
        out.push(`**${mdEscape(n.text)}**`, '');
        break;
      case 'meta':
        out.push(`*${mdEscape(n.text)}*`, '');
        break;
      case 'sep':
        out.push(n.text ? `<p align="center">${xml(n.text)}</p>` : '&nbsp;', '');
        break;
      case 'html': {
        let inList = false;
        for (const b of htmlToBlocks(n.html)) {
          if (b.type === 'img') {
            if (inList) {
              out.push('');
              inList = false;
            }
            picture(b.ref);
            continue;
          }
          const t = mdRuns(b.runs).replace(/^(#|>|\d+\.|-|\+)/, '\\$1');
          if (b.type === 'li') {
            out.push((b.ordered ? `${b.index}. ` : '- ') + t);
            inList = true;
            continue;
          }
          if (inList) {
            out.push('');
            inList = false;
          }
          if (b.type === 'quote') out.push(t.split('\n').map((l) => '> ' + l).join('\n'), '');
          else out.push(t, '');
        }
        if (inList) out.push('');
        break;
      }
    }
  }
  return {
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    images: [...used.entries()].map(([name, bytes]) => ({ name, bytes })),
  };
}

// ---------------------------------------------------------------- HTML / XHTML

function figureHtml(src, size, selfClose) {
  const cls = size === 'small' || size === 'medium' ? ` fig-${size}` : '';
  return `<div class="figure${cls}"><img src="${src}" alt=""${selfClose ? '/' : ''}></div>`;
}

function runsHtml(runs, selfClose) {
  return mergeRuns(runs)
    .map((r) => {
      if (r.br) return selfClose ? '<br/>' : '<br>';
      let t = xml(r.text);
      if (r.s) t = `<s>${t}</s>`;
      if (r.u) t = `<u>${t}</u>`;
      if (r.i) t = `<em>${t}</em>`;
      if (r.b) t = `<strong>${t}</strong>`;
      return t;
    })
    .join('');
}

function blocksHtml(html, state, selfClose, imgSrc) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of htmlToBlocks(html)) {
    if (b.type === 'img') {
      const src = imgSrc(b.ref);
      if (src) {
        closeList();
        out.push(figureHtml(src, b.size, selfClose));
        state.first = true;
      }
      continue;
    }
    const style = b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '';
    const inner = runsHtml(b.runs, selfClose);
    if (b.type === 'li') {
      const tag = b.ordered ? 'ol' : 'ul';
      if (list !== tag) {
        closeList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li${style}>${inner}</li>`);
      continue;
    }
    closeList();
    if (b.type === 'quote') out.push(`<blockquote><p${style}>${inner}</p></blockquote>`);
    else {
      const cls = state.first ? ' class="first"' : '';
      out.push(`<p${cls}${style}>${inner}</p>`);
      state.first = false;
    }
  }
  closeList();
  return out.join('\n');
}

function bodyHtml(nodes, selfClose = false, imgSrc = () => null) {
  const out = [];
  const state = { first: true };
  for (const n of nodes) {
    switch (n.t) {
      case 'image': {
        const src = imgSrc(n.ref);
        if (src) out.push(figureHtml(src, n.size, selfClose));
        state.first = true;
        break;
      }
      case 'title':
        out.push(`<section class="titlepage"><h1 class="book-title">${xml(n.title)}</h1>${n.author ? `<p class="book-author">${xml(n.author)}</p>` : ''}</section>`);
        break;
      case 'part':
        out.push(`<h1 class="part">${xml(n.text)}</h1>`);
        state.first = true;
        break;
      case 'chapter':
        out.push(`<h1 class="chapter">${n.label ? `<span class="ch-label">${xml(n.label)}</span>` : ''}${n.title ? `<span class="ch-title">${xml(n.title)}</span>` : ''}</h1>`);
        state.first = true;
        break;
      case 'h2':
        out.push(`<h2>${xml(n.text)}</h2>`);
        state.first = true;
        break;
      case 'h3':
        out.push(`<h3>${xml(n.text)}</h3>`);
        state.first = true;
        break;
      case 'q':
        out.push(`<p class="question">${xml(n.text)}</p>`);
        state.first = true;
        break;
      case 'meta':
        out.push(`<p class="meta">${xml(n.text)}</p>`);
        break;
      case 'sep':
        out.push(`<p class="sep">${n.text ? xml(n.text) : '&#160;'}</p>`);
        state.first = true;
        break;
      case 'html':
        out.push(blocksHtml(n.html, state, selfClose, imgSrc));
        break;
    }
  }
  return out.join('\n');
}

function bookCss(o, forPrint) {
  return `
body { font-family: 'Literata', Georgia, serif; font-size: ${forPrint ? '11.5pt' : '18px'}; line-height: 1.55; color: #1b1b1b; ${forPrint ? '' : 'max-width: 38em; margin: 3em auto; padding: 0 1.2em;'} }
p { margin: 0; text-align: ${forPrint ? 'justify' : 'left'}; hyphens: auto; ${o.indent ? 'text-indent: 1.5em;' : 'margin-bottom: 0.8em;'} }
p.first, p.question, p.meta, p.sep, blockquote p, li { text-indent: 0; }
.titlepage { text-align: center; padding-top: 30vh; ${forPrint ? 'break-after: page; page-break-after: always; padding-top: 70mm;' : 'margin-bottom: 6em;'} }
.book-title { font-size: 2.4em; font-weight: 600; margin: 0 0 0.4em; line-height: 1.15; }
.book-author { font-size: 1.2em; font-style: italic; text-indent: 0; text-align: center; }
h1.chapter, h1.part { text-align: center; font-weight: 600; margin: ${forPrint ? '30mm' : '3em'} 0 2em; line-height: 1.3; ${forPrint ? 'break-before: page; page-break-before: always;' : ''} }
h1.part { font-size: 1.8em; }
.ch-label { display: block; font-size: 0.75em; font-weight: 400; letter-spacing: 0.08em; margin-bottom: 0.4em; }
.ch-title { display: block; font-size: 1.15em; }
h2 { font-size: 1.25em; font-weight: 600; margin: 1.6em 0 0.6em; }
h3 { font-size: 1.05em; font-weight: 600; margin: 1.3em 0 0.4em; }
.question { font-weight: 600; font-size: 0.92em; margin-top: 0.9em; margin-bottom: 0.2em; }
.meta { font-style: italic; margin-bottom: 0.8em; }
.sep { text-align: center; margin: 1em 0; }
blockquote { margin: 0.8em 2em; font-style: italic; }
ul, ol { margin: 0.5em 0 0.8em 1.5em; padding: 0; }
.figure { text-align: center; text-indent: 0; margin: 1em 0; ${forPrint ? 'break-inside: avoid; page-break-inside: avoid;' : ''} }
.figure img { max-width: 100%; height: auto; ${forPrint ? 'max-height: 225mm;' : ''} }
.fig-medium img { max-width: 70%; }
.fig-small img { max-width: 40%; }
@page { size: A4; margin: 24mm 22mm 26mm; }
`;
}

/** Body HTML for the in-app reader (pictures linked from storage, no styles). */
export function readerHtml(doc) {
  const src = (ref) => (doc.o.images ? pictureSrc(ref, doc.pid) || null : null);
  return bodyHtml(doc.nodes, false, src);
}

/**
 * A standalone web page. Pictures are embedded in the file; for printing
 * (forPrint) they are linked from the app's storage instead, which is faster.
 */
export function toHtml(doc, { forPrint = false } = {}) {
  const lookup = imageLookup(doc);
  const imgSrc = (ref) => {
    const info = lookup(ref);
    if (!info) return null;
    if (forPrint || info.url.startsWith('data:')) return info.url;
    return `data:${info.mime};base64,${toBase64(info.bytes)}`;
  };
  return `<!doctype html>
<html lang="${xml(doc.language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xml(doc.title)}</title>
<style>${FONT_CSS}${bookCss(doc.o, forPrint)}</style></head>
<body>
${bodyHtml(doc.nodes, false, imgSrc)}
</body></html>`;
}

// ---------------------------------------------------------------- DOCX

function docxRuns(runs) {
  return mergeRuns(runs)
    .map((r) => {
      if (r.br) return '<w:r><w:br/></w:r>';
      let pr = '';
      if (r.b) pr += '<w:b/>';
      if (r.i) pr += '<w:i/>';
      if (r.s) pr += '<w:strike/>';
      if (r.u) pr += '<w:u w:val="single"/>';
      return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
    })
    .join('');
}

function docxPara(style, content, align) {
  const jc = align ? `<w:jc w:val="${align === 'justify' ? 'both' : align}"/>` : '';
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${jc}</w:pPr>${content}</w:p>`;
}

const textRun = (t) => `<w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;

// A4 with 2.5 cm margins: text block in EMU (1 twip = 635 EMU, 1 px at 96 dpi = 9525 EMU).
const TEXT_W_EMU = (11906 - 2 * 1418) * 635;
const MAX_H_EMU = Math.round((16838 - 2 * 1418) * 635 * 0.8);
const SIZE_FRACTION = { small: 0.4, medium: 0.7, full: 1 };

function drawingXml(rid, id, info, size) {
  let cx = Math.min(TEXT_W_EMU * (SIZE_FRACTION[size] || 1), info.w * 9525);
  let cy = (cx * info.h) / info.w;
  if (cy > MAX_H_EMU) {
    cx = (cx * MAX_H_EMU) / cy;
    cy = MAX_H_EMU;
  }
  cx = Math.round(cx);
  cy = Math.round(cy);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xml(info.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

export function toDocx(doc) {
  const o = doc.o;
  const body = [];
  let first = true;
  const lookup = imageLookup(doc);
  const media = new Map(); // ref -> { rid, file, info }
  let drawingId = 0;
  const picture = (ref, size) => {
    const info = lookup(ref);
    if (!info || !info.w || !info.h) return;
    let m = media.get(ref);
    if (!m) {
      const n = media.size + 1;
      m = { rid: `rIdImg${n}`, file: `media/image${n}.${info.ext}`, info };
      media.set(ref, m);
    }
    drawingId++;
    body.push(docxPara('Figure', drawingXml(m.rid, drawingId, info, size)));
    first = true;
  };
  doc.nodes.forEach((n, ni) => {
    switch (n.t) {
      case 'image':
        picture(n.ref, n.size);
        break;
      case 'title': {
        body.push(docxPara('Title', textRun(n.title)));
        if (n.author) body.push(docxPara('Subtitle', textRun(n.author)));
        const next = doc.nodes[ni + 1];
        // Heading 1 already starts a new page; only break explicitly before other content.
        if (next && next.t !== 'part' && next.t !== 'chapter') body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
      }
      case 'part':
        body.push(docxPara('Heading1', textRun(n.text)));
        first = true;
        break;
      case 'chapter':
        if (n.label && n.title) {
          body.push(docxPara('Heading1', textRun(n.label) + '<w:r><w:br/></w:r>' + textRun(n.title)));
        } else body.push(docxPara('Heading1', textRun(n.label || n.title || '')));
        first = true;
        break;
      case 'h2':
        body.push(docxPara('Heading2', textRun(n.text)));
        first = true;
        break;
      case 'h3':
        body.push(docxPara('Heading3', textRun(n.text)));
        first = true;
        break;
      case 'q':
        body.push(docxPara('Question', textRun(n.text)));
        first = true;
        break;
      case 'meta':
        body.push(docxPara('Meta', textRun(n.text)));
        break;
      case 'sep':
        body.push(docxPara('SceneBreak', n.text ? textRun(n.text) : ''));
        first = true;
        break;
      case 'html':
        for (const b of htmlToBlocks(n.html)) {
          if (b.type === 'img') {
            picture(b.ref, b.size);
            continue;
          }
          if (b.type === 'li') {
            const bullet = b.ordered ? `${b.index}.\t` : '•\t';
            body.push(docxPara('ListPara', textRun(bullet) + docxRuns(b.runs), b.align));
          } else if (b.type === 'quote') {
            body.push(docxPara('Quote', docxRuns(b.runs), b.align));
          } else {
            body.push(docxPara(first ? 'FirstPara' : 'BodyText', docxRuns(b.runs), b.align));
            first = false;
          }
        }
        break;
    }
  });

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const DRAW = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} ${DRAW}><w:body>${body.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/><w:titlePg w:val="${o.titlePage ? 1 : 0}"/></w:sectPr></w:body></w:document>`;

  const indent = o.indent ? '<w:ind w:firstLine="567"/>' : '';
  const spacing = o.indent ? '<w:spacing w:after="0" w:line="360" w:lineRule="auto"/>' : '<w:spacing w:after="160" w:line="360" w:lineRule="auto"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${xml(doc.language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${spacing}${indent}<w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FirstPara"><w:name w:val="First Paragraph"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:before="4000" w:after="400"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1800" w:after="600"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Question"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListPara"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Figure"><w:name w:val="Figure"/><w:basedOn w:val="Normal"/><w:next w:val="FirstPara"/><w:pPr><w:spacing w:before="200" w:after="200" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

  const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>${xml(doc.author)}</dc:creator><dc:language>${xml(doc.language)}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;

  const exts = new Map();
  for (const m of media.values()) exts.set(m.info.ext, m.info.mime);
  const imageTypes = [...exts.entries()].map(([ext, mime]) => `<Default Extension="${ext}" ContentType="${mime}"/>`).join('');
  const imageRels = [...media.values()]
    .map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.file}"/>`)
    .join('');

  return makeZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${imageRels}</Relationships>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/footer1.xml', data: footer },
    { name: 'docProps/core.xml', data: core },
    ...[...media.values()].map((m) => ({ name: `word/${m.file}`, data: m.info.bytes })),
  ]);
}

// ---------------------------------------------------------------- EPUB 3

export function toEpub(doc) {
  const id = 'urn:uuid:' + uidToUuid();
  const lang = doc.language || 'en';
  // Split into files at title page, parts and chapters.
  const files = [];
  let cur = null;
  const start = (label, kind) => {
    cur = { name: `text/s${String(files.length + 1).padStart(3, '0')}.xhtml`, label, kind, nodes: [] };
    files.push(cur);
  };
  for (const n of doc.nodes) {
    if (n.t === 'title') start(doc.title, 'title');
    else if (n.t === 'part') start(n.text, 'part');
    else if (n.t === 'chapter') start(chapterHeadingText(n) || 'Chapter', 'chapter');
    else if (!cur) start(doc.title, 'section');
    cur.nodes.push(n);
  }
  if (!files.length) {
    start(doc.title, 'title');
    cur.nodes.push({ t: 'title', title: doc.title, author: doc.author });
  }
  const lookup = imageLookup(doc);
  const pictures = new Map(); // name -> info
  const imgSrc = (ref) => {
    const info = lookup(ref);
    if (!info) return null;
    pictures.set(info.name, info);
    return `../images/${info.name}`;
  };
  const xhtml = (f) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xml(lang)}" lang="${xml(lang)}">
<head><meta charset="utf-8"/><title>${xml(f.label)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${bodyHtml(f.nodes, true, imgSrc)}
</body></html>`;
  // Render the chapters first so the pictures they use are known for the manifest.
  const pages = files.map((f) => ({ name: 'OEBPS/' + f.name, data: xhtml(f) }));
  const pictureList = [...pictures.values()];

  const css = bookCss(doc.o, false)
    .replace(/max-width:[^;]+;|margin: 3em auto;|padding: 0 1\.2em;/g, '')
    .replace(/font-family:[^;]+;/, 'font-family: serif;')
    .replace('padding-top: 30vh;', 'padding-top: 20%;');

  const navItems = files.filter((f) => f.kind !== 'section').map((f) => `<li><a href="${f.name}">${xml(f.label)}</a></li>`).join('\n');
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xml(lang)}" lang="${xml(lang)}">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${navItems || `<li><a href="${files[0] ? files[0].name : 'text/s001.xhtml'}">${xml(doc.title)}</a></li>`}
</ol></nav></body></html>`;

  const ncxPoints = files.map((f, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xml(f.label)}</text></navLabel><content src="${f.name}"/></navPoint>`).join('');
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${xml(doc.title)}</text></docTitle><navMap>${ncxPoints}</navMap></ncx>`;

  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${xml(doc.title)}</dc:title>
${doc.author ? `<dc:creator>${xml(doc.author)}</dc:creator>` : ''}
<dc:language>${xml(lang)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${files.map((f, i) => `<item id="f${i + 1}" href="${f.name}" media-type="application/xhtml+xml"/>`).join('\n')}
${pictureList.map((info, i) => `<item id="img${i + 1}" href="images/${info.name}" media-type="${info.mime}"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${files.map((f, i) => `<itemref idref="f${i + 1}"/>`).join('\n')}
</spine>
</package>`;

  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: css },
    ...pages,
    ...pictureList.map((info) => ({ name: `OEBPS/images/${info.name}`, data: info.bytes })),
  ]);
}

function uidToUuid() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
