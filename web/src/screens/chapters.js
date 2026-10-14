import { h, icon, uid, now, fmtNum, plural, fmtRelative, fmtStoryTime, moveItem, clone, debounce } from '../util.js';
import { getProject, touch, getSettings } from '../store.js';
import {
  newChapter, newScene, chapterStatus, chapterWords, findChapter, findScene, sceneLabel, chapterLabel,
  sceneText, setSceneText, POV, POV_LABEL, findById, locationLabel, locationSub, STATUS_LABEL,
} from '../model.js';
import {
  screen, sectionTitle, list, row, promptDialog, empty, liveStatusChip, statusDot, menuButton, actionSheet,
  openSheet, toast, confirmDialog, checklist, avatar, segmented,
} from '../ui.js';
import { go, rerender, goBack, navigate } from '../router.js';
import { excerpt, countWords, countChars, htmlToText } from '../text.js';
import { richField } from '../editor.js';
import { shareText, keepScreenOn } from '../platform.js';
import { textItemScreen, deleteWithUndo, renameItem } from './common.js';
import { isComic } from '../model.js';
import { addPage } from '../comic/editor.js';
import { pageThumb } from '../comic/thumbs.js';
import { allPages, pageWords, ratioOf } from '../comic/model.js';

let reorderChapters = false;
let reorderScenes = false;

function reorderControls(arr, item) {
  const i = arr.indexOf(item);
  const mk = (dir, ic, label) => h('button', {
    class: 'icon-btn', 'aria-label': label, disabled: dir < 0 ? i === 0 : i === arr.length - 1,
    onclick: (e) => {
      e.stopPropagation();
      if (moveItem(arr, i, i + dir)) {
        touch();
        rerender();
      }
    },
  }, icon(ic, 20));
  return h('span', { class: 'reorder' }, mk(-1, 'up', 'Move up'), mk(1, 'down', 'Move down'));
}

function statusBar(scenes) {
  const n = scenes.length || 1;
  const counts = { completed: 0, tocomplete: 0, todo: 0 };
  scenes.forEach((s) => counts[s.status || 'todo']++);
  return h('span', { class: 'mini-bar', title: `${counts.completed} done, ${counts.tocomplete} in progress, ${counts.todo} to do` },
    ['completed', 'tocomplete', 'todo'].map((k) => counts[k] ? h('span', { class: `seg seg-${k}`, style: { flexGrow: counts[k] / n } }) : null));
}

// ---------------------------------------------------------------- chapters

export async function addChapter(p, open = true) {
  const t = await promptDialog({ title: `Chapter ${p.chapters.length + 1}`, label: 'Title (optional)', placeholder: 'Leave empty to number it only', okLabel: 'Add chapter' });
  if (t == null) return;
  const ch = newChapter(t);
  p.chapters.push(ch);
  touch();
  if (open) go(`/p/${p.id}/ch/${ch.id}`);
  else rerender();
}

export function chaptersScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const add = () => addChapter(p);
  const comic = isComic(p);
  const total = p.chapters.reduce((n, ch) => n + chapterWords(ch), 0);
  const totalPages = p.chapters.reduce((n, ch) => n + ch.pages.length, 0);

  const rows = p.chapters.map((ch, i) => {
    const words = chapterWords(ch);
    const items = comic ? ch.pages : ch.scenes;
    const el = h(reorderChapters ? 'div' : 'button', {
      class: 'chapter-row', type: reorderChapters ? null : 'button',
      onclick: reorderChapters ? null : () => go(`${base}/ch/${ch.id}`),
    },
    h('span', { class: 'chapter-num' }, String(i + 1)),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-title' }, ch.title || `Chapter ${i + 1}`),
      h('span', { class: 'row-sub' }, comic
        ? `${plural(ch.pages.length, 'page')}, ${plural(ch.pages.reduce((n, pg) => n + pg.panels.length, 0), 'panel')}`
        : `${plural(ch.scenes.length, 'scene')}, ${plural(words, 'word')}`),
      items.length ? statusBar(items) : null),
    reorderChapters ? reorderControls(p.chapters, ch) : statusDot(chapterStatus(ch)));
    return el;
  });

  const el = screen({
    title: 'Chapters',
    subtitle: p.chapters.length ? (comic ? `${plural(totalPages, 'page')} in total` : `${plural(total, 'word')} in total`) : null,
    actions: p.chapters.length > 1 ? [
      reorderChapters
        ? h('button', { class: 'btn btn-text', onclick: () => { reorderChapters = false; rerender(); } }, 'Done')
        : { icon: 'reorder', label: 'Reorder chapters', onClick: () => { reorderChapters = true; rerender(); } },
    ] : [],
    body: p.chapters.length
      ? h('div', { class: 'list chapter-list' }, rows)
      : empty({
        icon: comic ? 'comic' : 'book', title: 'No chapters yet',
        text: comic ? 'A chapter (or issue) is a run of pages. Give it a purpose, then lay out its pages one at a time.' : 'A chapter is a group of scenes. Give it a purpose, then write its scenes one at a time.',
        action: { label: 'Add a chapter', onClick: add },
      }),
    fab: p.chapters.length && !reorderChapters ? { label: 'Add a chapter', onClick: add } : null,
  });
  return {
    el,
    cleanup: (redraw) => { if (!redraw) reorderChapters = false; },
    onBack: () => {
      if (!reorderChapters) return false;
      reorderChapters = false;
      rerender();
      return true;
    },
  };
}

