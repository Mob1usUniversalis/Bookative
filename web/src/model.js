// Domain helpers: creating entities, looking them up, aggregating status
// and word counts, and the bookkeeping for "words written today".
import { uid, now, todayKey } from './util.js';
import { countWords } from './text.js';
import { CHARACTER_SECTIONS } from './questions.js';
import { getProject, touch } from './store.js';

export const STATUS_LABEL = { todo: 'To do', tocomplete: 'In progress', completed: 'Done' };

export const POV = [
  { key: '', label: 'Not set' },
  { key: 'first', label: 'First person', needsChar: true },
  { key: 'second', label: 'Second person', needsChar: true },
  { key: 'third-limited', label: 'Third person limited', needsChar: true },
  { key: 'third-omniscient', label: 'Third person omniscient' },
  { key: 'third-objective', label: 'Third person objective' },
];
export const POV_LABEL = Object.fromEntries(POV.map((p) => [p.key, p.label]));

export const LANGUAGES = [
  ['en', 'English'], ['ru', 'Russian'], ['kk', 'Kazakh'], ['uk', 'Ukrainian'], ['de', 'German'],
  ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['pl', 'Polish'], ['tr', 'Turkish'], ['cs', 'Czech'], ['sv', 'Swedish'], ['fi', 'Finnish'],
  ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'],
];

export function newProject({ title, author, language, mode }) {
  const t = now();
  return {
    id: uid(),
    schema: 1,
    createdAt: t,
    updatedAt: t,
    title: title || 'Untitled novel',
    author: author || '',
    language: language || 'en',
    goal: { words: 0, deadline: '', daily: 0 },
    architecture: {
      premise: { text: '', status: 'todo' },
      fabula: { text: '', status: 'todo' },
      setting: { text: '', status: 'todo' },
    },
    strands: [],
    characters: [],
    locations: [],
    objects: [],
    chapters: [],
    notes: [],
    events: [],
    stats: { days: {} },
    lastScene: '',
    mode: mode === 'comic' ? 'comic' : 'book',
    comic: { format: 'comic', rtl: false, caps: true },
    lastPage: '',
  };
}

export const isComic = (p = getProject()) => p && p.mode === 'comic';

export const ARCH_ITEMS = [
  { key: 'premise', title: 'Premise', hint: 'The idea behind the story, in a sentence or two. What happens if…?' },
  { key: 'fabula', title: 'Fabula', hint: 'The events of the story in chronological order, as they happen in its world.' },
  { key: 'setting', title: 'Setting', hint: 'Where and when the story takes place: the era, the places, the atmosphere and the rules of its world.' },
];

export function newChapter(title) {
  return { id: uid(), title: title || '', reason: { text: '', status: 'todo' }, notes: '', scenes: [], pages: [] };
}

export function newScene(title) {
  return {
    id: uid(),
    title: title || '',
    status: 'todo',
    revisions: [{ id: uid(), text: '', created: now() }],
    rev: 0,
    words: 0,
    pov: '',
    povChar: '',
    chars: [],
    locs: [],
    objs: [],
    strands: [],
    time: '',
    notes: '',
    updated: now(),
  };
}

export function newCharacter(name, kind = 'main') {
  const c = { id: uid(), kind, name: name || 'Unnamed', image: '', status: 'todo', description: '', notes: '' };
  if (kind === 'main') c.sections = {};
  return c;
}

export function ensureSections(c) {
  c.sections = c.sections || {};
  for (const s of CHARACTER_SECTIONS) {
    if (!c.sections[s.key]) c.sections[s.key] = { mode: 'interview', answers: {}, text: '', status: 'todo' };
  }
  return c.sections;
}

export function characterStatus(c) {
  if (c.kind !== 'main') return c.status || 'todo';
  const secs = ensureSections(c);
  const st = CHARACTER_SECTIONS.map((s) => secs[s.key].status || 'todo');
  return aggregate(st);
}

