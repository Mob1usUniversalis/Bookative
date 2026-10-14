// Pictures inside rich-text fields: inserting from the picker or clipboard,
// pasting and dropping, the tap menu (size, save, remove), and the conversion
// between what the editor shows (<img src=…>) and what is stored
// (<img data-img="NAME" data-size="…">).
import { h, uid } from './util.js';
import {
  imageUrl, resolveSource, hasImage, SIZES, TRANSPARENT, readImageBytes, mimeOf, clipboardHasImage,
} from './images.js';
import { actionSheet, toast } from './ui.js';
import { saveFile } from './platform.js';
import { sanitizeHtml, textToHtml, htmlToText } from './text.js';

const IMG_TAG = /<img\b[^>]*>/gi;
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/** Editor HTML → stored HTML: pictures keep only their name and size. */
export function canonicalHtml(html) {
  if (!html || html.indexOf('<img') < 0) return html;
  return html.replace(IMG_TAG, (tag) => {
    const name = attr(tag, 'data-img');
    if (!name) return '';
    const size = attr(tag, 'data-size');
    return `<img data-img="${name}"${size && size !== 'full' && SIZES.includes(size) ? ` data-size="${size}"` : ''}>`;
  });
}

/** Stored HTML → editor HTML: adds a displayable src to every picture. */
export function withSrc(html, pid) {
  if (!html || html.indexOf('<img') < 0) return html || '';
  return html.replace(IMG_TAG, (tag) => {
    const name = attr(tag, 'data-img');
    if (!name) return '';
    const size = attr(tag, 'data-size');
    return `<img src="${imageUrl(name, pid)}" alt="" data-img="${name}"${size ? ` data-size="${size}"` : ''}>`;
  });
}

// ---------------------------------------------------------------- DOM helpers

const hasContent = (n) => !!(n && (n.nodeName === 'IMG' || (n.textContent || '').trim() || (n.querySelector && n.querySelector('img'))));

function placeholder(token, size) {
  const img = document.createElement('img');
  img.src = TRANSPARENT;
  img.alt = '';
  img.setAttribute('data-pending', token);
  if (size && size !== 'full') img.setAttribute('data-size', size);
  return img;
}

function pruneEmptyInline(block) {
  const els = Array.from(block.querySelectorAll('b,i,u,s,strong,em,span,strike')).reverse();
  for (const e of els) if (!hasContent(e) && !e.querySelector('br')) e.remove();
}

/** Moves a picture into a paragraph of its own (splitting the text around it). Returns that paragraph. */
function isolate(img, root) {
  let block = img.parentNode;
  while (block && block !== root && !(block.nodeType === 1 && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(block.tagName))) {
    block = block.parentNode;
  }
  if (!block) return null;
  if (block.tagName === 'LI') return block;
  if (block === root || block.tagName === 'BLOCKQUOTE') {
    let top = img;
    while (top.parentNode !== block) top = top.parentNode;
    const p = document.createElement('p');
    block.insertBefore(p, top);
    p.appendChild(img);
    if (top !== img && !hasContent(top)) top.remove();
    return p;
  }
  const others = Array.from(block.querySelectorAll('img')).filter((x) => x !== img);
  if (!others.length && !block.textContent.trim()) {
    block.querySelectorAll('br').forEach((br) => br.remove());
    return block;
  }
  const tailRange = document.createRange();
  tailRange.setStartAfter(img);
  tailRange.setEnd(block, block.childNodes.length);
  const tail = tailRange.extractContents();
  img.remove();
  pruneEmptyInline(block);
  const imgP = document.createElement('p');
  imgP.appendChild(img);
  block.after(imgP);
  if (hasContent(tail)) {
    const np = document.createElement('p');
    if (block.style && block.style.textAlign) np.style.textAlign = block.style.textAlign;
    np.appendChild(tail);
    imgP.after(np);
  }
  if (!hasContent(block)) block.remove();
  return imgP;
}

/** Removes a picture (and its paragraph if that becomes empty); returns an undo function. */
function removeImg(img) {
  const block = img.closest('p');
  if (block && block.parentNode && !block.textContent.trim() && block.querySelectorAll('img').length === 1) {
    const parent = block.parentNode;
    const next = block.nextSibling;
    block.remove();
    return () => parent.insertBefore(block, next && next.parentNode === parent ? next : null);
  }
  const parent = img.parentNode;
  const next = img.nextSibling;
  img.remove();
  return () => parent && parent.insertBefore(img, next && next.parentNode === parent ? next : null);
}

function paragraphAfter(p, root) {
  let next = p.nextElementSibling;
  if (!next || next.querySelector('img') || next.tagName !== 'P') {
    next = document.createElement('p');
    next.appendChild(document.createElement('br'));
    p.after(next);
  }
  return next;
}

function insertNodesAt(root, range, nodes) {
  let r = range && root.contains(range.commonAncestorContainer) ? range : null;
  if (!r) {
    r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(false);
  }
  if (!r.collapsed) r.deleteContents();
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => frag.appendChild(n));
  r.insertNode(frag);
  let last = null;
  for (const n of nodes) last = isolate(n, root) || last;
  return last;
}

// ---------------------------------------------------------------- inserting

async function resolveAll(api, items) {
  let failed = 0;
  let message = '';
  for (const it of items) {
    const find = () => api.el.querySelector(`img[data-pending="${it.token}"]`);
    try {
      const r = await resolveSource(it.source);
      const img = find();
      if (!img) continue;
      img.removeAttribute('data-pending');
      img.setAttribute('data-img', r.name);
      img.src = imageUrl(r.name);
      isolate(img, api.el);
    } catch (e) {
      const img = find();
      if (img) removeImg(img);
      if (!e.quiet) {
        failed++;
        message = e.message || '';
      }
    }
    api.changed();
  }
  if (failed === 1) toast(`An image couldn’t be added. ${message}`.trim());
  else if (failed > 1) toast(`${failed} images couldn’t be added. ${message}`.trim());
}

