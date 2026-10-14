// Backups: one project or the whole library in a single file (pictures included),
// saved anywhere, sent to another device through the share sheet, and imported
// from any device — with a choice when a project already exists here.
import { h, slug, todayKey, uid, fmtRelative, plural } from './util.js';
import { listProjects, readProjectRaw, createProject, migrate, getProject, closeProject } from './store.js';
import { collectRefs, readImageB64, writeImageB64 } from './images.js';
import { saveFile, shareFile, pickFile, readFileText } from './platform.js';
import { actionSheet, toast } from './ui.js';

const MIME = 'application/json';

function entryFor(id) {
  const project = readProjectRaw(id);
  if (!project) return null;
  const images = {};
  for (const name of collectRefs([JSON.stringify(project)])) {
    const b64 = readImageB64(name, id);
    if (b64) images[name] = b64;
  }
  return { project, images };
}

export function projectBackup(id) {
  const e = entryFor(id);
  if (!e) return null;
  return {
    name: `${slug(e.project.title)}-${todayKey()}.bookative.json`,
    text: JSON.stringify({ format: 'bookative-backup', version: 3, exported: new Date().toISOString(), ...e }),
    title: e.project.title,
  };
}

export function libraryBackup() {
  const projects = listProjects().map((m) => entryFor(m.id)).filter(Boolean);
  return {
    name: `bookative-library-${todayKey()}.bookative.json`,
    text: JSON.stringify({ format: 'bookative-library', version: 1, exported: new Date().toISOString(), projects }),
    count: projects.length,
  };
}

async function deliver(b, how, what) {
  if (!b) return;
  if (how === 'share') {
    const ok = await shareFile(b.name, MIME, b.text, what);
    if (!ok) toast('The backup could not be shared');
    return;
  }
  const res = await saveFile(b.name, MIME, b.text);
  if (res.ok) toast('Backup saved');
  else if (res.message !== 'cancelled') toast(`Backup not saved: ${res.message}`);
}

export const saveProjectBackup = (id) => deliver(projectBackup(id), 'save');
export const sendProjectBackup = (id) => {
  const b = projectBackup(id);
  return deliver(b, 'share', b && `Bookative backup: ${b.title}`);
};
export const saveLibraryBackup = () => deliver(libraryBackup(), 'save');
export const sendLibraryBackup = () => deliver(libraryBackup(), 'share', 'Bookative library backup');

/** Reads any Bookative (or older Folio) backup into [{ project, images }]. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Bookative backup.');
  }
  const valid = (p) => p && typeof p === 'object' && Array.isArray(p.chapters) && p.id && p.title;
  let entries;
  if (data && data.format === 'bookative-library' && Array.isArray(data.projects)) {
    entries = data.projects.map((e) => ({ project: e.project, images: e.images || {} }));
  } else if (data && (data.format === 'bookative-backup' || data.format === 'folio-backup')) {
    entries = [{ project: data.project, images: data.images || {} }];
  } else if (valid(data)) {
    entries = [{ project: data, images: {} }];
  } else {
    throw new Error('This file is not a Bookative backup.');
  }
  entries = entries.filter((e) => valid(e.project));
  if (!entries.length) throw new Error('This backup contains no projects.');
  return entries;
}

function store(entry, asCopy) {
  const p = migrate(entry.project);
  if (asCopy) {
    p.id = uid();
    p.title = `${p.title} (copy)`;
  }
  let missing = 0;
  for (const [name, b64] of Object.entries(entry.images || {})) if (!writeImageB64(name, b64, p.id)) missing++;
  if (getProject() && getProject().id === p.id) closeProject();
  // Replacing writes the previous version into today's snapshot first, so it can be restored.
  createProject(p);
  return missing;
}

/** Imports parsed entries, asking what to do with projects that already exist. */
export async function importEntries(entries) {
  const here = new Map(listProjects().map((m) => [m.id, m]));
  const conflicts = entries.filter((e) => here.has(e.project.id));
  let policy = 'replace';
  if (conflicts.length === 1) {
    const e = conflicts[0];
    const mine = here.get(e.project.id);
    const newer = (e.project.updatedAt || '') > (mine.updatedAt || '') ? 'The backup is newer.' : 'The copy on this device is newer.';
    policy = await actionSheet({
      title: `“${e.project.title}” is already here`,
      items: [
        { key: 'replace', label: 'Replace it with the backup', icon: 'restore', sub: `Backup edited ${fmtRelative(e.project.updatedAt)}, this device ${fmtRelative(mine.updatedAt)}. ${newer}` },
        { key: 'copy', label: 'Keep both', icon: 'copy', sub: 'The backup is added as a separate copy' },
        { key: 'skip', label: entries.length > 1 ? 'Skip this project' : 'Cancel', icon: 'close' },
      ],
    });
  } else if (conflicts.length > 1) {
    policy = await actionSheet({
      title: `${conflicts.length} of these projects are already here`,
      items: [
        { key: 'newer', label: 'Keep the newer copy of each', icon: 'history', sub: 'Compares when each project was last edited' },
        { key: 'replace', label: 'Replace them with the backup', icon: 'restore' },
        { key: 'copy', label: 'Keep both copies', icon: 'copy' },
        { key: 'skip', label: 'Skip them', icon: 'close' },
      ],
    });
  }
  if (!policy) return null;
  let imported = 0;
  let skipped = 0;
  let missing = 0;
  for (const e of entries) {
    const mine = here.get(e.project.id);
    if (!mine) {
      missing += store(e, false);
      imported++;
      continue;
    }
    if (policy === 'skip' || (policy === 'newer' && (e.project.updatedAt || '') <= (mine.updatedAt || ''))) {
      skipped++;
      continue;
    }
    missing += store(e, policy === 'copy');
    imported++;
  }
  let msg = imported === 1 && entries.length === 1 ? `Imported “${entries[0].project.title}”` : `Imported ${plural(imported, 'project')}`;
  if (skipped) msg += `, skipped ${skipped}`;
  if (missing) msg += `; ${plural(missing, 'picture')} couldn’t be stored`;
  toast(msg);
  return { imported, skipped };
}

export async function importText(text) {
  try {
    return await importEntries(parseBackup(text));
  } catch (e) {
    toast(e.message || 'Could not import this file');
    return null;
  }
}

export async function importBackupFile() {
  const file = await pickFile('application/json,.json,*/*');
  if (!file) return null;
  return importText(await readFileText(file));
}

/** Small explanation shown on the backup menus. */
export function backupHint() {
  return h('p', { class: 'sheet-hint' },
    'A backup is one file with the text and pictures. Save it, or send it to another phone with Quick Share, Bluetooth or a messenger, then open it there with Bookative.');
}
