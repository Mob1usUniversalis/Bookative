// Drawing pad for a comic panel: pen and eraser in several sizes and colours,
// pressure from a stylus, undo/redo, the panel picture as a tracing guide.
// Resolves with a transparent PNG (Blob), or null when cancelled.
import { h, icon } from '../util.js';
import { openFull, confirmDialog } from '../ui.js';

const COLORS = ['#111111', '#ffffff', '#8a8a8a', '#d7263d', '#f46036', '#ffd23f', '#2e933c', '#1b98e0', '#3d348b', '#8d5b3a', '#f2c6a0'];
const SIZES = [3, 7, 14, 30];
const LONG = 1600;

export function openSketch({ aspect, baseUrl = null, guideSvg = null, bg = '#ffffff', title = 'Drawing' }) {
  const cw = aspect >= 1 ? Math.round(LONG / aspect) : LONG;
  const ch = aspect >= 1 ? LONG : Math.round(LONG * aspect);
  const strokes = [];
  const redo = [];
  let tool = 'pen';
  let color = COLORS[0];
  let sizeIdx = 1;
  let showGuide = !!guideSvg;
  let baseImg = null;
  let penSeen = false;
  let current = null;

  const canvas = h('canvas', { class: 'sketch-canvas', width: cw, height: ch });
  const ctx = canvas.getContext('2d');
  const guide = guideSvg ? h('div', { class: 'sketch-guide', html: guideSvg }) : null;
  const paper = h('div', { class: 'sketch-paper', style: { background: bg } }, guide, canvas);
  const stage = h('div', { class: 'sketch-stage' }, paper);
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo' }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Redo' }, icon('redo'));

  function fit() {
    const r = stage.getBoundingClientRect();
    const scale = Math.min((r.width - 16) / cw, (r.height - 16) / ch);
    paper.style.width = `${Math.floor(cw * scale)}px`;
    paper.style.height = `${Math.floor(ch * scale)}px`;
  }

  function segment(s, i) {
    const pts = s.pts;
    const w = (k) => s.size * pts[k][2];
    ctx.lineWidth = w(i);
    ctx.beginPath();
    if (i === 0) {
      ctx.arc(pts[0][0], pts[0][1], w(0) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const a = i > 1 ? [(pts[i - 2][0] + pts[i - 1][0]) / 2, (pts[i - 2][1] + pts[i - 1][1]) / 2] : pts[0];
    const b = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], b[0], b[1]);
    ctx.stroke();
  }

  function begin(s) {
    ctx.save();
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function drawStroke(s) {
    begin(s);
    for (let i = 0; i < s.pts.length; i++) segment(s, i);
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, cw, ch);
    if (baseImg) ctx.drawImage(baseImg, 0, 0, cw, ch);
    for (const s of strokes) drawStroke(s);
    undoBtn.disabled = !strokes.length;
    redoBtn.disabled = !redo.length;
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' ? 0.3 + Math.min(1, e.pressure || 0.5) * 1.2 : 1;
    return [((e.clientX - r.left) / r.width) * cw, ((e.clientY - r.top) / r.height) * ch, pressure];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penSeen = true;
    else if (penSeen && e.pointerType === 'touch') return; // palm rejection
    if (current) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    current = { id: e.pointerId, erase: tool === 'eraser', color, size: SIZES[sizeIdx] * (tool === 'eraser' ? 2 : 1), pts: [point(e)] };
    redo.length = 0;
    begin(current);
    segment(current, 0);
    ctx.restore();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current || e.pointerId !== current.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    begin(current);
    for (const ev of events.length ? events : [e]) {
      current.pts.push(point(ev));
      segment(current, current.pts.length - 1);
    }
    ctx.restore();
  });
  const end = (e) => {
    if (!current || e.pointerId !== current.id) return;
    strokes.push(current);
    current = null;
    undoBtn.disabled = false;
    redoBtn.disabled = true;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  undoBtn.onclick = () => {
    if (!strokes.length) return;
    redo.push(strokes.pop());
    redraw();
  };
  redoBtn.onclick = () => {
    if (!redo.length) return;
    strokes.push(redo.pop());
    redraw();
  };

  // ---------------------------------------------------------------- tools
  const toolRow = h('div', { class: 'sketch-row' });
  const colorRow = h('div', { class: 'sketch-row sketch-colors' });
  function drawTools() {
    toolRow.replaceChildren(...[
      h('button', { class: `sketch-tool${tool === 'pen' ? ' is-on' : ''}`, onclick: () => { tool = 'pen'; drawTools(); } }, icon('pen', 20), h('span', null, 'Pen')),
      h('button', { class: `sketch-tool${tool === 'eraser' ? ' is-on' : ''}`, onclick: () => { tool = 'eraser'; drawTools(); } }, icon('eraser', 20), h('span', null, 'Eraser')),
      h('span', { class: 'fmt-sep' }),
      ...SIZES.map((sz, i) => h('button', {
        class: `sketch-size${i === sizeIdx ? ' is-on' : ''}`, 'aria-label': `Size ${i + 1}`,
        onclick: () => { sizeIdx = i; drawTools(); },
      }, h('span', { style: { width: `${4 + i * 5}px`, height: `${4 + i * 5}px` } }))),
      guide ? h('span', { class: 'fmt-sep' }) : null,
      guide ? h('button', { class: `sketch-tool${showGuide ? ' is-on' : ''}`, onclick: () => { showGuide = !showGuide; guide.style.opacity = showGuide ? '' : '0'; drawTools(); } }, icon('eye', 20), h('span', null, 'Picture')) : null,
      h('button', {
        class: 'sketch-tool', onclick: async () => {
          if (!strokes.length && !baseImg) return;
          if (await confirmDialog({ title: 'Clear the drawing?', okLabel: 'Clear', danger: true })) {
            baseImg = null;
            strokes.length = 0;
            redo.length = 0;
            redraw();
          }
        },
      }, icon('trash', 20), h('span', null, 'Clear')),
    ].filter(Boolean));
    colorRow.replaceChildren(...COLORS.map((c) => h('button', {
      class: `sketch-color${c === color && tool === 'pen' ? ' is-on' : ''}`, style: { background: c }, 'aria-label': `Colour ${c}`,
      onclick: () => { color = c; tool = 'pen'; drawTools(); },
    })));
  }
  drawTools();

  const changed = () => strokes.length > 0 || (baseImg === null && !!baseUrl);

  return openFull((close) => {
    const save = () => canvas.toBlob((blob) => close(blob), 'image/png');
    const cancel = async () => {
      if (!changed() || await confirmDialog({ title: 'Discard this drawing?', message: 'Your changes to the drawing will be lost.', okLabel: 'Discard', danger: true })) close(null);
    };
    const root = h('div', { class: 'sketch' },
      h('header', { class: 'appbar' },
        h('button', { class: 'icon-btn', 'aria-label': 'Cancel', onclick: cancel }, icon('close')),
        h('div', { class: 'appbar-title' }, h('h1', null, title)),
        h('div', { class: 'appbar-actions' }, undoBtn, redoBtn,
          h('button', { class: 'btn btn-primary btn-small sketch-done', onclick: save }, icon('check', 18), 'Done'))),
      stage,
      h('div', { class: 'sketch-tools' }, toolRow, colorRow));
    requestAnimationFrame(() => {
      fit();
      window.addEventListener('resize', fit);
    });
    if (baseUrl) {
      const img = new Image();
      img.onload = () => {
        baseImg = img;
        redraw();
      };
      img.src = baseUrl;
    }
    redraw();
    root.cancel = cancel;
    return root;
  }, {
    onDismiss: (close) => {
      if (!changed()) close(null);
      else confirmDialog({ title: 'Discard this drawing?', message: 'Your changes to the drawing will be lost.', okLabel: 'Discard', danger: true })
        .then((ok) => ok && close(null));
    },
  }).then((r) => {
    window.removeEventListener('resize', fit);
    return r || null;
  });
}