export async function addScene(p, ch) {
  const t = await promptDialog({ title: `New scene in ${chapterLabel(ch, p)}`, label: 'Title', placeholder: 'e.g. The letter arrives', okLabel: 'Add scene' });
  if (t == null) return;
  const s = newScene(t);
  ch.scenes.push(s);
  touch();
  go(`/p/${p.id}/sc/${s.id}`);
}

function sceneCard(p, ch, s) {
  const text = sceneText(s);
  const pictures = (text.match(/<img\b/g) || []).length;
  const pov = s.povChar && findById(p.characters, s.povChar);
  const meta = [
    pov ? `${pov.name}’s point of view` : s.pov ? POV_LABEL[s.pov] : '',
    s.time ? fmtStoryTime(s.time) : '',
  ].filter(Boolean);
  return h(reorderScenes ? 'div' : 'button', {
    class: `index-card scene-card status-${s.status}`, type: reorderScenes ? null : 'button',
    onclick: reorderScenes ? null : () => go(`/p/${p.id}/sc/${s.id}`),
  },
  h('span', { class: 'card-head' },
    h('span', { class: 'card-title' }, s.title || `Scene ${ch.scenes.indexOf(s) + 1}`),
    reorderScenes ? reorderControls(ch.scenes, s) : statusDot(s.status)),
  h('span', { class: 'card-lines' }, excerpt(text, 180) || 'Not written yet'),
  h('span', { class: 'card-foot' },
    h('span', null, plural(s.words || 0, 'word') + (pictures ? `, ${plural(pictures, 'picture')}` : '')),
    meta.length ? h('span', null, meta.join(', ')) : null));
}

function pagesSection(p, ch) {
  const numbers = new Map(allPages(p).map((x) => [x.page.id, x.number]));
  const ratio = ratioOf(p);
  if (!ch.pages.length) {
    return [
      sectionTitle('Pages'),
      empty({ icon: 'comic', title: 'No pages yet', text: 'Pick a layout for the first page, then fill its panels with pictures, drawings and lettering.', action: { label: 'Add a page', onClick: () => addPage(p, ch) } }),
    ];
  }
  const cards = ch.pages.map((page) => {
    const n = numbers.get(page.id);
    const thumb = pageThumb(h('span', { class: 'page-thumb', style: { aspectRatio: `1 / ${ratio}` } }), p, page);
    return h(reorderScenes ? 'div' : 'button', {
      class: 'page-card', type: reorderScenes ? null : 'button',
      onclick: reorderScenes ? null : () => go(`/p/${p.id}/pg/${page.id}`),
    },
    thumb,
    h('span', { class: 'page-card-foot' },
      h('span', { class: 'page-num' }, `Page ${n}`),
      reorderScenes ? reorderControls(ch.pages, page) : statusDot(page.status)),
    h('span', { class: 'page-card-sub' }, `${plural(page.panels.length, 'panel')}, ${plural(pageWords(page), 'word')}`));
  });
  return [sectionTitle(plural(ch.pages.length, 'page')), h('div', { class: 'page-grid' }, cards)];
}