/** Inserts pictures at `range` (or at the end of the field). sources: see images.resolveSource. */
export function insertImages(api, sources, range) {
  if (!sources.length) return Promise.resolve();
  const items = sources.map((source) => ({ token: 'i' + uid(), source }));
  const last = insertNodesAt(api.el, range, items.map((it) => placeholder(it.token, it.source.size)));
  if (last && last.tagName === 'P') {
    const next = paragraphAfter(last, api.el);
    if (document.activeElement === api.el) window.getSelection().collapse(next, 0);
  }
  api.changed();
  return resolveAll(api, items);
}

function sourceForImg(img) {
  const size = SIZES.includes(img.getAttribute('data-size')) ? img.getAttribute('data-size') : undefined;
  const name = img.getAttribute('data-img');
  if (name && hasImage(name)) return { reuse: name, size };
  const w = Number(img.getAttribute('width'));
  const ht = Number(img.getAttribute('height'));
  if (w && ht && w * ht <= 4) return null;
  const abs = (u) => (u && /^(https?:|data:image\/|blob:|content:|file:)/i.test(u.trim()) ? u.trim() : null);
  const src = abs(img.getAttribute('src'));
  const lazy = abs(img.getAttribute('data-src')) || abs(img.getAttribute('data-original'));
  const set = (img.getAttribute('srcset') || '').split(',').map((x) => abs(x.trim().split(/\s+/)[0])).filter(Boolean);
  // Lazy-loading pages put a tiny data: placeholder in src and the real picture in data-src.
  const url = (lazy && (!src || src.startsWith('data:')) ? lazy : src) || lazy || set[set.length - 1] || null;
  return url ? { url, size } : null;
}

export function handlePaste(e, api) {
  const cd = e.clipboardData;
  if (!cd) return;
  e.preventDefault();
  const files = Array.from(cd.items || [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (!files.length && cd.files) for (const f of Array.from(cd.files)) if (f.type.startsWith('image/')) files.push(f);
  const rawHtml = cd.getData('text/html');
  const plain = cd.getData('text/plain') || '';
  const sel = window.getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  const htmlHasText = rawHtml ? !!htmlToText(rawHtml).trim() : false;

  if (files.length && !htmlHasText) {
    insertImages(api, files.map((file) => ({ file })), range);
    return;
  }
  // An image copied in another Android app often reaches the page as a bare
  // content:// address (or nothing); the native clipboard has the real picture.
  if (!files.length && !htmlHasText && (!plain.trim() || /^(content|file):\/\/\S+$/.test(plain.trim())) && clipboardHasImage()) {
    insertImages(api, [{ clipboard: true }], range);
    return;
  }
  if (rawHtml) {
    const items = [];
    let out = sanitizeHtml(rawHtml, (img) => {
      const source = sourceForImg(img);
      if (!source) return null;
      const token = 'i' + uid();
      items.push({ token, source });
      return placeholder(token, source.size);
    });
    if (!items.length && files.length) {
      for (const file of files) {
        const token = 'i' + uid();
        items.push({ token, source: { file } });
        out += `<p>${placeholder(token).outerHTML}</p>`;
      }
    }
    const single = out.match(/^<p>([\s\S]*)<\/p>$/);
    if (single && !single[1].includes('<p') && !items.length) out = single[1];
    if (out) document.execCommand('insertHTML', false, out);
    if (items.length) {
      for (const it of items) {
        const img = api.el.querySelector(`img[data-pending="${it.token}"]`);
        if (img) isolate(img, api.el);
      }
      api.changed();
      resolveAll(api, items);
    }
    return;
  }
  let out = textToHtml(plain);
  const single = out.match(/^<p>([\s\S]*)<\/p>$/);
  if (single && !single[1].includes('<p')) out = single[1];
  if (out) document.execCommand('insertHTML', false, out);
}

export function handleDragOver(e) {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
}

export function handleDrop(e, api) {
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  insertImages(api, files.map((file) => ({ file })), range);
}

// ---------------------------------------------------------------- tap menu

const spacer = () => h('span', { class: 'sheet-spacer' });

export async function imageMenu(img, api) {
  const name = img.getAttribute('data-img');
  if (!name) return;
  const size = img.getAttribute('data-size') || 'full';
  const k = await actionSheet({
    title: 'Image',
    items: [
      { key: 'small', label: 'Small', lead: spacer(), checked: size === 'small' },
      { key: 'medium', label: 'Medium', lead: spacer(), checked: size === 'medium' },
      { key: 'full', label: 'Full width', lead: spacer(), checked: size === 'full' },
      { key: 'save', label: 'Save a copy to the phone', icon: 'download' },
      { key: 'remove', label: 'Remove image', icon: 'trash', danger: true },
    ],
  });
  if (!k) return;
  if (SIZES.includes(k)) {
    if (k === 'full') img.removeAttribute('data-size');
    else img.setAttribute('data-size', k);
    api.changed();
  } else if (k === 'remove') {
    const undo = removeImg(img);
    api.changed();
    toast('Image removed', {
      action: 'Undo',
      onAction: () => {
        undo();
        api.changed();
      },
    });
  } else if (k === 'save') {
    const bytes = readImageBytes(name);
    if (!bytes) {
      toast('The image file is missing');
      return;
    }
    const res = await saveFile(name, mimeOf(name), bytes);
    if (res.ok) toast('Image saved');
    else if (res.message !== 'cancelled') toast(`Not saved: ${res.message}`);
  }
}
