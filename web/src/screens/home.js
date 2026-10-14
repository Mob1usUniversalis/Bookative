import { h, icon, fmtNum, plural, fmtDate, fmtRelative } from '../util.js';
import { getProject, touch, listSnapshots, readSnapshot, restoreSnapshot, deleteProject, metaOf } from '../store.js';
import {
  projectWords, writtenToday, findScene, sceneLabel, chapterLabel, sceneText, aggregate, characterStatus,
  ARCH_ITEMS, LANGUAGES, deadlineInfo, allScenes,
} from '../model.js';
import { screen, sectionTitle, list, row, textField, confirmDialog, toast, segmented } from '../ui.js';
import { go, rerender } from '../router.js';
import { htmlToText } from '../text.js';
import { saveProjectBackup, sendProjectBackup } from '../backup.js';
import { isComic } from '../model.js';
import { PAGE_FORMATS, comicStats, findPage, pageWords, ratioOf } from '../comic/model.js';
import { pageThumb } from '../comic/thumbs.js';

function lastLines(html, n = 160) {
  const t = htmlToText(html).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return '…' + t.slice(-n).replace(/^\S*\s/, '');
}

export function homeScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const words = projectWords(p);
  const today = writtenToday(p);
  const goal = p.goal.words || 0;
  const pct = goal ? Math.min(100, (words / goal) * 100) : 0;
  const scenes = allScenes(p);
  const dl = deadlineInfo(p);

  const comic = isComic(p);
  const cs = comic ? comicStats(p) : null;
  let tally;
  if (comic) {
    tally = cs.pages ? `${plural(cs.pages, 'page')} and ${plural(cs.words, 'word')} of lettering so far` : 'No pages yet';
    if (today) tally += `, ${fmtNum(today)} words today`;
  } else {
    tally = words ? `${plural(words, 'word')} so far` : 'No words yet';
    if (today) tally += `, ${fmtNum(today)} of them today`;
  }
  tally += '.';
  const hero = h('section', { class: 'hero' },
    h('h1', { class: 'hero-title', onclick: () => go(`${base}/info`) }, p.title || 'Untitled'),
    p.author ? h('p', { class: 'hero-author' }, p.author) : null,
    h('p', { class: 'hero-tally' }, tally),
    comic ? null : goal
      ? h('div', { class: 'goal' },
          h('div', { class: 'ink-rule', role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            h('span', { style: { width: pct + '%' } })),
          h('p', { class: 'goal-text' },
            `${Math.floor(pct)}% of ${fmtNum(goal)} words`,
            dl ? (dl.days > 0 ? `; ${fmtNum(dl.perDay)} a day reaches it by ${fmtDate(p.goal.deadline)}` : '; the deadline has passed') : ''))
      : h('button', { class: 'link small', onclick: () => go(`${base}/info`) }, 'Set a word goal'));

  let continueCard = null;
  const last = !comic && p.lastScene && findScene(p.lastScene, p);
  const lastPage = comic && ((p.lastPage && findPage(p.lastPage, p)) || null);
  if (lastPage) {
    continueCard = h('button', { class: 'index-card continue continue-page', onclick: () => go(`${base}/pg/${lastPage.page.id}`) },
      pageThumb(h('span', { class: 'page-thumb mini', style: { aspectRatio: `1 / ${ratioOf(p)}` } }), p, lastPage.page),
      h('span', { class: 'continue-text' },
        h('span', { class: 'card-kicker' }, 'Continue the comic'),
        h('span', { class: 'card-title' }, `Page ${lastPage.number}`),
        h('span', { class: 'card-sub' }, `${chapterLabel(lastPage.chapter, p)}, ${plural(lastPage.page.panels.length, 'panel')}, ${plural(pageWords(lastPage.page), 'word')}`)));
  } else if (last) {
    const text = sceneText(last.scene);
    continueCard = h('button', { class: 'index-card continue', onclick: () => go(`${base}/sc/${last.scene.id}`) },
      h('span', { class: 'card-kicker' }, 'Continue writing'),
      h('span', { class: 'card-title' }, sceneLabel(last.scene, last.chapter, p)),
      h('span', { class: 'card-sub' }, chapterLabel(last.chapter, p)),
      text ? h('span', { class: 'card-lines' }, lastLines(text)) : null);
  } else if (!p.chapters.length) {
    continueCard = h('button', { class: 'index-card continue', onclick: () => go(`${base}/chapters`) },
      h('span', { class: 'card-kicker' }, 'First page'),
      h('span', { class: 'card-title' }, 'Add your first chapter'),
      h('span', { class: 'card-lines' }, comic
        ? 'Chapters hold pages. Each page has a layout of panels for pictures, drawings and lettering.'
        : 'Chapters hold scenes. Each scene is written, tagged and revised on its own.'));
  }
  const pageStatus = comic ? aggregate(p.chapters.flatMap((c) => c.pages.map((x) => x.status))) : null;

  const archStatus = aggregate([
    ...ARCH_ITEMS.map((a) => p.architecture[a.key].status),
    ...p.strands.map((s) => s.status || 'todo'),
  ]);
  const mains = p.characters.filter((c) => c.kind === 'main').length;
  const secondary = p.characters.length - mains;
  const dated = scenes.filter((x) => x.scene.time).length;
  const sceneStatus = aggregate(scenes.map((x) => x.scene.status));

  return screen({
    title: '',
    actions: [
      { icon: 'search', label: 'Search', onClick: () => go(`${base}/search`) },
      { icon: 'info', label: 'Project details', onClick: () => go(`${base}/info`) },
    ],
    className: 'screen-home',
    body: [
      hero,
      continueCard,
      sectionTitle('Write'),
      list([
        row({
          lead: icon('book'), title: 'Chapters',
          sub: p.chapters.length ? `${plural(p.chapters.length, 'chapter')}, ${comic ? plural(cs.pages, 'page') : plural(scenes.length, 'scene')}` : 'No chapters yet',
          status: comic ? (cs.pages ? pageStatus : null) : scenes.length ? sceneStatus : null, onClick: () => go(`${base}/chapters`),
        }),
        row({ lead: icon('note'), title: 'Notes', sub: p.notes.length ? plural(p.notes.length, 'note') : 'Ideas, research, loose ends', onClick: () => go(`${base}/notes`) }),
      ]),
      sectionTitle('Plan'),
      list([
        row({ lead: icon('arch'), title: 'Architecture', sub: `Premise, fabula, setting${p.strands.length ? `, ${plural(p.strands.length, 'strand')}` : ''}`, status: archStatus, onClick: () => go(`${base}/arch`) }),
        row({
          lead: icon('users'), title: 'Characters',
          sub: p.characters.length ? `${fmtNum(mains)} main, ${fmtNum(secondary)} secondary` : 'No characters yet',
          status: p.characters.length ? aggregate(p.characters.map(characterStatus)) : null,
          onClick: () => go(`${base}/chars`),
        }),
        row({ lead: icon('place'), title: 'Locations', sub: p.locations.length ? plural(p.locations.length, 'place') : 'No locations yet', onClick: () => go(`${base}/locs`) }),
        row({ lead: icon('object'), title: 'Objects', sub: p.objects.length ? plural(p.objects.length, 'object') : 'Things that matter to the plot', onClick: () => go(`${base}/objs`) }),
      ]),
      sectionTitle('Review'),
      list([
        row({ lead: icon('read'), title: comic ? 'Read the comic' : 'Read the book', sub: comic ? 'Page by page, as a reader sees it' : 'As turning pages, with your pictures', onClick: () => go(`${base}/read`) }),
        row({ lead: icon('timeline'), title: 'Timeline', sub: dated ? `${plural(dated, 'dated scene')}${p.events.length ? `, ${plural(p.events.length, 'event')}` : ''}` : 'Give scenes a date to see them in order', onClick: () => go(`${base}/timeline`) }),
        row({ lead: icon('chart'), title: 'Analysis', sub: comic ? 'Pages, panels, lettering, who appears where' : 'Length, presence, point of view', onClick: () => go(`${base}/analysis`) }),
        row({ lead: icon('download'), title: 'Export', sub: comic ? 'Comic PDF, CBZ, script' : 'PDF, Word, EPUB, HTML, Markdown, text', onClick: () => go(`${base}/export`) }),
      ]),
    ],
  });
}

