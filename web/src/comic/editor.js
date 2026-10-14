// The comic page editor: tap a panel to give it a picture, a drawing or
// lettering; drag balloons and their tails; split panels; switch to the script
// view to write panel descriptions and dialogue as text.
import { h, icon, plural, debounce, moveItem, uid, clone } from '../util.js';
import { getProject, touch } from '../store.js';
import { findById, chapterLabel, findChapter, STATUS_LABEL } from '../model.js';
import {
  screen, actionSheet, openSheet, promptDialog, confirmDialog, toast, menuButton, liveStatusChip, segmented,
  sectionTitle, checklist, avatar,
} from '../ui.js';
import { go, rerender, navigate } from '../router.js';
import { pickFiles } from '../platform.js';
import { resolveSource, clipboardHasImage, importBytes, imageUrl } from '../images.js';
import { richField } from '../editor.js';
import {
  W, ratioOf, LAYOUTS, LETTERING, newLettering, applyLayout, splitPanel, findPage, pageWords, pageChanged, allPages,
  newPage,
} from './model.js';
import { buildPage, pageSvg, opsToSvg, ensureFonts, picturePlacement, panelShapes } from './render.js';
import { openSketch } from './sketch.js';
import { layoutThumb } from './thumbs.js';

let view = 'page';
let zoomed = false;

const BG_COLORS = ['#ffffff', '#f4ecd8', '#fde2e4', '#e2ece9', '#dfe7fd', '#fff1a8', '#c9c9c9', '#3b3b3b', '#111111'];

export async function chooseLayout(title = 'Choose a layout') {
  const p = getProject();
  const ratio = ratioOf(p);
  return openSheet((close) => h('div', null,
    h('h2', { class: 'sheet-title' }, title),
    h('div', { class: 'layout-grid' }, LAYOUTS.map((l) => h('button', {
      class: 'layout-choice', 'aria-label': l.label, title: l.label, onclick: () => close(l.id),
    }, h('span', { class: 'layout-thumb', html: layoutThumb(l.id, ratio) }), h('span', { class: 'layout-name' }, l.label))))))
    .then((r) => r || null);
}

