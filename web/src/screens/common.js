import { h } from '../util.js';
import { getProject, touch } from '../store.js';
import { richField } from '../editor.js';
import { screen, liveStatusChip, toast, sectionTitle, list, row, promptDialog } from '../ui.js';
import { rerender, go } from '../router.js';
import { sceneLabel, chapterLabel, scenesWith } from '../model.js';
import { excerpt } from '../text.js';
import { sceneText, isComic } from '../model.js';
import { allPages, pageCharacters } from '../comic/model.js';

/** Removes `item` from `arr`, offering Undo in a toast. */
export function deleteWithUndo(arr, item, label, { after, onUndo } = {}) {
  const idx = arr.indexOf(item);
  if (idx < 0) return;
  arr.splice(idx, 1);
  touch();
  after && after();
  toast(`Deleted ${label}`, {
    action: 'Undo',
    onAction: () => {
      arr.splice(Math.min(idx, arr.length), 0, item);
      onUndo && onUndo();
      touch();
      rerender();
    },
  });
}

export async function renameItem(obj, key, title, label = 'Name') {
  const v = await promptDialog({ title, label, value: obj[key] || '' });
  if (v == null) return false;
  obj[key] = v;
  touch();
  rerender();
  return true;
}

/**
 * A screen with a status chip, an optional hint and a single rich-text field.
 */
export function textItemScreen({ title, subtitle, hint, getStatus, onStatus, html, onChange, placeholder, actions, below, onTitleClick }) {
  const p = getProject();
  const field = richField({
    html,
    placeholder: placeholder || 'Start writing…',
    lang: p.language,
    onChange,
    className: 'prose-page',
  });
  const head = h('div', { class: 'item-head' },
    getStatus ? liveStatusChip(getStatus, onStatus) : null,
    hint ? h('p', { class: 'hint' }, hint) : null);
  return screen({
    title, subtitle, actions, onTitleClick,
    className: 'screen-text',
    body: [head, h('div', { class: 'page-sheet' }, field.el), below || null],
  });
}

/** List of scenes (or, in a comic, pages) where an entity appears. */
export function appearances(field, id, emptyText) {
  const p = getProject();
  if (isComic(p) && field === 'chars') {
    const pages = allPages(p).filter(({ page }) => pageCharacters(page).includes(id));
    return [
      sectionTitle(pages.length ? `Appears on ${pages.length === 1 ? '1 page' : pages.length + ' pages'}` : 'Appearances'),
      pages.length
        ? list(pages.map(({ page, chapter, number }) => row({
            title: `Page ${number}`,
            sub: chapterLabel(chapter, p),
            status: page.status,
            onClick: () => go(`/p/${p.id}/pg/${page.id}`),
          })))
        : h('p', { class: 'muted small pad' }, 'Choose this character as the speaker of a balloon, or tag them in Page details.'),
    ];
  }
  const found = scenesWith(field, id);
  return [
    sectionTitle(found.length ? `Appears in ${found.length === 1 ? '1 scene' : found.length + ' scenes'}` : 'Appearances'),
    found.length
      ? list(found.map(({ scene, chapter }) =>
          row({
            title: sceneLabel(scene, chapter),
            sub: chapterLabel(chapter, p) + (excerpt(sceneText(scene), 60) ? ' — ' + excerpt(sceneText(scene), 60) : ''),
            status: scene.status,
            onClick: () => go(`/p/${p.id}/sc/${scene.id}`),
          })))
      : h('p', { class: 'muted small pad' }, emptyText || 'Tag scenes in their details to see them here.'),
  ];
}

