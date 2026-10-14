// Shared UI building blocks: screen scaffold, rows, status chips,
// dialogs, bottom sheets and toasts.
import { h, icon, initials } from './util.js';
import { STATUS_LABEL } from './model.js';
import { touch, onSaveState } from './store.js';
import { imgSrc } from './images.js';

// ---------------------------------------------------------------- overlays

const overlays = [];

export function closeTopOverlay() {
  const o = overlays[overlays.length - 1];
  if (!o) return false;
  o.close();
  return true;
}

export function hasOverlay() {
  return overlays.length > 0;
}

function openLayer(kind, build, { modal = false, onOpen, onDismiss } = {}) {
  return new Promise((resolve) => {
    let closed = false;
    // A modal layer (e.g. progress) ignores the back button and taps outside it;
    // onDismiss(close) lets a layer confirm before it is dismissed.
    const dismiss = () => {
      if (modal) return;
      if (onDismiss) onDismiss(close);
      else close(undefined);
    };
    const entry = { close: dismiss };
    const scrim = h('div', { class: 'scrim', onclick: dismiss });
    const panel = build(close);
    panel.classList.add('panel');
    const layer = h('div', { class: `layer layer-${kind}`, role: 'dialog', 'aria-modal': 'true' }, scrim, panel);
    function close(result) {
      if (closed) return;
      closed = true;
      const i = overlays.indexOf(entry);
      if (i >= 0) overlays.splice(i, 1);
      layer.classList.remove('open');
      setTimeout(() => layer.remove(), 220);
      resolve(result);
    }
    overlays.push(entry);
    document.body.appendChild(layer);
    if (onOpen) onOpen(close);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
    const first = panel.querySelector('[autofocus]');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 60);
  });
}

function dialogButtons(buttons) {
  return h('div', { class: 'dialog-actions' }, buttons);
}

export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return openLayer('dialog', (close) =>
    h('div', { class: 'dialog' },
      title && h('h2', { class: 'dialog-title' }, title),
      message && h('p', { class: 'dialog-text' }, message),
      dialogButtons([
        h('button', { class: 'btn btn-text', onclick: () => close(false) }, cancelLabel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, okLabel),
      ]))).then((r) => !!r);
}

export function promptDialog({ title, label, value = '', placeholder = '', okLabel = 'Save', multiline = false }) {
  return formDialog({
    title,
    okLabel,
    fields: [{ key: 'v', label, value, placeholder, type: multiline ? 'textarea' : 'text', autofocus: true }],
  }).then((r) => (r ? r.v : null));
}

/**
 * fields: [{ key, label, type: text|textarea|number|date|datetime|select, value, options: [[v, label]], placeholder, hint }]
 */
export function formDialog({ title, fields, okLabel = 'Save', cancelLabel = 'Cancel', extra }) {
  return openLayer('dialog', (close) => {
    const inputs = {};
    const submit = (e) => {
      e && e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = inputs[f.key];
        out[f.key] = f.type === 'number' ? Number(el.value || 0) : f.type === 'checkbox' ? el.checked : el.value.trim();
      }
      close(out);
    };
    const body = fields.map((f) => {
      let input;
      const common = { id: 'f-' + f.key, placeholder: f.placeholder || '', autofocus: !!f.autofocus };
      if (f.type === 'textarea') input = h('textarea', { ...common, rows: 4, class: 'field-input' }, f.value || '');
      else if (f.type === 'select') {
        input = h('select', { ...common, class: 'field-input' },
          f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
      } else if (f.type === 'checkbox') {
        input = h('input', { ...common, type: 'checkbox', checked: !!f.value });
        inputs[f.key] = input;
        return h('label', { class: 'field field-check' }, input, h('span', null, f.label));
      } else {
        const type = { number: 'number', date: 'date', datetime: 'datetime-local' }[f.type] || 'text';
        input = h('input', {
          ...common, type, class: 'field-input', value: f.value ?? '',
          inputmode: f.type === 'number' ? 'numeric' : null,
          enterkeyhint: 'done', autocapitalize: f.type ? null : 'sentences',
        });
      }
      inputs[f.key] = input;
      return h('label', { class: 'field', for: 'f-' + f.key },
        f.label && h('span', { class: 'field-label' }, f.label),
        input,
        f.hint && h('span', { class: 'field-hint' }, f.hint));
    });
    return h('form', { class: 'dialog', onsubmit: submit },
      title && h('h2', { class: 'dialog-title' }, title),
      body,
      extra,
      dialogButtons([
        h('button', { type: 'button', class: 'btn btn-text', onclick: () => close(null) }, cancelLabel),
        h('button', { type: 'submit', class: 'btn btn-primary' }, okLabel),
      ]));
  });
}

