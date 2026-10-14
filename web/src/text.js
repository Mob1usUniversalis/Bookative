// Rich-text helpers: sanitising pasted HTML, counting words, and turning
// editor HTML into a neutral block/run structure used by every exporter.

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'SECTION', 'ARTICLE']);
const INLINE_MAP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's' };
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);

function parse(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  return t.content;
}

function alignOf(el) {
  const a = (el.style && el.style.textAlign) || el.getAttribute?.('align') || '';
  return ALIGNS.has(a) ? a : '';
}

const hasMedia = (el) => !!el.querySelector('img');

/**
 * Reduces arbitrary HTML (e.g. pasted from a browser or Google Docs) to the
 * small vocabulary the editor understands: p, br, b, i, u, s, ul, ol, li,
 * blockquote and img. Each <img> is passed to `onImage(img)`, which returns
 * the element to put in its place (or null to leave the picture out).
 */
export function sanitizeHtml(html, onImage = null) {
  const src = parse(html);
  const out = document.createElement('div');

  function walkInline(node, parent) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parent.appendChild(document.createTextNode(child.nodeValue.replace(/\s+/g, ' ')));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'TITLE' || tag === 'SOURCE') continue;
      if (tag === 'IMG') {
        const replacement = onImage ? onImage(child) : null;
        if (replacement) parent.appendChild(replacement);
        continue;
      }
      if (tag === 'BR') {
        parent.appendChild(document.createElement('br'));
        continue;
      }
      let target = parent;
      const wrap = [];
      if (INLINE_MAP[tag]) wrap.push(INLINE_MAP[tag]);
      const st = child.style;
      if (st) {
        const fw = st.fontWeight;
        if ((fw === 'bold' || Number(fw) >= 600) && tag !== 'B' && tag !== 'STRONG') wrap.push('b');
        if (st.fontStyle === 'italic' && !INLINE_MAP[tag]) wrap.push('i');
        const td = st.textDecoration || st.textDecorationLine || '';
        if (td.includes('underline')) wrap.push('u');
        if (td.includes('line-through')) wrap.push('s');
        if (fw === 'normal' || fw === '400') {
          // Google Docs wraps everything in <b style="font-weight:normal">
          const i = wrap.indexOf('b');
          if (i >= 0) wrap.splice(i, 1);
        }
      }
      for (const w of wrap) {
        const e = document.createElement(w);
        target.appendChild(e);
        target = e;
      }
      if (BLOCK_TAGS.has(tag) || tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'TR') {
        // nested blocks inside inline context: flatten with a line break
        walkInline(child, target);
        target.appendChild(document.createElement('br'));
      } else {
        walkInline(child, target);
      }
    }
  }

  let current = null;
  const flush = () => {
    if (current && (current.textContent.trim() || current.querySelector('br, img'))) {
      if (!current.textContent.trim() && !hasMedia(current)) current.innerHTML = '<br>';
      out.appendChild(current);
    }
    current = null;
  };
  const para = () => {
    if (!current) current = document.createElement('p');
    return current;
  };

  function walkBlocks(node, container) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        if (child.nodeValue.trim()) walkInline({ childNodes: [child] }, para());
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'TITLE' || tag === 'HEAD') continue;
      if (tag === 'UL' || tag === 'OL') {
        flush();
        const list = document.createElement(tag.toLowerCase());
        for (const li of Array.from(child.children)) {
          if (li.tagName !== 'LI') continue;
          const item = document.createElement('li');
          const a = alignOf(li);
          if (a) item.style.textAlign = a;
          walkInline(li, item);
          trimBr(item);
          if (item.textContent.trim() || hasMedia(item)) list.appendChild(item);
        }
        if (list.children.length) (container || out).appendChild(list);
        continue;
      }
      if (tag === 'BLOCKQUOTE') {
        flush();
        const q = document.createElement('blockquote');
        const inner = parse('');
        walkInline(child, inner);
        // split on <br><br> into paragraphs
        const p = document.createElement('p');
        p.appendChild(inner);
        trimBr(p);
        if (p.textContent.trim() || hasMedia(p)) {
          q.appendChild(p);
          out.appendChild(q);
        }
        continue;
      }
      if (BLOCK_TAGS.has(tag) || tag === 'TABLE' || tag === 'TR' || tag === 'TD' || tag === 'TH' || tag === 'TBODY') {
        const hasBlockChildren = Array.from(child.children).some(
          (c) => BLOCK_TAGS.has(c.tagName) || c.tagName === 'UL' || c.tagName === 'OL' || c.tagName === 'TABLE' || c.tagName === 'TR');
        if (hasBlockChildren) {
          flush();
          walkBlocks(child);
          flush();
          continue;
        }
        flush();
        const p = para();
        const a = alignOf(child);
        if (a) p.style.textAlign = a;
        let target = p;
        if (/^H[1-6]$/.test(tag)) {
          target = document.createElement('b');
          p.appendChild(target);
        }
        walkInline(child, target);
        trimBr(p);
        flush();
        continue;
      }
      walkInline({ childNodes: [child] }, para());
    }
  }

  walkBlocks(src);
  flush();
  return out.innerHTML;
}

