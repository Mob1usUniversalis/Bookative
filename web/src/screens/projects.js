import { h, icon, plural, fmtRelative, uid } from '../util.js';
import {
  listProjects, createProject, deleteProject, readProjectRaw, getSettings, setSettings, flush, rebuildIndex,
} from '../store.js';
import { newProject, LANGUAGES } from '../model.js';
import {
  screen, empty, formDialog, actionSheet, confirmDialog, toast, segmented, sectionTitle, menuButton, list, row,
  progressDialog,
} from '../ui.js';
import { go, rerender } from '../router.js';
import { appVersion, storageInfo, canChooseFolder, chooseFolder, switchStorage } from '../platform.js';
import { applyTheme } from '../theme.js';
import { copyAllImages } from '../images.js';
import {
  importBackupFile, saveProjectBackup, sendProjectBackup, saveLibraryBackup, sendLibraryBackup,
} from '../backup.js';

export async function newProjectFlow() {
  const r = await formDialog({
    title: 'New project',
    okLabel: 'Create',
    fields: [
      { key: 'title', label: 'Title', placeholder: 'Working title', autofocus: true },
      { key: 'mode', label: 'Kind of project', type: 'select', value: 'book', options: [['book', 'Book: chapters and scenes'], ['comic', 'Comic: chapters, pages and panels']], hint: 'You can switch between book and comic view at any time in the project details.' },
      { key: 'author', label: 'Author', placeholder: 'Your name or pen name', value: getSettings().lastAuthor || '' },
      { key: 'language', label: 'Language of the text', type: 'select', value: getSettings().lastLanguage || 'en', options: LANGUAGES },
    ],
  });
  if (!r) return;
  setSettings({ lastAuthor: r.author, lastLanguage: r.language });
  const p = createProject(newProject(r));
  go(`/p/${p.id}`);
}

export async function importFlow() {
  const r = await importBackupFile();
  if (r) rerender();
}

async function backupMenu() {
  const k = await actionSheet({
    title: 'Backups',
    items: [
      { key: 'save', label: 'Back up all projects', icon: 'download', sub: 'One file with every project and its pictures' },
      { key: 'send', label: 'Send all projects to another device', icon: 'share', sub: 'Quick Share, Bluetooth, a messenger or e-mail' },
      { key: 'import', label: 'Import a backup', icon: 'import', sub: 'From this phone or one made on another device' },
    ],
  });
  if (k === 'save') saveLibraryBackup();
  if (k === 'send') sendLibraryBackup();
  if (k === 'import') importFlow();
}

function storageBanner() {
  const info = storageInfo();
  if (info.ok) return null;
  return h('div', { class: 'banner' },
    h('p', null, h('b', null, 'Bookative can’t open its folder. '),
      `${info.label} may have been moved or renamed, the SD card removed, or access withdrawn.`),
    h('div', { class: 'banner-actions' },
      h('button', { class: 'btn btn-text', onclick: () => moveToFolder(false) }, 'Choose the folder again'),
      h('button', { class: 'btn btn-text', onclick: () => useAppStorage(false) }, 'Use app storage')));
}

