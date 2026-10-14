// Rich text fields (contenteditable) and the single formatting bar that
// docks above the keyboard whenever one of them has focus.
import { h, icon, debounce } from './util.js';
import { getSettings } from './store.js';
import { pickFiles } from './platform.js';
import { clipboardHasImage } from './images.js';
import { actionSheet } from './ui.js';
import {
  canonicalHtml, withSrc, insertImages, handlePaste, handleDrop, handleDragOver, imageMenu,
} from './imgedit.js';

const live = new Set();
const apis = new WeakMap();

export function flushAllFields() {
  for (const f of live) f.flush();
}

export function releaseFields() {
  for (const f of live) f.flush();
  live.clear();
}

/**
 * richField({ html, placeholder, onChange(html), lang, className })
 * Returns { el, flush, getHtml, setHtml, focus }.
 */
export function richField({ html = '', placeholder = '', onChange, lang, className = '', onInput }) {
  const s = getSettings();
  const el = h('div', {
    class: `prose ${className}`,
    contenteditable: 'true',
    spellcheck: s.spell ? 'true' : 'false',
    lang: lang || null,
    role: 'textbox',
    'aria-multiline': 'true',
    autocapitalize: 'sentences',
    'data-placeholder': placeholder,
  });
  el.innerHTML = withSrc(html);
  let lastHtml = html || '';

  const getHtml = () => {
    if (!el.textContent.trim() && !el.querySelector('img[data-img]')) return '';
    return canonicalHtml(el.innerHTML);
  };
  const updateEmpty = () => el.classList.toggle('is-empty', !el.textContent.trim() && !el.querySelector('li, img'));
  const commit = () => {
    const v = getHtml();
    if (v !== lastHtml) {
      lastHtml = v;
      onChange && onChange(v);
    }
  };
  const save = debounce(commit, 450);

  function ensureBlock() {
    if (!el.firstChild || el.innerHTML === '<br>') {
      el.innerHTML = '<p><br></p>';
      const sel = window.getSelection();
      if (document.activeElement === el) sel.collapse(el.firstChild, 0);
      return;
    }
    // Wrap stray top-level text/inline nodes in a paragraph (keeps the caret).
    const stray = Array.from(el.childNodes).filter(
      (n) => (n.nodeType === 3 && n.nodeValue.trim()) || (n.nodeType === 1 && /^(B|I|U|S|STRIKE|SPAN|STRONG|EM|IMG)$/.test(n.tagName)));
    if (!stray.length) return;
    const sel = window.getSelection();
    const node = sel.anchorNode;
    const off = sel.anchorOffset;
    let group = [];
    const wrapGroup = () => {
      if (!group.length) return;
      const p = document.createElement('p');
      el.insertBefore(p, group[0]);
      for (const n of group) p.appendChild(n);
      group = [];
    };
    for (const n of Array.from(el.childNodes)) {
      const inline = n.nodeType === 3 || (n.nodeType === 1 && /^(B|I|U|S|STRIKE|SPAN|STRONG|EM|BR|IMG)$/.test(n.tagName));
      if (inline) group.push(n);
      else wrapGroup();
    }
    wrapGroup();
    try { if (node && el.contains(node)) sel.collapse(node, off); } catch { /* ignore */ }
  }

  el.addEventListener('focus', () => {
    ensureBlock();
    updateEmpty();
  });
  el.addEventListener('input', () => {
    ensureBlock();
    updateEmpty();
    onInput && onInput();
    save();
    keepCaretVisible(el);
  });
  el.addEventListener('blur', () => save.flush());
  el.addEventListener('paste', (e) => handlePaste(e, api));
  el.addEventListener('dragover', handleDragOver);
  el.addEventListener('drop', (e) => handleDrop(e, api));
  el.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img[data-img]');
    if (img && el.contains(img)) {
      e.preventDefault();
      imageMenu(img, api);
    }
  });
  el.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      save.flush();
    }
  });
  updateEmpty();

  const api = {
    el,
    flush: () => save.flush(),
    getHtml,
    setHtml(v) {
      el.innerHTML = withSrc(v);
      lastHtml = v || '';
      updateEmpty();
    },
    /** Called after programmatic changes (pictures added, resized or removed). */
    changed() {
      updateEmpty();
      onInput && onInput();
      save();
    },
    focus() {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    },
  };
  live.add(api);
  apis.set(el, api);
  return api;
}

function scrollParent(el) {
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
    p = p.parentElement;
  }
  return document.scrollingElement;
}

function keepCaretVisible(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0).cloneRange();
  let rect = r.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0)) {
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!node) return;
    rect = node.getBoundingClientRect();
  }
  const barH = bar && bar.classList.contains('open') ? bar.offsetHeight : 0;
  const limit = window.innerHeight - barH - 24;
  if (rect.bottom > limit) {
    const sp = scrollParent(el);
    sp.scrollTop += rect.bottom - limit;
  }
}

// ---------------------------------------------------------------- format bar