export function chapterScreen({ cid }) {
  const p = getProject();
  const ch = findChapter(cid);
  if (!ch) return null;
  const base = `/p/${p.id}`;
  const i = p.chapters.indexOf(ch);
  const words = chapterWords(ch);
  const label = ch.title || `Chapter ${i + 1}`;
  const comic = isComic(p);
  const size = comic ? plural(ch.pages.length, 'page') : plural(words, 'word');

  return {
    el: screen({
      title: label,
      subtitle: ch.title ? `Chapter ${i + 1}, ${size}` : size,
      onTitleClick: () => renameItem(ch, 'title', 'Rename chapter', 'Title'),
      actions: [
        reorderScenes
          ? h('button', { class: 'btn btn-text', onclick: () => { reorderScenes = false; rerender(); } }, 'Done')
          : null,
        menuButton(() => [
          { key: 'rename', label: 'Rename', icon: 'edit', run: () => renameItem(ch, 'title', 'Rename chapter', 'Title') },
          (comic ? ch.pages.length : ch.scenes.length) > 1 && { key: 'reorder', label: comic ? 'Reorder pages' : 'Reorder scenes', icon: 'reorder', run: () => { reorderScenes = true; rerender(); } },
          i > 0 && { key: 'up', label: 'Move chapter earlier', icon: 'up', run: () => { moveItem(p.chapters, i, i - 1); touch(); rerender(); } },
          i < p.chapters.length - 1 && { key: 'down', label: 'Move chapter later', icon: 'down', run: () => { moveItem(p.chapters, i, i + 1); touch(); rerender(); } },
          { key: 'delete', label: 'Delete chapter', icon: 'trash', danger: true, run: async () => {
            if (ch.scenes.some((s) => s.words > 0) || ch.pages.length) {
              const what = [ch.scenes.length ? `${plural(ch.scenes.length, 'scene')} (${plural(words, 'word')})` : '', ch.pages.length ? plural(ch.pages.length, 'page') : ''].filter(Boolean).join(' and ');
              const ok = await confirmDialog({ title: `Delete ${label}?`, message: `Its ${what} are deleted too.`, okLabel: 'Delete', danger: true });
              if (!ok) return;
            }
            deleteWithUndo(p.chapters, ch, 'chapter', { after: goBack });
          } },
        ].filter(Boolean)),
      ],
      body: [
        list([
          row({ lead: icon('target'), title: 'Purpose of the chapter', sub: excerpt(ch.reason.text, 80) || 'Why does this chapter exist? What changes in it?', status: ch.reason.status, onClick: () => go(`${base}/ch/${ch.id}/reason`) }),
          row({ lead: icon('note'), title: 'Chapter notes', sub: excerpt(ch.notes, 80) || 'Reminders, research, things to fix', onClick: () => go(`${base}/ch/${ch.id}/notes`) }),
        ]),
        ...(comic ? pagesSection(p, ch) : [
          sectionTitle(ch.scenes.length ? plural(ch.scenes.length, 'scene') : 'Scenes'),
          ch.scenes.length
            ? h('div', { class: 'card-stack' }, ch.scenes.map((s) => sceneCard(p, ch, s)))
            : empty({ icon: 'pen', title: 'No scenes yet', text: 'Scenes are where the writing happens. Each one has its own text, revisions and tags.', action: { label: 'Add a scene', onClick: () => addScene(p, ch) } }),
        ]),
      ],
      fab: reorderScenes ? null
        : comic ? (ch.pages.length ? { label: 'Add a page', onClick: () => addPage(p, ch) } : null)
          : (ch.scenes.length ? { label: 'Add a scene', onClick: () => addScene(p, ch) } : null),
    }),
    cleanup: (redraw) => { if (!redraw) reorderScenes = false; },
    onBack: () => {
      if (!reorderScenes) return false;
      reorderScenes = false;
      rerender();
      return true;
    },
  };
}

export function chapterFieldScreen({ cid, field }) {
  const p = getProject();
  const ch = findChapter(cid);
  if (!ch || (field !== 'reason' && field !== 'notes')) return null;
  const sub = chapterLabel(ch, p);
  if (field === 'reason') {
    return textItemScreen({
      title: 'Purpose of the chapter',
      subtitle: sub,
      hint: 'Why is this chapter in the book? What does it reveal, and what has changed by its last line?',
      getStatus: () => ch.reason.status,
      onStatus: (s) => { ch.reason.status = s; },
      html: ch.reason.text,
      onChange: (v) => { ch.reason.text = v; if (v && ch.reason.status === 'todo') ch.reason.status = 'tocomplete'; touch(); },
    });
  }
  return textItemScreen({
    title: 'Chapter notes',
    subtitle: sub,
    html: ch.notes,
    onChange: (v) => { ch.notes = v; touch(); },
  });
}