export function aggregate(statuses) {
  if (!statuses.length) return 'todo';
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.every((s) => s === 'todo')) return 'todo';
  return 'tocomplete';
}

export function chapterStatus(ch, p = getProject()) {
  const items = isComic(p) ? ch.pages || [] : ch.scenes;
  const st = items.map((s) => s.status || 'todo');
  st.push(ch.reason?.status || 'todo');
  return aggregate(st);
}

export const chapterWords = (ch) => ch.scenes.reduce((n, s) => n + (s.words || 0), 0);

export function projectWords(p = getProject()) {
  return p.chapters.reduce((n, ch) => n + chapterWords(ch), 0);
}

export function allScenes(p = getProject()) {
  const out = [];
  p.chapters.forEach((ch, ci) => ch.scenes.forEach((s, si) => out.push({ scene: s, chapter: ch, ci, si })));
  return out;
}

export function findScene(id, p = getProject()) {
  for (let ci = 0; ci < p.chapters.length; ci++) {
    const ch = p.chapters[ci];
    const si = ch.scenes.findIndex((s) => s.id === id);
    if (si >= 0) return { scene: ch.scenes[si], chapter: ch, ci, si };
  }
  return null;
}

export const findChapter = (id, p = getProject()) => p.chapters.find((c) => c.id === id);
export const findById = (list, id) => list.find((x) => x.id === id);

export function sceneText(s) {
  return (s.revisions[s.rev] || s.revisions[0]).text || '';
}

/** Updates a scene's text and the per-day word tally. */
export function setSceneText(s, html) {
  const rev = s.revisions[s.rev];
  if (rev.text === html) return;
  const before = s.words || 0;
  rev.text = html;
  s.words = countWords(html);
  s.updated = now();
  const delta = s.words - before;
  if (delta > 0) addWritten(delta);
  if (s.status === 'todo' && s.words > 0) s.status = 'tocomplete';
  const p = getProject();
  p.lastScene = s.id;
  touch();
}

export function addWritten(n) {
  const p = getProject();
  const k = todayKey();
  p.stats.days[k] = (p.stats.days[k] || 0) + n;
}

export function writtenToday(p = getProject()) {
  return p.stats.days[todayKey()] || 0;
}

export function sceneLabel(s, ch, p = getProject()) {
  if (s.title) return s.title;
  const ci = p.chapters.indexOf(ch);
  const si = ch.scenes.indexOf(s);
  return `Scene ${si + 1}` + (ci >= 0 ? ` of chapter ${ci + 1}` : '');
}

export function chapterLabel(ch, p = getProject()) {
  const i = p.chapters.indexOf(ch);
  return ch.title ? ch.title : `Chapter ${i + 1}`;
}

export function locationLabel(l) {
  return l.name || [l.city, l.state, l.nation].filter(Boolean)[0] || 'Unnamed place';
}

export function locationSub(l) {
  return [l.city, l.state, l.nation].filter((x) => x && x !== l.name).join(', ');
}

/** Scenes that reference an entity in one of the tag lists. */
export function scenesWith(field, id, p = getProject()) {
  return allScenes(p).filter(({ scene }) =>
    field === 'povChar' ? scene.povChar === id : (scene[field] || []).includes(id) || (field === 'chars' && scene.povChar === id));
}

/** Removes references to a deleted entity from every scene. */
export function unlink(field, id, p = getProject()) {
  for (const { scene } of allScenes(p)) {
    if (Array.isArray(scene[field])) scene[field] = scene[field].filter((x) => x !== id);
    if (field === 'chars' && scene.povChar === id) scene.povChar = '';
  }
}

export function deadlineInfo(p = getProject()) {
  const g = p.goal || {};
  if (!g.words || !g.deadline) return null;
  const left = Math.max(0, g.words - projectWords(p));
  const end = new Date(g.deadline + 'T23:59:59');
  const days = Math.ceil((end - new Date()) / 86400000);
  return { left, days, perDay: days > 0 ? Math.ceil(left / days) : left };
}