function trimBr(el) {
  while (el.lastChild && el.lastChild.nodeName === 'BR' && el.childNodes.length > 1) el.removeChild(el.lastChild);
}

export function textToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n/);
  return paras.map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '')).join('');
}

const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;

export function htmlToText(html) {
  if (!html) return '';
  tpl.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n');
  return tpl.content.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function countWords(htmlOrText, isText = false) {
  const t = isText ? htmlOrText : htmlToText(htmlOrText);
  if (!t) return 0;
  const m = t.match(WORD_RE);
  return m ? m.length : 0;
}

export function countChars(html) {
  return htmlToText(html).replace(/\n/g, '').length;
}

export function excerpt(html, n = 140) {
  const t = htmlToText(html).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

export function isEmptyHtml(html) {
  return !htmlToText(html || '').trim() && !/<img\b/i.test(html || '');
}

export const hasImages = (html) => /<img\b[^>]*data-img=/i.test(html || '');

/**
 * Converts editor HTML to blocks:
 *   [{ type: 'p'|'li'|'quote', ordered, index, align, runs: [{ text, b, i, u, s, br }] }
 *    | { type: 'img', ref, size }]
 * A picture inside a paragraph splits it, so images always stand on their own.
 */
export function htmlToBlocks(html) {
  const root = parse(html);
  const blocks = [];

  function push(base, runs) {
    let part = [];
    const flushPart = () => {
      const r = clean(part);
      if (r.length) blocks.push({ ...base, runs: r });
      part = [];
    };
    for (const r of runs) {
      if (r.img) {
        flushPart();
        blocks.push({ type: 'img', ref: r.img, size: r.size || 'full' });
      } else part.push(r);
    }
    flushPart();
  }

  function runsOf(node, fmt, runs) {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) {
        const text = c.nodeValue.replace(/ /g, ' ');
        if (text) runs.push({ text, ...fmt });
      } else if (c.nodeType === 1) {
        const tag = c.tagName;
        if (tag === 'BR') {
          runs.push({ br: true });
          continue;
        }
        if (tag === 'IMG') {
          const ref = c.getAttribute('data-img');
          if (ref) runs.push({ img: ref, size: c.getAttribute('data-size') || 'full' });
          continue;
        }
        const f = { ...fmt };
        const m = INLINE_MAP[tag];
        if (m) f[m] = true;
        const st = c.style;
        if (st) {
          if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) f.b = true;
          if (st.fontStyle === 'italic') f.i = true;
          const td = st.textDecoration || st.textDecorationLine || '';
          if (td.includes('underline')) f.u = true;
          if (td.includes('line-through')) f.s = true;
        }
        runsOf(c, f, runs);
      }
    }
    return runs;
  }

  function clean(runs) {
    // collapse whitespace like a browser would, drop trailing <br>
    const out = [];
    for (const r of runs) {
      if (r.br) { out.push(r); continue; }
      const t = r.text.replace(/[ \t\n\r]+/g, ' ');
      out.push({ ...r, text: t });
    }
    while (out.length && out[out.length - 1].br) out.pop();
    while (out.length && out[0].br) out.shift();
    if (out.length && !out[0].br) out[0].text = out[0].text.replace(/^ +/, '');
    if (out.length && !out[out.length - 1].br) out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '');
    return out.filter((r) => r.br || r.text);
  }

  function walk(node, ctx) {
    let loose = [];
    const flushLoose = () => {
      push({ type: ctx.quote ? 'quote' : 'p', align: '' }, loose);
      loose = [];
    };
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
        flushLoose();
        let idx = 0;
        for (const li of Array.from(c.children)) {
          if (li.tagName !== 'LI') continue;
          idx++;
          push({ type: 'li', ordered: c.tagName === 'OL', index: idx, align: alignOf(li) }, runsOf(li, {}, []));
        }
      } else if (c.nodeType === 1 && c.tagName === 'BLOCKQUOTE') {
        flushLoose();
        walk(c, { quote: true });
      } else if (c.nodeType === 1 && BLOCK_TAGS.has(c.tagName)) {
        flushLoose();
        const hasBlocks = Array.from(c.children).some((x) => BLOCK_TAGS.has(x.tagName) || x.tagName === 'UL' || x.tagName === 'OL' || x.tagName === 'BLOCKQUOTE');
        if (hasBlocks) { walk(c, ctx); continue; }
        push({ type: ctx.quote ? 'quote' : 'p', align: alignOf(c) }, runsOf(c, /^H[1-6]$/.test(c.tagName) ? { b: true } : {}, []));
      } else if (c.nodeType === 3 || c.nodeType === 1) {
        if (c.nodeType === 3) loose.push({ text: c.nodeValue });
        else runsOf({ childNodes: [c] }, {}, loose);
      }
    }
    flushLoose();
  }

  walk(root, {});
  return blocks;
}