/** items: [{ key, label, icon, danger, sub, checked }] → resolves the chosen key */
export function actionSheet({ title, items }) {
  return openLayer('sheet', (close) =>
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-handle' }),
      title && h('h2', { class: 'sheet-title' }, title),
      h('div', { class: 'sheet-list' },
        items.filter(Boolean).map((it) =>
          h('button', {
            class: `sheet-item${it.danger ? ' is-danger' : ''}${it.checked ? ' is-checked' : ''}`,
            onclick: () => close(it.key),
          },
          it.icon ? icon(it.icon, 20) : it.lead || null,
          h('span', { class: 'sheet-item-text' }, h('span', null, it.label), it.sub && h('small', null, it.sub)),
          it.checked ? icon('check', 18) : null))))).then((k) => k ?? null);
}

/** A blocking progress dialog: { update(text, fraction), close() }. */
export function progressDialog(title, text = '') {
  let closeFn = null;
  const label = h('p', { class: 'dialog-text' }, text);
  const bar = h('span');
  openLayer('dialog', () => h('div', { class: 'dialog', role: 'alertdialog', 'aria-busy': 'true' },
    h('h2', { class: 'dialog-title' }, title),
    label,
    h('div', { class: 'ink-rule progress-rule' }, bar)), { modal: true, onOpen: (c) => { closeFn = c; } });
  return {
    update(t, fraction) {
      if (t != null) label.textContent = t;
      if (fraction != null) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    close() {
      if (closeFn) closeFn(undefined);
    },
  };
}

/** A full-screen layer (e.g. the drawing pad), closed with back like any other layer. */
export function openFull(build, { onDismiss } = {}) {
  return openLayer('full', (close) => h('div', { class: 'fullpanel' }, build(close)), { onDismiss });
}

/** Opens an arbitrary bottom sheet built by `build(close)`. */
export function openSheet(build) {
  return openLayer('sheet', (close) => h('div', { class: 'sheet' }, h('div', { class: 'sheet-handle' }), build(close)));
}

let toastEl = null;
let toastTimer = null;

export function toast(message, { action, onAction, ms = 3200 } = {}) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'toast', role: 'status' },
    h('span', null, message),
    action && h('button', {
      class: 'toast-action',
      onclick: () => {
        onAction && onAction();
        hide();
      },
    }, action));
  document.body.appendChild(toastEl);
  requestAnimationFrame(() => toastEl && toastEl.classList.add('open'));
  const el = toastEl;
  function hide() {
    el.classList.remove('open');
    setTimeout(() => el.remove(), 200);
    if (toastEl === el) toastEl = null;
  }
  toastTimer = setTimeout(hide, action ? Math.max(ms, 5000) : ms);
}

// ---------------------------------------------------------------- scaffold

/**
 * Builds a full screen: app bar + scrolling content (+ optional FAB).
 * actions: [{ icon, label, onClick }]
 */
export function screen({ title, subtitle, back = true, actions = [], body, fab, footer, className = '', onTitleClick, titleClass = '' }) {
  const bar = h('header', { class: 'appbar' },
    back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => window.appBack() }, icon('back')) : null,
    h('div', { class: `appbar-title ${titleClass}`, onclick: onTitleClick || null, role: onTitleClick ? 'button' : null },
      h('h1', null, title || ''),
      subtitle ? h('p', null, subtitle) : null),
    h('div', { class: 'appbar-actions' },
      actions.filter(Boolean).map((a) =>
        a instanceof Node ? a : h('button', { class: 'icon-btn', 'aria-label': a.label, title: a.label, onclick: a.onClick }, icon(a.icon)))));
  const content = h('main', { class: 'content' }, body);
  const el = h('div', { class: `screen ${className}` }, bar, content, footer || null,
    fab ? h('button', { class: 'fab', 'aria-label': fab.label, onclick: fab.onClick }, icon(fab.icon || 'plus', 24), fab.text ? h('span', null, fab.text) : null) : null);
  content.addEventListener('scroll', () => bar.classList.toggle('is-scrolled', content.scrollTop > 4), { passive: true });
  return el;
}

export function sectionTitle(text, action) {
  return h('div', { class: 'section-title' },
    h('h2', null, text),
    action ? h('button', { class: 'btn btn-text btn-small', onclick: action.onClick }, action.icon ? icon(action.icon, 18) : null, action.label) : null);
}

export function statusDot(status) {
  return h('span', { class: `dot dot-${status || 'todo'}`, title: STATUS_LABEL[status || 'todo'] });
}

