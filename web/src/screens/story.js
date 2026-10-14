import { h, uid, now, fmtRelative } from '../util.js';
import { getProject, touch } from '../store.js';
import { ARCH_ITEMS, findById } from '../model.js';
import { screen, sectionTitle, list, row, promptDialog, empty, menuButton } from '../ui.js';
import { go, goBack } from '../router.js';
import { excerpt } from '../text.js';
import { richField } from '../editor.js';
import { textItemScreen, appearances, deleteWithUndo, renameItem } from './common.js';
import { unlink } from '../model.js';

export function architectureScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const addStrand = async () => {
    const t = await promptDialog({ title: 'New narrative strand', label: 'Name', placeholder: 'e.g. The inheritance dispute', okLabel: 'Add' });
    if (t == null) return;
    const s = { id: uid(), title: t || 'Untitled strand', description: '', status: 'todo' };
    p.strands.push(s);
    touch();
    go(`${base}/strands/${s.id}`);
  };
  return screen({
    title: 'Architecture',
    body: [
      h('p', { class: 'intro' }, 'The structure underneath the novel: what it is about, what happens, and where.'),
      list(ARCH_ITEMS.map((a) => {
        const it = p.architecture[a.key];
        return row({
          title: a.title,
          sub: excerpt(it.text, 90) || a.hint,
          status: it.status,
          onClick: () => go(`${base}/arch/${a.key}`),
        });
      })),
      sectionTitle('Narrative strands', { label: 'Add', icon: 'plus', onClick: addStrand }),
      p.strands.length
        ? list(p.strands.map((s) =>
            row({
              lead: h('span', { class: 'strand-mark' }),
              title: s.title || 'Untitled strand',
              sub: excerpt(s.description, 80) || 'No description yet',
              status: s.status,
              onClick: () => go(`${base}/strands/${s.id}`),
            })))
        : h('p', { class: 'muted small pad' }, 'Strands are the plot lines that run through the book: the main plot, subplots, a love story, a mystery. Tag scenes with them to see how they are woven.'),
    ],
  });
}

export function archItemScreen({ key }) {
  const p = getProject();
  const def = ARCH_ITEMS.find((a) => a.key === key);
  if (!def) return null;
  const it = p.architecture[key];
  return textItemScreen({
    title: def.title,
    hint: def.hint,
    getStatus: () => it.status,
    onStatus: (s) => { it.status = s; },
    html: it.text,
    placeholder: `Write the ${def.title.toLowerCase()}…`,
    onChange: (v) => {
      it.text = v;
      if (it.status === 'todo' && v) it.status = 'tocomplete';
      touch();
    },
  });
}

export function strandScreen({ id }) {
  const p = getProject();
  const s = findById(p.strands, id);
  if (!s) return null;
  return textItemScreen({
    title: s.title || 'Untitled strand',
    subtitle: 'Narrative strand',
    onTitleClick: () => renameItem(s, 'title', 'Rename strand'),
    getStatus: () => s.status,
    onStatus: (v) => { s.status = v; },
    html: s.description,
    placeholder: 'What is this strand about? How does it start, develop and end?',
    onChange: (v) => {
      s.description = v;
      if (s.status === 'todo' && v) s.status = 'tocomplete';
      touch();
    },
    actions: [menuButton(() => [
      { key: 'rename', label: 'Rename', icon: 'edit', run: () => renameItem(s, 'title', 'Rename strand') },
      { key: 'delete', label: 'Delete strand', icon: 'trash', danger: true, run: () => {
        const removedFrom = p.chapters.flatMap((ch) => ch.scenes).filter((sc) => sc.strands.includes(s.id));
        deleteWithUndo(p.strands, s, 'strand', {
          after: () => { unlink('strands', s.id); goBack(); },
          onUndo: () => removedFrom.forEach((sc) => sc.strands.push(s.id)),
        });
      } },
    ])],
    below: appearances('strands', s.id),
  });
}

export function notesScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const add = async () => {
    const t = await promptDialog({ title: 'New note', label: 'Title', placeholder: 'e.g. Research: 1920s trains', okLabel: 'Create' });
    if (t == null) return;
    const n = { id: uid(), title: t, text: '', updated: now() };
    p.notes.unshift(n);
    touch();
    go(`${base}/notes/${n.id}`);
  };
  const notes = [...p.notes].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return screen({
    title: 'Notes',
    body: notes.length
      ? list(notes.map((n) => row({
          title: n.title || 'Untitled note',
          sub: excerpt(n.text, 90) || 'Empty',
          meta: fmtRelative(n.updated),
          onClick: () => go(`${base}/notes/${n.id}`),
        })))
      : empty({ icon: 'note', title: 'No notes yet', text: 'Keep research, ideas and loose threads here, outside the manuscript.', action: { label: 'New note', onClick: add } }),
    fab: notes.length ? { label: 'New note', onClick: add } : null,
  });
}

export function noteScreen({ id }) {
  const p = getProject();
  const n = findById(p.notes, id);
  if (!n) return null;
  const title = h('input', {
    class: 'title-input', value: n.title || '', placeholder: 'Title',
    oninput: (e) => { n.title = e.target.value; n.updated = now(); touch(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); field.focus(); } },
  });
  const field = richField({
    html: n.text,
    lang: p.language,
    placeholder: 'Write your note…',
    className: 'prose-page',
    onChange: (v) => { n.text = v; n.updated = now(); touch(); },
  });
  return screen({
    title: 'Note',
    className: 'screen-text',
    actions: [menuButton(() => [
      { key: 'delete', label: 'Delete note', icon: 'trash', danger: true, run: () => deleteWithUndo(p.notes, n, 'note', { after: goBack }) },
    ])],
    body: [h('div', { class: 'page-sheet' }, title, field.el)],
  });
}