export function projectsScreen() {
  const items = listProjects();
  const body = [storageBanner()];
  if (!items.length) {
    body.push(empty({
      icon: 'feather',
      title: 'Start your first book or comic',
      text: 'Plan the architecture, interview your characters, map places and objects, then write chapter by chapter, scene by scene, or draw and letter it page by page.',
      action: { label: 'New project', onClick: newProjectFlow },
    }));
    body.push(h('p', { class: 'muted small center' }, 'Moving from another device? ',
      h('button', { class: 'link', onclick: importFlow }, 'Import a backup')));
  } else {
    body.push(h('div', { class: 'shelf' },
      items.map((m) => {
        const comic = m.mode === 'comic';
        const card = h('div', { class: `book${comic ? ' is-comic' : ''}`, role: 'button', tabindex: '0', onclick: () => go(`/p/${m.id}`) },
          h('div', { class: 'book-spine' }),
          h('div', { class: 'book-body' },
            h('h2', { class: 'book-title' }, m.title || 'Untitled'),
            m.author ? h('p', { class: 'book-author' }, m.author) : null,
            h('p', { class: 'book-meta' },
              comic ? `Comic, ${plural(m.pages || 0, 'page')}, ${plural(m.chapters || 0, 'chapter')}` : `${plural(m.words || 0, 'word')}, ${plural(m.chapters || 0, 'chapter')}`,
              h('br'), `Edited ${fmtRelative(m.updatedAt)}`)),
          h('button', {
            class: 'icon-btn book-more', 'aria-label': 'Project options',
            onclick: async (e) => {
              e.stopPropagation();
              const k = await actionSheet({
                title: m.title,
                items: [
                  { key: 'open', label: 'Open', icon: 'book' },
                  { key: 'backup', label: 'Save a backup file', icon: 'download' },
                  { key: 'send', label: 'Send to another device', icon: 'share' },
                  { key: 'dup', label: 'Duplicate', icon: 'copy' },
                  { key: 'delete', label: 'Delete project', icon: 'trash', danger: true },
                ],
              });
              if (k === 'open') go(`/p/${m.id}`);
              if (k === 'backup') saveProjectBackup(m.id);
              if (k === 'send') sendProjectBackup(m.id);
              if (k === 'dup') {
                const p = readProjectRaw(m.id);
                p.id = uid();
                p.title = `${p.title} (copy)`;
                copyAllImages(m.id, p.id);
                createProject(p);
                rerender();
              }
              if (k === 'delete') {
                const ok = await confirmDialog({
                  title: `Delete “${m.title}”?`,
                  message: 'The project, its pictures and its daily snapshots are removed. Save a backup first if you might want it back.',
                  okLabel: 'Delete',
                  danger: true,
                });
                if (ok) {
                  deleteProject(m.id);
                  toast('Project deleted');
                  rerender();
                }
              }
            },
          }, icon('more', 20)));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(`/p/${m.id}`); });
        return card;
      })));
  }

  return screen({
    title: 'Bookative',
    back: false,
    titleClass: 'wordmark',
    actions: [
      menuButton(() => [
        { key: 'backups', label: 'Backups and other devices', icon: 'share', run: backupMenu },
        { key: 'import', label: 'Import a backup', icon: 'import', run: importFlow },
        { key: 'settings', label: 'Settings', icon: 'settings', run: () => go('/settings') },
        { key: 'about', label: 'About Bookative', icon: 'info', run: () => go('/about') },
      ]),
    ],
    body,
    fab: items.length ? { label: 'New project', icon: 'plus', text: 'New project', onClick: newProjectFlow } : null,
    className: 'screen-projects',
  });
}

// ---------------------------------------------------------------- storage location

async function runSwitch(uri, copy, label) {
  flush();
  const dlg = progressDialog(copy ? 'Copying your projects' : 'Switching storage', copy ? 'Preparing…' : '');
  try {
    const r = await switchStorage(uri, copy, (done, total) => dlg.update(`${done} of ${total} files`, total ? done / total : 1));
    setSettings({ lastRoute: '/settings' });
    flush();
    rebuildIndex();
    dlg.close();
    toast(copy && r.copied ? `${plural(r.copied, 'file')} copied to ${label || r.label}` : `Now using ${r.label}`);
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    dlg.close();
    toast(e.message || 'The storage could not be changed');
  }
}

export async function moveToFolder(copy = true) {
  let folder;
  try {
    folder = await chooseFolder();
  } catch (e) {
    toast(e.message);
    return;
  }
  if (!folder) return;
  const mine = listProjects().length;
  const theirs = folder.projects;
  let message = `Projects and pictures will be kept in ${folder.label}.`;
  if (copy && mine) message += ` Your ${plural(mine, 'project')} will be copied there.`;
  if (theirs) message += ` The folder already has ${plural(theirs, 'Bookative project')}; they will appear too. When a project is in both places, the copy edited most recently is kept.`;
  message += ' Pick a folder that a sync app (Syncthing, Nextcloud…) keeps up to date to share projects between devices, but don’t edit the same project on two devices at once.';
  const ok = await confirmDialog({ title: 'Use this folder?', message, okLabel: 'Use this folder' });
  if (ok) runSwitch(folder.uri, copy, folder.label);
}

export async function useAppStorage(copy = true) {
  const info = storageInfo();
  const ok = await confirmDialog({
    title: 'Use app storage?',
    message: copy && info.ok
      ? 'Your projects will be copied from the folder into the app’s private storage on this device. The folder keeps its copy.'
      : 'Bookative will use its private storage on this device again. Projects that are only in the folder stay there.',
    okLabel: 'Use app storage',
  });
  if (ok) runSwitch('', copy && info.ok, 'app storage');
}