export function statusChip(status, onChange) {
  const btn = h('button', { class: `chip chip-status chip-${status}`, type: 'button' },
    statusDot(status), h('span', null, STATUS_LABEL[status] || STATUS_LABEL.todo), onChange ? icon('down', 16) : null);
  if (onChange) {
    btn.onclick = async () => {
      const k = await actionSheet({
        title: 'Status',
        items: ['todo', 'tocomplete', 'completed'].map((s) => ({
          key: s, label: STATUS_LABEL[s], lead: statusDot(s), checked: s === status,
        })),
      });
      if (k && k !== status) onChange(k);
    };
  } else btn.disabled = true;
  return btn;
}

// Status chips that follow the model: statuses can change by themselves
// (e.g. "To do" becomes "In progress" when the first words are written).
const liveChips = new Set();

export function liveStatusChip(get, set) {
  const wrap = h('span', { class: 'chip-live' });
  let shown = null;
  const draw = () => {
    const st = get() || 'todo';
    if (st === shown) return;
    shown = st;
    wrap.replaceChildren(statusChip(st, set ? (v) => { set(v); touch(); draw(); } : null));
  };
  wrap._draw = draw;
  draw();
  liveChips.add(wrap);
  return wrap;
}

onSaveState(() => {
  for (const w of liveChips) {
    if (!w.isConnected) liveChips.delete(w);
    else w._draw();
  }
});

export function row({ title, sub, meta, lead, status, onClick, trailing, className = '' }) {
  return h(onClick ? 'button' : 'div', { class: `row ${className}`, onclick: onClick || null, type: onClick ? 'button' : null },
    lead ? h('span', { class: 'row-lead' }, lead) : null,
    h('span', { class: 'row-body' },
      h('span', { class: 'row-title' }, title),
      sub ? h('span', { class: 'row-sub' }, sub) : null),
    meta != null ? h('span', { class: 'row-meta' }, meta) : null,
    status ? statusDot(status) : null,
    trailing || null);
}

export function list(children) {
  return h('div', { class: 'list' }, children);
}

export function empty({ icon: ic, title, text, action }) {
  return h('div', { class: 'empty' },
    ic ? h('div', { class: 'empty-icon' }, icon(ic, 30)) : null,
    h('h2', null, title),
    text ? h('p', null, text) : null,
    action ? h('button', { class: 'btn btn-primary', onclick: action.onClick }, action.label) : null);
}

export function avatar(item, size = 44) {
  const style = { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.36) + 'px' };
  if (item.image) return h('span', { class: 'avatar', style }, h('img', { src: imgSrc(item.image), alt: '' }));
  return h('span', { class: 'avatar', style }, initials(item.name || item.title));
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'tablist' });
  for (const [v, label] of options) {
    wrap.appendChild(h('button', {
      class: v === value ? 'is-on' : '',
      role: 'tab',
      'aria-selected': v === value ? 'true' : 'false',
      onclick: () => onChange(v),
    }, label));
  }
  return wrap;
}

export function menuButton(itemsFn) {
  return h('button', {
    class: 'icon-btn', 'aria-label': 'More options',
    onclick: async () => {
      const items = itemsFn();
      const k = await actionSheet({ items });
      const it = items.find((i) => i && i.key === k);
      if (it && it.run) it.run();
    },
  }, icon('more'));
}

/** A labelled single-line field bound to obj[key]; calls onChange after edits. */
export function textField({ label, value, placeholder, onInput, multiline, type = 'text', hint }) {
  const input = multiline
    ? h('textarea', { class: 'field-input', rows: 3, placeholder: placeholder || '' }, value || '')
    : h('input', { class: 'field-input', type, value: value || '', placeholder: placeholder || '', enterkeyhint: 'done' });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) input.blur();
  });
  return h('label', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null, input,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

/** Checklist of entities, used for scene tags. */
export function checklist(items, selected, onToggle, emptyText) {
  if (!items.length) return h('p', { class: 'muted small pad' }, emptyText);
  return h('div', { class: 'checklist' },
    items.map((it) => {
      const on = selected.includes(it.id);
      const btn = h('button', { class: `check-item${on ? ' is-on' : ''}`, type: 'button' },
        h('span', { class: 'check-box' }, on ? icon('check', 16) : null),
        it.lead || null,
        h('span', { class: 'check-text' }, it.label, it.sub ? h('small', null, it.sub) : null));
      btn.onclick = () => {
        const nowOn = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', nowOn);
        btn.querySelector('.check-box').replaceChildren(...(nowOn ? [icon('check', 16)] : []));
        onToggle(it.id, nowOn);
      };
      return btn;
    }));
}