let bar = null;
let alignBtn = null;
const buttons = {};
const ALIGN_CYCLE = [
  ['justifyLeft', 'alignLeft'],
  ['justifyCenter', 'alignCenter'],
  ['justifyRight', 'alignRight'],
  ['justifyFull', 'alignJustify'],
];

function activeProse() {
  const a = document.activeElement;
  return a && a.classList && a.classList.contains('prose') && a.isContentEditable ? a : null;
}

function exec(cmd, val = null) {
  document.execCommand(cmd, false, val);
  const p = activeProse();
  if (p) p.dispatchEvent(new Event('input', { bubbles: true }));
  refresh();
}

function currentBlock() {
  try { return (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch { return ''; }
}

function refresh() {
  if (!bar) return;
  const st = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
  for (const c of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
    buttons[c]?.classList.toggle('is-on', st(c));
  }
  buttons.quote?.classList.toggle('is-on', currentBlock() === 'blockquote');
  let ai = 0;
  ALIGN_CYCLE.forEach(([c], i) => { if (st(c)) ai = i; });
  if (alignBtn) {
    alignBtn.dataset.idx = ai;
    alignBtn.replaceChildren(icon(ALIGN_CYCLE[ai][1], 20));
  }
}

function tool(name, label, onPress) {
  const b = h('button', { class: 'fmt-btn', type: 'button', 'aria-label': label, title: label }, icon(name, 20));
  // pointerdown keeps focus (and the selection) inside the editor
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onPress);
  return b;
}

export function installFormatBar() {
  if (bar) return;
  document.execCommand('defaultParagraphSeparator', false, 'p');
  buttons.bold = tool('bold', 'Bold', () => exec('bold'));
  buttons.italic = tool('italic', 'Italic', () => exec('italic'));
  buttons.underline = tool('underline', 'Underline', () => exec('underline'));
  buttons.strikeThrough = tool('strike', 'Strikethrough', () => exec('strikeThrough'));
  buttons.insertUnorderedList = tool('ul', 'Bulleted list', () => exec('insertUnorderedList'));
  buttons.insertOrderedList = tool('ol', 'Numbered list', () => exec('insertOrderedList'));
  buttons.quote = tool('quote', 'Quotation', () => exec('formatBlock', currentBlock() === 'blockquote' ? 'p' : 'blockquote'));
  alignBtn = tool('alignLeft', 'Alignment', () => {
    const i = (Number(alignBtn.dataset.idx || 0) + 1) % ALIGN_CYCLE.length;
    exec(ALIGN_CYCLE[i][0]);
  });
  const imageBtn = tool('imageAdd', 'Insert image', async () => {
    const el = activeProse();
    const api = el && apis.get(el);
    if (!api) return;
    const sel = window.getSelection();
    const range = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    let choice = 'pick';
    if (clipboardHasImage()) {
      choice = await actionSheet({
        title: 'Insert image',
        items: [
          { key: 'pick', label: 'Choose from gallery or files', icon: 'image' },
          { key: 'clip', label: 'Paste the copied image', icon: 'clipboard' },
        ],
      });
    }
    if (choice === 'pick') {
      const files = await pickFiles('image/*', true);
      if (files.length) insertImages(api, files.map((file) => ({ file })), range);
    } else if (choice === 'clip') {
      insertImages(api, [{ clipboard: true }], range);
    }
  });
  const undo = tool('undo', 'Undo', () => exec('undo'));
  const redo = tool('redo', 'Redo', () => exec('redo'));
  const done = h('button', { class: 'fmt-done', type: 'button' }, icon('check', 20), h('span', null, 'Done'));
  done.addEventListener('pointerdown', (e) => e.preventDefault());
  done.addEventListener('click', () => {
    const p = activeProse();
    if (p) p.blur();
    window.getSelection().removeAllRanges();
    hide();
  });

  bar = h('div', { class: 'formatbar', role: 'toolbar', 'aria-label': 'Formatting' },
    h('div', { class: 'formatbar-scroll' },
      buttons.bold, buttons.italic, buttons.underline, buttons.strikeThrough,
      h('span', { class: 'fmt-sep' }),
      imageBtn,
      h('span', { class: 'fmt-sep' }),
      buttons.insertUnorderedList, buttons.insertOrderedList, buttons.quote, alignBtn,
      h('span', { class: 'fmt-sep' }),
      undo, redo),
    done);
  document.body.appendChild(bar);

  let hideTimer = null;
  function show() {
    clearTimeout(hideTimer);
    if (document.body.classList.contains('focus-mode') && document.body.classList.contains('focus-hide-bar')) return;
    bar.classList.add('open');
    document.body.classList.add('has-formatbar');
    refresh();
  }
  function hide() {
    bar.classList.remove('open');
    document.body.classList.remove('has-formatbar');
  }
  document.addEventListener('focusin', () => { if (activeProse()) show(); });
  document.addEventListener('focusout', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!activeProse()) hide(); }, 120);
  });
  document.addEventListener('selectionchange', () => { if (bar.classList.contains('open')) refresh(); });
}