export function settingsScreen() {
  const s = getSettings();
  const set = (patch) => {
    setSettings(patch);
    applyTheme();
    rerender();
  };
  const sample = h('div', { class: 'sample prose' },
    h('p', null, 'It was the hour when the lamps came on along the river, and the water carried them away one by one.'),
    h('p', null, 'She closed the notebook, then opened it again.'));

  const stepper = (label, value, min, max, step, fmt, key) =>
    h('div', { class: 'setting' },
      h('span', { class: 'setting-label' }, label),
      h('div', { class: 'stepper' },
        h('button', { class: 'icon-btn', 'aria-label': 'Decrease', onclick: () => set({ [key]: Math.max(min, +(value - step).toFixed(2)) }) }, '−'),
        h('span', { class: 'stepper-value' }, fmt(value)),
        h('button', { class: 'icon-btn', 'aria-label': 'Increase', onclick: () => set({ [key]: Math.min(max, +(value + step).toFixed(2)) }) }, '+')));

  const toggle = (label, sub, key) =>
    h('label', { class: 'setting setting-toggle' },
      h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), sub ? h('small', null, sub) : null),
      h('input', { type: 'checkbox', class: 'switch', checked: !!s[key], onchange: (e) => set({ [key]: e.target.checked }) }));

  const info = storageInfo();
  const storageRows = [
    row({
      lead: icon('library'),
      title: 'Projects are kept in',
      sub: info.ok ? info.label : `${info.label} (can’t be opened right now)`,
      className: info.ok ? '' : 'is-danger',
    }),
  ];
  if (canChooseFolder()) {
    storageRows.push(row({ lead: icon('import'), title: info.kind === 'folder' ? 'Choose another folder' : 'Choose a folder', sub: 'Documents, an SD card or a synced folder', onClick: () => moveToFolder(info.ok) }));
    if (info.kind === 'folder') storageRows.push(row({ lead: icon('restore'), title: 'Use app storage instead', sub: 'Private to Bookative on this device', onClick: () => useAppStorage(true) }));
  }

  return screen({
    title: 'Settings',
    body: [
      sectionTitle('Storage'),
      list(storageRows),
      h('p', { class: 'muted small pad' }, 'Settings like the theme stay on this device. Projects, pictures and daily snapshots go where you choose.'),
      sectionTitle('Backups and other devices'),
      list([
        row({ lead: icon('download'), title: 'Back up all projects', sub: 'One file with every project and its pictures', onClick: saveLibraryBackup }),
        row({ lead: icon('share'), title: 'Send all projects to another device', sub: 'Open the file there with Bookative to import it', onClick: sendLibraryBackup }),
        row({ lead: icon('import'), title: 'Import a backup', sub: 'Made on this or any other device', onClick: importFlow }),
      ]),
      sectionTitle('Appearance'),
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Theme'),
        segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => set({ theme: v }))),
      sectionTitle('Writing'),
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Typeface'),
        segmented([['serif', 'Literata'], ['sans', 'Sans'], ['mono', 'Mono']], s.font, (v) => set({ font: v }))),
      stepper('Text size', s.size, 14, 26, 1, (v) => `${v}px`, 'size'),
      stepper('Line spacing', s.lineHeight, 1.3, 2.2, 0.1, (v) => v.toFixed(1), 'lineHeight'),
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Paragraphs'),
        segmented([['indent', 'Indented'], ['spaced', 'Spaced']], s.para, (v) => set({ para: v }))),
      sample,
      toggle('Spell check', 'Uses the keyboard’s dictionary for the project language.', 'spell'),
      toggle('Keep the screen on while writing', null, 'keepAwake'),
    ],
  });
}

export function aboutScreen() {
  return screen({
    title: 'About',
    body: h('div', { class: 'about' },
      h('h2', { class: 'about-title' }, 'Bookative'),
      h('p', { class: 'muted' }, `Version ${appVersion()}`),
      h('p', null, 'A workbench for writing novels and making comics on Android, modelled on bibisco: plan the architecture of your story, interview your characters, describe places and objects, then write chapter by chapter, scene by scene, or lay out, draw and letter your comic page by page.'),
      h('p', null, 'Projects are saved automatically to app storage or a folder you choose, and Bookative keeps a snapshot of each project for the last five days you worked on it. Backups carry projects and pictures to other devices.'),
      h('p', { class: 'muted small' }, 'Bookative is an independent project and is not affiliated with bibisco or its author. Typefaces: Literata, Balsamiq Sans, Bangers and Russo One (SIL Open Font License). Icons: Lucide (ISC License).')),
  });
}