export function pageScreen({ pgid }) {
  const p = getProject();
  const found = findPage(pgid);
  if (!found) return null;
  const { page, chapter } = found;
  const base = `/p/${p.id}`;
  const ratio = ratioOf(p);
  const H = W * ratio;
  let sel = { panel: null, item: null, adjust: false };
  const undo = [];
  const redo = [];
  p.lastPage = page.id;

  // ---------------------------------------------------------------- history
  const snap = () => JSON.stringify({ panels: page.panels, layout: page.layout });
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo', onclick: () => step(undo, redo) }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Redo', onclick: () => step(redo, undo) }, icon('redo'));
  const syncHistory = () => {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
  };
  function record() {
    undo.push(snap());
    if (undo.length > 80) undo.shift();
    redo.length = 0;
    syncHistory();
  }
  function step(from, to) {
    if (!from.length) return;
    to.push(snap());
    const d = JSON.parse(from.pop());
    page.panels = d.panels;
    page.layout = d.layout;
    if (sel.panel && !panelById(sel.panel)) sel = { panel: null, item: null, adjust: false };
    if (sel.item && !itemById(sel.item)) sel.item = null;
    syncHistory();
    commit();
    refresh();
  }

  const panelById = (id) => page.panels.find((x) => x.id === id) || null;
  function itemById(id) {
    for (const panel of page.panels) {
      const it = panel.items.find((x) => x.id === id);
      if (it) return { item: it, panel };
    }
    return null;
  }

  let wordsBefore = pageWords(page);
  function commit() {
    pageChanged(page, wordsBefore);
    wordsBefore = pageWords(page);
    countEl.textContent = `${plural(page.panels.length, 'panel')}, ${plural(wordsBefore, 'word')}`;
  }

  // ---------------------------------------------------------------- drawing the page
  const stage = h('div', { class: 'comic-stage' });
  let svg = null;

  function renderAll() {
    const built = buildPage(p, page, { overlay: sel });
    stage.innerHTML = pageSvg(built, { className: 'comic-page' });
    svg = stage.firstElementChild;
    svg.classList.toggle('is-adjusting', !!sel.adjust);
  }
  function renderLettering() {
    if (!svg) return renderAll();
    const built = buildPage(p, page, { overlay: sel });
    svg.querySelector('.layer-lettering').innerHTML = opsToSvg(built.lettering, () => null);
    svg.querySelector('.layer-marks').innerHTML = opsToSvg(built.marks, () => null);
  }
  function renderPanel(panel) {
    const g = svg && svg.querySelector(`g[data-panel="${panel.id}"]`);
    if (!g) return renderAll();
    const s = panelShapes(panel, H);
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tmp.innerHTML = opsToSvg(s.ops, (o) => imageUrl(o.ref));
    g.replaceChildren(...tmp.childNodes);
  }

  function toPage(e) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [pt.x, pt.y];
  }

  // ---------------------------------------------------------------- pointer handling
  let drag = null;
  let raf = 0;
  const schedule = (fn) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn();
    });
  };

  stage.addEventListener('pointerdown', (e) => {
    if (!svg || e.button > 0) return;
    const handle = e.target.closest('[data-handle]');
    const itemEl = e.target.closest('[data-item]');
    const panelEl = e.target.closest('[data-panel]');
    const [x, y] = toPage(e);
    drag = { id: e.pointerId, x0: x, y0: y, sx: e.clientX, sy: e.clientY, moved: false, recorded: false };
    if (sel.adjust && panelEl && panelEl.dataset.panel === sel.panel) {
      const panel = panelById(sel.panel);
      drag.kind = 'pan';
      drag.panel = panel;
      drag.fit = { ...panel.fit };
      drag.place = picturePlacement(panel, H);
    } else if (handle && sel.item) {
      drag.kind = handle.dataset.handle; // 'tail' | 'width'
      drag.ref = itemById(sel.item);
    } else if (itemEl) {
      drag.kind = 'move';
      drag.ref = itemById(itemEl.dataset.item);
      drag.start = drag.ref && { x: drag.ref.item.x, y: drag.ref.item.y };
    } else if (panelEl) {
      drag.kind = 'tap-panel';
      drag.panelId = panelEl.dataset.panel;
    } else {
      drag.kind = 'tap-empty';
    }
    if (['pan', 'tail', 'width', 'move'].includes(drag.kind)) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.moved = true;
    const [x, y] = toPage(e);
    const dx = x - drag.x0;
    const dy = y - drag.y0;
    const needsRecord = ['pan', 'tail', 'width', 'move'].includes(drag.kind);
    if (needsRecord && !drag.recorded) {
      record();
      drag.recorded = true;
    }
    if (drag.kind === 'move' && drag.ref) {
      if (sel.item !== drag.ref.item.id) sel = { panel: drag.ref.panel.id, item: drag.ref.item.id, adjust: false };
      drag.ref.item.x = Math.max(0, Math.min(1, drag.start.x + dx / W));
      drag.ref.item.y = Math.max(0, Math.min(1, drag.start.y + dy / H));
      schedule(renderLettering);
    } else if (drag.kind === 'tail' && drag.ref) {
      drag.ref.item.tx = Math.max(0, Math.min(1, x / W));
      drag.ref.item.ty = Math.max(0, Math.min(1, y / H));
      schedule(renderLettering);
    } else if (drag.kind === 'width' && drag.ref) {
      const it = drag.ref.item;
      const half = Math.abs(x - it.x * W);
      it.w = Math.max(0.08, Math.min(0.95, ((half * 2) / (it.type === 'caption' ? 1.05 : 1.25)) / W));
      schedule(renderLettering);
    } else if (drag.kind === 'pan') {
      const pl = drag.place;
      const spanX = pl.w - pl.pw;
      const spanY = pl.h - pl.ph;
      drag.panel.fit.ox = spanX > 0 ? Math.max(-1, Math.min(1, drag.fit.ox + (2 * dx) / spanX)) : 0;
      drag.panel.fit.oy = spanY > 0 ? Math.max(-1, Math.min(1, drag.fit.oy + (2 * dy) / spanY)) : 0;
      schedule(() => renderPanel(drag.panel));
    }
  });

  const finish = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (d.kind === 'move' && d.ref) select({ panel: d.ref.panel.id, item: d.ref.item.id });
      else if (d.kind === 'tap-panel') select(sel.panel === d.panelId && !sel.item ? { panel: null } : { panel: d.panelId });
      else if (d.kind === 'tap-empty' || d.kind === 'pan') select(d.kind === 'pan' ? sel : { panel: null });
      return;
    }
    if (d.recorded) {
      commit();
      if (d.kind === 'pan') renderAll();
    }
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
  stage.addEventListener('dblclick', (e) => {
    const itemEl = e.target.closest('[data-item]');
    if (itemEl) editText(itemById(itemEl.dataset.item));
  });

  function select(next) {
    sel = { panel: next.panel || null, item: next.item || null, adjust: !!next.adjust };
    renderAll();
    drawTools();
  }

  // ---------------------------------------------------------------- actions
  async function editText(ref) {
    if (!ref) return;
    const it = ref.item;
    const label = LETTERING[it.type] || 'Lettering';
    const v = await promptDialog({ title: label, label: 'Text', value: it.text, multiline: true, placeholder: it.type === 'sfx' ? 'e.g. KRAK!' : 'What is said or shown', okLabel: 'Done' });
    if (v == null) return;
    record();
    it.text = v;
    commit();
    renderLettering();
  }

  async function addLettering(type) {
    const panel = panelById(sel.panel);
    if (!panel) return;
    record();
    const it = newLettering(type, panel, p);
    panel.items.push(it);
    // speech defaults to the last speaker used on this page
    if (type !== 'caption' && type !== 'sfx') {
      const last = [...page.panels].reverse().flatMap((x) => [...x.items].reverse()).find((x) => x.speaker && x.id !== it.id);
      if (last) it.speaker = last.speaker;
    }
    sel = { panel: panel.id, item: it.id, adjust: false };
    commit();
    renderAll();
    drawTools();
    await editText({ item: it, panel });
    if (!it.text) {
      // nothing written: drop the empty balloon again
      panel.items.splice(panel.items.indexOf(it), 1);
      undo.pop();
      syncHistory();
      sel.item = null;
      commit();
      renderAll();
      drawTools();
    }
  }

  async function setPicture() {
    const panel = panelById(sel.panel);
    if (!panel) return;
    let choice = 'pick';
    if (clipboardHasImage()) {
      choice = await actionSheet({
        title: 'Picture for this panel',
        items: [
          { key: 'pick', label: 'Choose from gallery or files', icon: 'image' },
          { key: 'clip', label: 'Paste the copied image', icon: 'clipboard' },
        ],
      });
    }
    let source = null;
    if (choice === 'pick') {
      const [file] = await pickFiles('image/*', false);
      if (file) source = { file };
    } else if (choice === 'clip') source = { clipboard: true };
    if (!source) return;
    try {
      const r = await resolveSource(source, { max: 2000 });
      record();
      panel.img = r.name;
      panel.iw = r.w;
      panel.ih = r.h;
      panel.fit = { z: 1, ox: 0, oy: 0 };
      commit();
      renderAll();
      drawTools();
    } catch (e) {
      toast(e.message || 'This picture couldn’t be added');
    }
  }

  async function draw() {
    const panel = panelById(sel.panel);
    if (!panel) return;
    const aspect = (panel.h * H) / (panel.w * W);
    const guideOps = panelShapes({ ...panel, drawing: '', border: false }, H).ops;
    const guideSvg = panel.img
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${panel.x * W} ${panel.y * H} ${panel.w * W} ${panel.h * H}" preserveAspectRatio="none">${opsToSvg(guideOps, (o) => imageUrl(o.ref))}</svg>`
      : null;
    const blob = await openSketch({
      aspect,
      baseUrl: panel.drawing ? imageUrl(panel.drawing) : null,
      guideSvg,
      bg: panel.bg || '#ffffff',
      title: `Panel ${page.panels.indexOf(panel) + 1}`,
    });
    if (!blob) return;
    try {
      const r = await importBytes(new Uint8Array(await blob.arrayBuffer()), 'image/png', { max: 1600 });
      record();
      panel.drawing = r.name;
      panel.dw = r.w;
      panel.dh = r.h;
      commit();
      renderAll();
    } catch (e) {
      // an empty transparent canvas is rejected as a 'tracking pixel' only if 2x2; any other error is shown
      toast(e.message || 'The drawing couldn’t be saved');
    }
  }

  async function panelMore() {
    const panel = panelById(sel.panel);
    if (!panel) return;
    const i = page.panels.indexOf(panel);
    const k = await actionSheet({
      title: `Panel ${i + 1}`,
      items: [
        panel.img && { key: 'adjust', label: 'Move and zoom the picture', icon: 'hand' },
        panel.img && { key: 'noimg', label: 'Remove the picture', icon: 'close' },
        panel.drawing && { key: 'nodraw', label: 'Remove the drawing', icon: 'eraser' },
        { key: 'bg', label: 'Background colour', icon: 'palette' },
        { key: 'border', label: panel.border === false ? 'Show the border' : 'Hide the border', icon: 'frame' },
        { key: 'h', label: 'Split into top and bottom', icon: 'splitH' },
        { key: 'v', label: 'Split into left and right', icon: 'splitV' },
        i > 0 && { key: 'earlier', label: 'Read this panel earlier', icon: 'up' },
        i < page.panels.length - 1 && { key: 'later', label: 'Read this panel later', icon: 'down' },
        { key: 'desc', label: 'Panel description', icon: 'text' },
        page.panels.length > 1 && { key: 'delete', label: 'Delete panel', icon: 'trash', danger: true },
      ].filter(Boolean),
    });
    if (!k) return;
    if (k === 'adjust') {
      select({ panel: panel.id, adjust: true });
      return;
    }
    if (k === 'desc') {
      const v = await promptDialog({ title: `Panel ${i + 1}`, label: 'What the panel shows', value: panel.desc, multiline: true, placeholder: 'Wide shot. The caravan enters the square at dusk…', okLabel: 'Done' });
      if (v == null) return;
      record();
      panel.desc = v;
      commit();
      return;
    }
    if (k === 'bg') {
      const c = await openSheet((close) => h('div', null,
        h('h2', { class: 'sheet-title' }, 'Background colour'),
        h('div', { class: 'swatches' }, BG_COLORS.map((col) => h('button', {
          class: `swatch${(panel.bg || '#ffffff') === col ? ' is-on' : ''}`, style: { background: col }, 'aria-label': col, onclick: () => close(col),
        })))));
      if (!c) return;
      record();
      panel.bg = c;
    } else if (k === 'delete') {
      const hasContent = panel.img || panel.drawing || panel.items.length || panel.desc;
      if (hasContent && !(await confirmDialog({ title: `Delete panel ${i + 1}?`, message: 'Its picture, drawing and lettering are removed too. You can undo this.', okLabel: 'Delete', danger: true }))) return;
      record();
      page.panels.splice(i, 1);
      page.layout = 'custom';
      sel = { panel: null, item: null, adjust: false };
    } else {
      record();
      if (k === 'noimg') panel.img = '';
      if (k === 'nodraw') panel.drawing = '';
      if (k === 'border') panel.border = panel.border === false;
      if (k === 'h' || k === 'v') {
        const [a] = splitPanel(page, panel, k, p);
        sel = { panel: a.id, item: null, adjust: false };
      }
      if (k === 'earlier') moveItem(page.panels, i, i - 1);
      if (k === 'later') moveItem(page.panels, i, i + 1);
    }
    commit();
    renderAll();
    drawTools();
  }

  async function itemType(ref) {
    const k = await actionSheet({
      title: 'Kind of lettering',
      items: Object.entries(LETTERING).map(([key, label]) => ({ key, label, icon: key, checked: key === ref.item.type })),
    });
    if (!k || k === ref.item.type) return;
    record();
    const it = ref.item;
    it.type = k;
    if ((k === 'caption' || k === 'sfx')) {
      it.tx = null;
      it.ty = null;
    } else if (it.tx == null) {
      it.tx = Math.min(1, it.x + 0.08);
      it.ty = Math.min(1, it.y + 0.12);
    }
    if (k === 'sfx' && !it.color) {
      it.color = '#ffd23f';
      it.rot = -8;
    }
    commit();
    renderLettering();
    drawTools();
  }

  async function itemSpeaker(ref) {
    const k = await actionSheet({
      title: 'Who is speaking?',
      items: [{ key: 'none', label: 'Nobody in particular', checked: !ref.item.speaker },
        ...p.characters.map((c) => ({ key: c.id, label: c.name, lead: avatar(c, 28), checked: c.id === ref.item.speaker }))],
    });
    if (!k) return;
    record();
    ref.item.speaker = k === 'none' ? '' : k;
    commit();
    drawTools();
    if (!p.characters.length) toast('Create characters to choose who speaks');
  }

  async function itemMore(ref) {
    const it = ref.item;
    const k = await actionSheet({
      title: LETTERING[it.type],
      items: [
        { key: 'bigger', label: 'Bigger text', icon: 'plus' },
        { key: 'smaller', label: 'Smaller text', icon: 'zoom' },
        it.type === 'sfx' && { key: 'rot', label: 'Rotate', icon: 'restore' },
        it.type === 'sfx' && { key: 'color', label: 'Colour', icon: 'palette' },
        it.type !== 'caption' && it.type !== 'sfx' && { key: 'tail', label: it.tx == null ? 'Add a tail' : 'Remove the tail', icon: 'speech' },
        { key: 'front', label: 'Bring to front', icon: 'layers' },
        { key: 'dup', label: 'Duplicate', icon: 'copy' },
        { key: 'delete', label: 'Delete', icon: 'trash', danger: true },
      ].filter(Boolean),
    });
    if (!k) return;
    if (k === 'color') {
      const c = await openSheet((close) => h('div', null,
        h('h2', { class: 'sheet-title' }, 'Colour'),
        h('div', { class: 'swatches' }, ['#ffd23f', '#f46036', '#d7263d', '#ffffff', '#1b98e0', '#2e933c', '#111111'].map((col) => h('button', {
          class: `swatch${it.color === col ? ' is-on' : ''}`, style: { background: col }, onclick: () => close(col),
        })))));
      if (!c) return;
      record();
      it.color = c;
    } else {
      record();
      if (k === 'bigger') it.size = Math.min(2.5, (it.size || 1) * 1.15);
      if (k === 'smaller') it.size = Math.max(0.5, (it.size || 1) / 1.15);
      if (k === 'rot') it.rot = (((it.rot || 0) + 8 + 30) % 60) - 30;
      if (k === 'tail') {
        if (it.tx == null) {
          it.tx = Math.min(1, it.x + 0.08);
          it.ty = Math.min(1, it.y + 0.12);
        } else {
          it.tx = null;
          it.ty = null;
        }
      }
      if (k === 'front') {
        ref.panel.items.splice(ref.panel.items.indexOf(it), 1);
        ref.panel.items.push(it);
      }
      if (k === 'dup') {
        const copy = { ...clone(it), id: uid(), x: Math.min(1, it.x + 0.03), y: Math.min(1, it.y + 0.03) };
        if (copy.tx != null) copy.ty = Math.min(1, copy.ty + 0.03);
        ref.panel.items.push(copy);
        sel.item = copy.id;
      }
      if (k === 'delete') {
        ref.panel.items.splice(ref.panel.items.indexOf(it), 1);
        sel.item = null;
      }
    }
    commit();
    renderLettering();
    drawTools();
  }

  // ---------------------------------------------------------------- toolbar
  const tools = h('div', { class: 'comic-tools', role: 'toolbar' });
  const tool = (ic, label, onclick, extra = '') => h('button', { class: `comic-tool ${extra}`, onclick }, icon(ic, 22), h('span', null, label));

  function drawTools() {
    if (view !== 'page') {
      tools.replaceChildren();
      tools.hidden = true;
      return;
    }
    tools.hidden = false;
    if (sel.adjust) {
      const panel = panelById(sel.panel);
      const zoom = h('input', {
        type: 'range', min: '1', max: '4', step: '0.01', value: String((panel && panel.fit.z) || 1), class: 'zoom-range', 'aria-label': 'Zoom',
      });
      let recorded = false;
      zoom.addEventListener('input', () => {
        if (!recorded) {
          record();
          recorded = true;
        }
        panel.fit.z = Number(zoom.value);
        renderPanel(panel);
      });
      zoom.addEventListener('change', () => {
        recorded = false;
        commit();
      });
      tools.replaceChildren(
        h('div', { class: 'adjust-row' }, icon('zoom', 20), zoom,
          h('button', { class: 'btn btn-text', onclick: () => { record(); panel.fit = { z: 1, ox: 0, oy: 0 }; commit(); renderAll(); drawTools(); } }, 'Reset'),
          h('button', { class: 'btn btn-primary btn-small', onclick: () => select({ panel: sel.panel }) }, icon('check', 18), 'Done')),
        h('p', { class: 'tools-hint' }, 'Drag the picture to move it inside the panel.'));
      return;
    }
    const ref = sel.item && itemById(sel.item);
    if (ref) {
      const sp = ref.item.speaker && findById(p.characters, ref.item.speaker);
      tools.replaceChildren(h('div', { class: 'tool-row' },
        tool('text', 'Text', () => editText(ref)),
        tool(ref.item.type, LETTERING[ref.item.type].split(' ')[0], () => itemType(ref)),
        ref.item.type !== 'caption' && ref.item.type !== 'sfx' ? tool('user', sp ? sp.name.split(' ')[0] : 'Speaker', () => itemSpeaker(ref)) : null,
        tool('dots', 'More', () => itemMore(ref)),
        tool('close', 'Deselect', () => select({ panel: ref.panel.id }))));
      return;
    }
    const panel = sel.panel && panelById(sel.panel);
    if (panel) {
      tools.replaceChildren(h('div', { class: 'tool-row' },
        tool('image', panel.img ? 'Picture' : 'Picture', setPicture),
        tool('brush', 'Draw', draw),
        tool('speech', 'Speech', () => addLettering('speech')),
        tool('thought', 'Thought', () => addLettering('thought')),
        tool('caption', 'Caption', () => addLettering('caption')),
        tool('sfx', 'Sound', () => addLettering('sfx')),
        tool('dots', 'More', panelMore)));
      return;
    }
    tools.replaceChildren(h('p', { class: 'tools-hint' }, 'Tap a panel to add a picture, a drawing or lettering. Drag balloons to move them; drag the blue dot to aim the tail.'));
  }

  // ---------------------------------------------------------------- script view
  const scriptBox = h('div', { class: 'comic-script' });
  function drawScript() {
    const chars = p.characters;
    const panels = page.panels.map((panel, i) => {
      const desc = h('textarea', { class: 'field-input script-desc', rows: 2, placeholder: 'What the panel shows: framing, setting, action…' }, panel.desc || '');
      let recorded = false;
      const saveDesc = debounce(() => commit(), 400);
      desc.addEventListener('input', () => {
        if (!recorded) {
          record();
          recorded = true;
        }
        panel.desc = desc.value;
        saveDesc();
      });
      desc.addEventListener('blur', () => { recorded = false; saveDesc.flush(); });
      const lines = panel.items.map((it) => {
        const text = h('textarea', { class: 'field-input script-text', rows: 2, placeholder: it.type === 'sfx' ? 'KRAK!' : 'Text' }, it.text || '');
        let rec = false;
        const saveText = debounce(() => commit(), 400);
        text.addEventListener('input', () => {
          if (!rec) {
            record();
            rec = true;
          }
          it.text = text.value;
          saveText();
        });
        text.addEventListener('blur', () => { rec = false; saveText.flush(); });
        const type = h('select', { class: 'field-input script-type', 'aria-label': 'Kind' },
          Object.entries(LETTERING).map(([k, l]) => h('option', { value: k, selected: k === it.type }, l)));
        type.addEventListener('change', () => {
          record();
          it.type = type.value;
          if (it.type === 'caption' || it.type === 'sfx') { it.tx = null; it.ty = null; } else if (it.tx == null) { it.tx = Math.min(1, it.x + 0.08); it.ty = Math.min(1, it.y + 0.12); }
          commit();
          drawScript();
        });
        const speaker = it.type === 'caption' || it.type === 'sfx' ? null : h('select', { class: 'field-input script-speaker', 'aria-label': 'Speaker' },
          h('option', { value: '' }, 'Speaker…'),
          chars.map((c) => h('option', { value: c.id, selected: c.id === it.speaker }, c.name)));
        if (speaker) speaker.addEventListener('change', () => { record(); it.speaker = speaker.value; commit(); });
        const del = h('button', {
          class: 'icon-btn', 'aria-label': 'Delete line',
          onclick: () => { record(); panel.items.splice(panel.items.indexOf(it), 1); commit(); drawScript(); },
        }, icon('trash', 18));
        return h('div', { class: 'script-line' }, h('div', { class: 'script-line-head' }, type, speaker, del), text);
      });
      const add = (type, label) => h('button', {
        class: 'chip', onclick: () => {
          record();
          panel.items.push(newLettering(type, panel, p));
          commit();
          drawScript();
          const texts = scriptBox.children[i] ? scriptBox.children[i].querySelectorAll('.script-text') : [];
          if (texts.length) texts[texts.length - 1].focus();
        },
      }, icon(type, 16), h('span', null, label));
      return h('section', { class: 'script-panel' },
        h('h3', { class: 'script-panel-title' }, `Panel ${i + 1}`, panel.img || panel.drawing ? h('span', { class: 'tag' }, 'picture') : null),
        desc,
        lines,
        h('div', { class: 'script-add' }, add('speech', 'Dialogue'), add('thought', 'Thought'), add('caption', 'Caption'), add('sfx', 'Sound')));
    });
    scriptBox.replaceChildren(...panels,
      h('p', { class: 'muted small pad' }, 'New lines are placed in their panel automatically; adjust them in the page view.'));
  }

  // ---------------------------------------------------------------- frame
  const zoomBtn = h('button', {
    class: `icon-btn${zoomed ? ' is-on' : ''}`, 'aria-label': zoomed ? 'Fit the page' : 'Zoom in',
    onclick: () => {
      zoomed = !zoomed;
      pageView.classList.toggle('is-zoomed', zoomed);
      zoomBtn.classList.toggle('is-on', zoomed);
      zoomBtn.setAttribute('aria-label', zoomed ? 'Fit the page' : 'Zoom in');
    },
  }, icon('zoom'));
  const countEl = h('span', { class: 'count' }, `${plural(page.panels.length, 'panel')}, ${plural(wordsBefore, 'word')}`);
  const pageView = h('div', { class: `comic-page-view${zoomed ? ' is-zoomed' : ''}` }, stage);
  const viewSwitch = segmented([['page', 'Page'], ['script', 'Script']], view, (v) => {
    view = v;
    rerender();
  });

  function refresh() {
    if (view === 'page') {
      renderAll();
    } else drawScript();
    drawTools();
  }

  const num = allPages(p).find((x) => x.page.id === page.id)?.number || 1;
  const el = screen({
    title: `Page ${num}`,
    subtitle: chapterLabel(chapter, p),
    className: 'screen-comic',
    actions: [
      undoBtn, redoBtn,
      view === 'page' ? zoomBtn : null,
      menuButton(() => [
        { key: 'layout', label: 'Change layout', icon: 'panels', run: async () => {
          const id = await chooseLayout('Change layout');
          if (!id) return;
          const lost = Math.max(0, page.panels.length - (LAYOUTS.find((l) => l.id === id).rows.reduce((n, r) => n + r[1].length, 0)));
          if (lost && !(await confirmDialog({ title: 'Fewer panels', message: `The last ${plural(lost, 'panel')} and their content will be removed. You can undo this.`, okLabel: 'Change layout' }))) return;
          record();
          applyLayout(page, id, p);
          sel = { panel: null, item: null, adjust: false };
          commit();
          refresh();
        } },
        { key: 'details', label: 'Page details', icon: 'tags', run: () => go(`${base}/pg/${page.id}/details`) },
        { key: 'read', label: 'Read from this page', icon: 'read', run: () => go(`${base}/read/${num - 1}`) },
        { key: 'dup', label: 'Duplicate page', icon: 'copy', run: () => {
          const copy = { ...clone(page), id: uid(), status: 'tocomplete' };
          for (const pn of copy.panels) {
            pn.id = uid();
            for (const it of pn.items) it.id = uid();
          }
          chapter.pages.splice(chapter.pages.indexOf(page) + 1, 0, copy);
          touch();
          go(`${base}/pg/${copy.id}`);
        } },
        p.chapters.length > 1 && { key: 'move', label: 'Move to another chapter', icon: 'move', run: async () => {
          const k = await actionSheet({ title: 'Move to chapter', items: p.chapters.map((c, i) => ({ key: c.id, label: c.title ? `${i + 1}. ${c.title}` : `Chapter ${i + 1}`, checked: c === chapter })) });
          if (!k || k === chapter.id) return;
          chapter.pages.splice(chapter.pages.indexOf(page), 1);
          findChapter(k).pages.push(page);
          touch();
          rerender();
        } },
        { key: 'delete', label: 'Delete page', icon: 'trash', danger: true, run: async () => {
          if (!(await confirmDialog({ title: `Delete page ${num}?`, message: 'Its panels, pictures and lettering are removed.', okLabel: 'Delete', danger: true }))) return;
          chapter.pages.splice(chapter.pages.indexOf(page), 1);
          touch();
          toast('Page deleted');
          navigate(`${base}/ch/${chapter.id}`, { replace: true, back: true });
        } },
      ].filter(Boolean)),
    ],
    body: [
      h('div', { class: 'scene-meta' }, viewSwitch, liveStatusChip(() => page.status, (s) => { page.status = s; }), countEl),
      view === 'page' ? pageView : scriptBox,
    ],
    footer: tools,
  });

  syncHistory();
  ensureFonts().then(refresh);
  if (view === 'script') drawScript();
  drawTools();

  return {
    el,
    onBack: () => {
      if (sel.adjust) {
        select({ panel: sel.panel });
        return true;
      }
      if (sel.item || sel.panel) {
        select({ panel: null });
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------- page details

export function pageDetailsScreen({ pgid }) {
  const p = getProject();
  const found = findPage(pgid);
  if (!found) return null;
  const { page } = found;
  const speakers = new Set();
  for (const panel of page.panels) for (const it of panel.items) if (it.speaker) speakers.add(it.speaker);
  const notes = richField({
    html: page.notes || '', lang: p.language, className: 'prose-note',
    placeholder: 'Notes for this page: what it must achieve, references for the artist…',
    onChange: (v) => { page.notes = v; touch(); },
  });
  return screen({
    title: 'Page details',
    subtitle: `Page ${found.number}`,
    body: [
      sectionTitle('Status'),
      h('div', { class: 'pad-x' }, segmented(['todo', 'tocomplete', 'completed'].map((k) => [k, STATUS_LABEL[k]]), page.status, (v) => { page.status = v; touch(); rerender(); })),
      sectionTitle('Characters on this page'),
      h('p', { class: 'muted small pad' }, speakers.size ? `Speakers are counted automatically (${speakers.size}). Tag characters who appear without speaking.` : 'Characters who speak are counted automatically. Tag characters who appear without speaking.'),
      checklist(p.characters.map((c) => ({ id: c.id, label: c.name, lead: avatar(c, 28), sub: speakers.has(c.id) ? 'Speaks on this page' : null })), page.chars, (id, on) => {
        const i = page.chars.indexOf(id);
        if (on && i < 0) page.chars.push(id);
        if (!on && i >= 0) page.chars.splice(i, 1);
        touch();
      }, 'Create characters to tag them here.'),
      sectionTitle('Page notes'),
      h('div', { class: 'note-box' }, notes.el),
    ],
  });
}

export async function addPage(p, ch) {
  const id = await chooseLayout('New page');
  if (!id) return;
  const page = newPage(id, p);
  ch.pages.push(page);
  touch();
  go(`/p/${p.id}/pg/${page.id}`);
}