// ---------------------------------------------------------------- scene editor

function moveSceneFlow(p, found) {
  return actionSheet({
    title: 'Move to chapter',
    items: p.chapters.map((c, i) => ({ key: c.id, label: c.title ? `${i + 1}. ${c.title}` : `Chapter ${i + 1}`, checked: c === found.chapter })),
  }).then((k) => {
    if (!k || k === found.chapter.id) return;
    const dest = findChapter(k);
    found.chapter.scenes.splice(found.chapter.scenes.indexOf(found.scene), 1);
    dest.scenes.push(found.scene);
    touch();
    toast(`Moved to ${chapterLabel(dest, p)}`);
    rerender();
  });
}

function revisionsSheet(p, s, onSwitch, beforeChange = () => {}) {
  return openSheet((close) => {
    const rows = s.revisions.map((r, i) => {
      const words = countWords(r.text);
      const current = i === s.rev;
      return h('div', { class: `rev-row${current ? ' is-current' : ''}` },
        h('button', {
          class: 'rev-main',
          onclick: () => {
            if (!current) {
              beforeChange();
              s.rev = i;
              s.words = words;
              touch();
              onSwitch();
            }
            close();
          },
        },
        h('span', { class: 'rev-title' }, `Revision ${i + 1}`, current ? h('span', { class: 'tag' }, 'current') : null),
        h('span', { class: 'rev-sub' }, `${plural(words, 'word')}, started ${fmtRelative(r.created)}`)),
        s.revisions.length > 1 ? h('button', {
          class: 'icon-btn', 'aria-label': `Delete revision ${i + 1}`,
          onclick: async () => {
            const ok = await confirmDialog({ title: `Delete revision ${i + 1}?`, message: `${plural(words, 'word')} will be lost.`, okLabel: 'Delete', danger: true });
            if (!ok) return;
            beforeChange();
            s.revisions.splice(i, 1);
            if (s.rev >= s.revisions.length || s.rev === i) s.rev = s.revisions.length - 1;
            else if (s.rev > i) s.rev--;
            s.words = countWords(sceneText(s));
            touch();
            close();
            onSwitch();
          },
        }, icon('trash', 18)) : null);
    });
    return h('div', null,
      h('h2', { class: 'sheet-title' }, 'Revisions'),
      h('p', { class: 'sheet-hint' }, 'A revision is a separate copy of the scene. Start a new one before a big rewrite; the old version stays here.'),
      h('div', { class: 'rev-list' }, rows),
      h('div', { class: 'sheet-actions' },
        h('button', {
          class: 'btn btn-primary',
          onclick: () => {
            beforeChange();
            s.revisions.push({ id: uid(), text: sceneText(s), created: now() });
            s.rev = s.revisions.length - 1;
            touch();
            toast(`Revision ${s.rev + 1} started from the current text`);
            close();
            onSwitch();
          },
        }, icon('copy', 18), 'Start a new revision')));
  });
}