export function projectInfoScreen() {
  const p = getProject();
  const set = (fn) => (v) => {
    fn(v);
    touch();
  };
  const snaps = listSnapshots(p.id);
  const lang = h('select', {
    class: 'field-input',
    onchange: (e) => { p.language = e.target.value; touch(); },
  }, LANGUAGES.map(([v, l]) => h('option', { value: v, selected: v === p.language }, l)));

  const snapRows = snaps.map((s) => {
    const snap = readSnapshot(s.file);
    const m = snap ? metaOf(snap) : null;
    return row({
      lead: icon('restore'),
      title: s.beforeRestore ? `Before restoring, ${fmtDate(s.day)}` : `Start of ${fmtDate(s.day)}`,
      sub: m ? `${plural(m.words, 'word')}, ${plural(m.chapters, 'chapter')}` : 'Unreadable',
      onClick: async () => {
        if (!snap) return;
        const ok = await confirmDialog({
          title: 'Restore this snapshot?',
          message: 'The project goes back to this version. Its current state is kept as a snapshot, so you can return to it.',
          okLabel: 'Restore',
        });
        if (ok && restoreSnapshot(s.file)) {
          toast('Snapshot restored');
          rerender();
        }
      },
    });
  });

  const comic = isComic(p);
  const fmt = h('select', {
    class: 'field-input',
    onchange: (e) => { p.comic.format = e.target.value; touch(); },
  }, Object.entries(PAGE_FORMATS).map(([k, f]) => h('option', { value: k, selected: k === p.comic.format }, f.label)));
  const toggle = (label, sub, get, setv) => h('label', { class: 'setting setting-toggle' },
    h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), sub ? h('small', null, sub) : null),
    h('input', { type: 'checkbox', class: 'switch', checked: !!get(), onchange: (e) => { setv(e.target.checked); touch(); } }));

  return screen({
    title: 'Project details',
    body: [
      sectionTitle('View'),
      h('div', { class: 'setting' }, h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, 'Work on it as'),
        h('small', null, comic ? 'Chapters hold pages of panels. Scenes you wrote are kept and come back in book view.' : 'Chapters hold scenes of prose. Comic pages you made are kept and come back in comic view.')),
      segmented([['book', 'Book'], ['comic', 'Comic']], p.mode, (v) => { p.mode = v; touch(); rerender(); })),
      comic ? [
        h('div', { class: 'form' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Page format'), fmt,
            h('span', { class: 'field-hint' }, 'Panels and lettering keep their places when you change it.'))),
        toggle('Read right to left', 'For manga: page order and swiping are reversed in the reader and CBZ.', () => p.comic.rtl, (v) => (p.comic.rtl = v)),
        toggle('Lettering in capitals', 'The comic convention; turn it off to letter in mixed case.', () => p.comic.caps, (v) => (p.comic.caps = v)),
      ] : null,
      sectionTitle('About the project'),
      h('div', { class: 'form' },
        textField({ label: 'Title', value: p.title, onInput: set((v) => (p.title = v)) }),
        textField({ label: 'Author', value: p.author, onInput: set((v) => (p.author = v)) }),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Language of the text'), lang,
          h('span', { class: 'field-hint' }, 'Used for spell check, hyphenation and exported files.'))),
      sectionTitle('Goals'),
      h('div', { class: 'form' },
        textField({ label: comic ? 'Word goal (prose and lettering)' : 'Word goal for the novel', type: 'number', value: p.goal.words || '', placeholder: 'e.g. 80000', onInput: set((v) => (p.goal.words = Math.max(0, parseInt(v, 10) || 0))) }),
        textField({ label: 'Deadline', type: 'date', value: p.goal.deadline || '', onInput: set((v) => (p.goal.deadline = v)), hint: 'With a goal and a deadline, the overview shows how much to write each day.' })),
      sectionTitle('Daily snapshots'),
      snaps.length
        ? list(snapRows)
        : h('p', { class: 'muted small pad' }, 'Each day you work on the project, Bookative keeps a copy of how it looked before your first change. The last five days are kept.'),
      sectionTitle('Project file'),
      list([
        row({ lead: icon('download'), title: 'Save a backup file', sub: 'One file with the text and pictures', onClick: () => saveProjectBackup(p.id) }),
        row({ lead: icon('share'), title: 'Send to another device', sub: 'Quick Share, Bluetooth, a messenger or e-mail; open it there with Bookative', onClick: () => sendProjectBackup(p.id) }),
        row({
          lead: icon('trash'), title: 'Delete project', className: 'is-danger',
          sub: `Created ${fmtDate(p.createdAt)}, edited ${fmtRelative(p.updatedAt)}`,
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Delete “${p.title}”?`,
              message: 'The project and its snapshots are removed from this device. This cannot be undone.',
              okLabel: 'Delete', danger: true,
            });
            if (ok) {
              deleteProject(p.id);
              toast('Project deleted');
              go('/');
            }
          },
        }),
      ]),
    ],
  });
}