export function sceneScreen({ sid }) {
  const p = getProject();
  const found = findScene(sid);
  if (!found) return null;
  const { scene: s, chapter: ch } = found;
  const base = `/p/${p.id}`;
  const settings = getSettings();
  p.lastScene = s.id;

  const countEl = h('span', { class: 'count' });
  const updateCount = () => {
    const html = field.el.innerHTML;
    const w = countWords(html);
    countEl.textContent = `${fmtNum(w)} ${w === 1 ? 'word' : 'words'}`;
    countEl.title = `${fmtNum(countChars(html))} characters`;
  };
  const updateCountSoon = debounce(updateCount, 250);

  const field = richField({
    html: sceneText(s),
    lang: p.language,
    placeholder: 'Begin the scene…',
    className: 'prose-page prose-scene',
    onChange: (v) => setSceneText(s, v),
    onInput: updateCountSoon,
  });
  updateCount();

  const pov = s.povChar && findById(p.characters, s.povChar);
  const tags = [
    pov ? `${pov.name}’s POV` : s.pov ? POV_LABEL[s.pov] : null,
    s.time ? fmtStoryTime(s.time) : null,
    s.chars.length ? plural(s.chars.length, 'character') : null,
    s.locs.length ? (s.locs.length === 1 ? locationLabel(findById(p.locations, s.locs[0]) || {}) : plural(s.locs.length, 'location')) : null,
  ].filter(Boolean);

  const toggleFocus = () => {
    document.body.classList.toggle('focus-mode');
    if (document.body.classList.contains('focus-mode')) field.focus();
  };

  const metaStrip = h('div', { class: 'scene-meta' },
    countEl,
    liveStatusChip(() => s.status, (st) => { s.status = st; }),
    h('button', { class: 'chip chip-tags', onclick: () => go(`${base}/sc/${s.id}/details`) },
      icon('tags', 16), h('span', null, tags.length ? tags.join(', ') : 'Add details')),
    s.revisions.length > 1 ? h('button', { class: 'chip', onclick: () => revisionsSheet(p, s, rerender, () => field.flush()) }, icon('history', 16), h('span', null, `Revision ${s.rev + 1} of ${s.revisions.length}`)) : null);

  const exitFocus = h('button', { class: 'focus-exit', 'aria-label': 'Leave focus mode', onclick: toggleFocus }, icon('unfocus', 20));

  if (settings.keepAwake) keepScreenOn(true);

  const el = screen({
    title: sceneLabel(s, ch, p),
    subtitle: chapterLabel(ch, p),
    onTitleClick: () => renameItem(s, 'title', 'Rename scene', 'Title'),
    className: 'screen-text screen-scene',
    actions: [
      { icon: 'tags', label: 'Scene details', onClick: () => go(`${base}/sc/${s.id}/details`) },
      { icon: 'focus', label: 'Focus mode', onClick: toggleFocus },
      menuButton(() => [
        { key: 'rename', label: 'Rename', icon: 'edit', run: () => renameItem(s, 'title', 'Rename scene', 'Title') },
        { key: 'revisions', label: `Revisions (${s.revisions.length})`, icon: 'history', run: () => revisionsSheet(p, s, rerender, () => field.flush()) },
        p.chapters.length > 1 && { key: 'move', label: 'Move to another chapter', icon: 'move', run: () => moveSceneFlow(p, found) },
        { key: 'dup', label: 'Duplicate scene', icon: 'copy', run: () => {
          field.flush();
          const copy = clone(s);
          copy.id = uid();
          copy.title = (s.title || 'Scene') + ' (copy)';
          copy.revisions = [{ id: uid(), text: sceneText(s), created: now() }];
          copy.rev = 0;
          ch.scenes.splice(ch.scenes.indexOf(s) + 1, 0, copy);
          touch();
          go(`${base}/sc/${copy.id}`);
        } },
        { key: 'share', label: 'Share text', icon: 'share', run: () => { field.flush(); shareText(sceneLabel(s, ch, p), htmlToText(sceneText(s))); } },
        { key: 'delete', label: 'Delete scene', icon: 'trash', danger: true, run: async () => {
          if (s.words > 0) {
            const ok = await confirmDialog({ title: 'Delete this scene?', message: `${plural(s.words, 'word')} and all revisions are deleted.`, okLabel: 'Delete', danger: true });
            if (!ok) return;
          }
          // The parent route is looked up from the scene, so navigate explicitly.
          deleteWithUndo(ch.scenes, s, 'scene', { after: () => navigate(`${base}/ch/${ch.id}`, { replace: true, back: true }) });
        } },
      ].filter(Boolean)),
    ],
    body: [
      metaStrip,
      h('div', { class: 'page-sheet scene-sheet' }, field.el),
      exitFocus,
    ],
  });

  // Open straight into writing for a brand-new empty scene.
  if (!s.words && !sceneText(s)) setTimeout(() => field.focus(), 250);

  return {
    el,
    cleanup: () => {
      keepScreenOn(false);
      document.body.classList.remove('focus-mode');
    },
    onBack: () => {
      if (document.body.classList.contains('focus-mode')) {
        toggleFocus();
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------- scene details

export function sceneDetailsScreen({ sid }) {
  const p = getProject();
  const found = findScene(sid);
  if (!found) return null;
  const { scene: s, chapter: ch } = found;
  const toggle = (field) => (id, on) => {
    const arr = s[field];
    const i = arr.indexOf(id);
    if (on && i < 0) arr.push(id);
    if (!on && i >= 0) arr.splice(i, 1);
    touch();
  };

  const timeInput = h('input', {
    type: 'datetime-local', class: 'field-input', value: s.time && s.time.includes('T') ? s.time : s.time ? s.time + 'T00:00' : '',
    onchange: (e) => { s.time = e.target.value; touch(); },
  });

  const povChar = s.povChar && findById(p.characters, s.povChar);
  const povNeedsChar = POV.find((x) => x.key === s.pov)?.needsChar;

  const pickPov = async () => {
    const k = await actionSheet({ title: 'Point of view', items: POV.map((x) => ({ key: x.key || 'none', label: x.label, checked: x.key === s.pov })) });
    if (k == null) return;
    s.pov = k === 'none' ? '' : k;
    if (!POV.find((x) => x.key === s.pov)?.needsChar) s.povChar = '';
    touch();
    rerender();
  };
  const pickPovChar = async () => {
    if (!p.characters.length) {
      toast('Create characters first');
      return;
    }
    const k = await actionSheet({
      title: 'Whose point of view?',
      items: [{ key: 'none', label: 'Nobody in particular', checked: !s.povChar },
        ...p.characters.map((c) => ({ key: c.id, label: c.name, lead: avatar(c, 28), checked: c.id === s.povChar }))],
    });
    if (k == null) return;
    s.povChar = k === 'none' ? '' : k;
    if (s.povChar && !s.chars.includes(s.povChar)) s.chars.push(s.povChar);
    touch();
    rerender();
  };

  const notes = richField({
    html: s.notes || '', lang: p.language, className: 'prose-note',
    placeholder: 'Notes for this scene: what it must achieve, what to fix later…',
    onChange: (v) => { s.notes = v; touch(); },
  });

  return screen({
    title: 'Scene details',
    subtitle: sceneLabel(s, ch, p),
    body: [
      sectionTitle('Status'),
      h('div', { class: 'pad-x' },
        segmented(['todo', 'tocomplete', 'completed'].map((k) => [k, STATUS_LABEL[k]]), s.status, (v) => { s.status = v; touch(); rerender(); })),
      sectionTitle('When it happens'),
      h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date and time in the story'), timeInput,
          h('span', { class: 'field-hint' }, 'Dated scenes appear in the timeline in story order. ',
            s.time ? h('button', { class: 'link', onclick: () => { s.time = ''; touch(); rerender(); } }, 'Clear the date') : null))),
      sectionTitle('Point of view'),
      list([
        row({ lead: icon('eye'), title: 'Narration', sub: POV_LABEL[s.pov || ''], onClick: pickPov, trailing: icon('chevron', 18) }),
        (povNeedsChar || s.povChar) ? row({ lead: povChar ? avatar(povChar, 28) : icon('user'), title: 'Point-of-view character', sub: povChar ? povChar.name : 'Not chosen', onClick: pickPovChar, trailing: icon('chevron', 18) }) : null,
      ]),
      sectionTitle('Characters in the scene'),
      checklist(p.characters.map((c) => ({ id: c.id, label: c.name, lead: avatar(c, 28), sub: c.kind === 'main' ? 'Main' : 'Secondary' })), s.chars, toggle('chars'), 'Create characters to tag them here.'),
      sectionTitle('Locations'),
      checklist(p.locations.map((l) => ({ id: l.id, label: locationLabel(l), sub: locationSub(l) })), s.locs, toggle('locs'), 'Create locations to tag them here.'),
      sectionTitle('Objects'),
      checklist(p.objects.map((o) => ({ id: o.id, label: o.name || 'Unnamed object' })), s.objs, toggle('objs'), 'Create objects to tag them here.'),
      sectionTitle('Narrative strands'),
      checklist(p.strands.map((st) => ({ id: st.id, label: st.title || 'Untitled strand' })), s.strands, toggle('strands'), 'Add narrative strands in Architecture to tag them here.'),
      sectionTitle('Scene notes'),
      h('div', { class: 'note-box' }, notes.el),
      sectionTitle('Chapter'),
      list([row({ lead: icon('book'), title: chapterLabel(ch, p), sub: p.chapters.length > 1 ? 'Tap to move the scene to another chapter' : null, onClick: p.chapters.length > 1 ? () => moveSceneFlow(p, found) : null })]),
    ],
  });
}
