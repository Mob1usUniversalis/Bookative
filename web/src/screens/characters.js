import { h, icon, uid } from '../util.js';
import { getProject, touch } from '../store.js';
import {
  newCharacter, ensureSections, characterStatus, findById, unlink, allScenes, locationLabel, locationSub,
} from '../model.js';
import { CHARACTER_SECTIONS, SECTION_BY_KEY } from '../questions.js';
import {
  screen, sectionTitle, list, row, formDialog, empty, avatar, segmented, liveStatusChip, menuButton, textField, toast,
} from '../ui.js';
import { go, rerender, goBack } from '../router.js';
import { excerpt, isEmptyHtml } from '../text.js';
import { richField } from '../editor.js';
import { pickPicture, imgSrc } from '../images.js';
import { appearances, deleteWithUndo, renameItem } from './common.js';

let charTab = 'main';

// Keeps scene references to a deleted entity so Undo can restore them.
function deleteEntity(arr, item, field, label) {
  const p = getProject();
  const refs = allScenes(p)
    .map(({ scene }) => ({ scene, inList: (scene[field] || []).includes(item.id), pov: field === 'chars' && scene.povChar === item.id }))
    .filter((r) => r.inList || r.pov);
  deleteWithUndo(arr, item, label, {
    after: () => { unlink(field, item.id); goBack(); },
    onUndo: () => refs.forEach((r) => {
      if (r.inList) r.scene[field].push(item.id);
      if (r.pov) r.scene.povChar = item.id;
    }),
  });
}

async function changeImage(item) {
  let ref;
  try {
    ref = await pickPicture();
  } catch (e) {
    toast(e.message || 'This image couldn’t be added');
    return;
  }
  if (!ref) return;
  item.image = ref;
  touch();
  rerender();
}

function imageHeader(item, label) {
  const pic = h('button', { class: 'portrait', 'aria-label': item.image ? `Change ${label}` : `Add ${label}`, onclick: () => changeImage(item) },
    item.image ? h('img', { src: imgSrc(item.image), alt: '' }) : h('span', { class: 'portrait-empty' }, icon('image', 26), h('span', null, `Add ${label}`)));
  return pic;
}

// ---------------------------------------------------------------- characters

export function charactersScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const add = async () => {
    const r = await formDialog({
      title: 'New character',
      okLabel: 'Create',
      fields: [
        { key: 'name', label: 'Name', autofocus: true },
        { key: 'kind', label: 'Role in the story', type: 'select', value: charTab, options: [['main', 'Main character: full interview'], ['secondary', 'Secondary character: short description']] },
      ],
    });
    if (!r) return;
    const c = newCharacter(r.name || 'Unnamed', r.kind);
    p.characters.push(c);
    charTab = r.kind;
    touch();
    go(`${base}/chars/${c.id}`);
  };
  const shown = p.characters.filter((c) => (charTab === 'main' ? c.kind === 'main' : c.kind !== 'main'));
  const tabs = segmented(
    [['main', `Main (${p.characters.filter((c) => c.kind === 'main').length})`], ['secondary', `Secondary (${p.characters.filter((c) => c.kind !== 'main').length})`]],
    charTab,
    (v) => { charTab = v; rerender(); });

  const rows = shown.map((c) => {
    let sub;
    if (c.kind === 'main') {
      const secs = ensureSections(c);
      const done = CHARACTER_SECTIONS.filter((s) => secs[s.key].status === 'completed').length;
      sub = `${done} of ${CHARACTER_SECTIONS.length} sections done`;
    } else sub = excerpt(c.description, 70) || 'No description yet';
    return row({ lead: avatar(c, 42), title: c.name, sub, status: characterStatus(c), onClick: () => go(`${base}/chars/${c.id}`) });
  });

  return screen({
    title: 'Characters',
    body: [
      h('div', { class: 'tabs-row' }, tabs),
      p.characters.length === 0
        ? empty({ icon: 'users', title: 'No characters yet', text: 'Main characters get a full interview: appearance, psychology, backstory, conflict and arc. Secondary characters get a short description.', action: { label: 'New character', onClick: add } })
        : rows.length ? list(rows) : h('p', { class: 'muted small pad' }, charTab === 'main' ? 'No main characters yet.' : 'No secondary characters yet.'),
    ],
    fab: p.characters.length ? { label: 'New character', onClick: add } : null,
  });
}

export function characterScreen({ id }) {
  const p = getProject();
  const c = findById(p.characters, id);
  if (!c) return null;
  const base = `/p/${p.id}`;
  const menu = menuButton(() => [
    { key: 'rename', label: 'Rename', icon: 'edit', run: () => renameItem(c, 'name', 'Rename character') },
    { key: 'photo', label: c.image ? 'Change picture' : 'Add a picture', icon: 'image', run: () => changeImage(c) },
    c.image && { key: 'nophoto', label: 'Remove picture', icon: 'close', run: () => { c.image = ''; touch(); rerender(); } },
    {
      key: 'kind', label: c.kind === 'main' ? 'Make secondary character' : 'Make main character', icon: 'users',
      run: () => {
        if (c.kind === 'main') {
          c.kind = 'secondary';
          c.status = characterStatus({ ...c, kind: 'main' });
        } else {
          c.kind = 'main';
          ensureSections(c);
        }
        charTab = c.kind;
        touch();
        rerender();
      },
    },
    { key: 'delete', label: 'Delete character', icon: 'trash', danger: true, run: () => deleteEntity(p.characters, c, 'chars', 'character') },
  ].filter(Boolean));

  const header = h('div', { class: 'profile' },
    h('button', { class: 'profile-avatar', 'aria-label': 'Change picture', onclick: () => changeImage(c) }, avatar(c, 84)),
    h('div', { class: 'profile-text' },
      h('h2', { class: 'profile-name', onclick: () => renameItem(c, 'name', 'Rename character') }, c.name),
      h('p', { class: 'muted' }, c.kind === 'main' ? 'Main character' : 'Secondary character')));

  if (c.kind === 'main') {
    const secs = ensureSections(c);
    return screen({
      title: '',
      actions: [menu],
      body: [
        header,
        h('div', { class: 'item-head' }, liveStatusChip(() => characterStatus(c), null),
          h('p', { class: 'hint' }, 'The overall status follows the status of each section.')),
        sectionTitle('Interview'),
        list(CHARACTER_SECTIONS.map((s) => {
          const sec = secs[s.key];
          const answered = sec.mode === 'freetext'
            ? (isEmptyHtml(sec.text) ? 0 : 1)
            : s.questions.filter((_, i) => !isEmptyHtml(sec.answers[i])).length;
          const sub = sec.mode === 'freetext'
            ? (excerpt(sec.text, 60) || s.hint)
            : answered ? `${answered} of ${s.questions.length} questions answered` : s.hint;
          return row({ title: s.title, sub, status: sec.status, onClick: () => go(`${base}/chars/${c.id}/${s.key}`) });
        })),
        list([row({ lead: icon('note'), title: 'Notes', sub: excerpt(c.notes, 70) || 'Anything that does not fit elsewhere', onClick: () => go(`${base}/chars/${c.id}/notes`) })]),
        appearances('chars', c.id),
      ],
    });
  }

  const field = richField({
    html: c.description,
    lang: p.language,
    placeholder: 'Who are they, what do they look like, and what is their role in the story?',
    className: 'prose-page',
    onChange: (v) => {
      c.description = v;
      if (c.status === 'todo' && v) c.status = 'tocomplete';
      touch();
    },
  });
  return screen({
    title: '',
    actions: [menu],
    className: 'screen-text',
    body: [
      header,
      h('div', { class: 'item-head' }, liveStatusChip(() => c.status, (s) => { c.status = s; })),
      h('div', { class: 'page-sheet' }, field.el),
      appearances('chars', c.id),
    ],
  });
}

export function characterSectionScreen({ id, section }) {
  const p = getProject();
  const c = findById(p.characters, id);
  if (!c) return null;

  if (section === 'notes') {
    const field = richField({
      html: c.notes, lang: p.language, className: 'prose-page', placeholder: 'Notes about this character…',
      onChange: (v) => { c.notes = v; touch(); },
    });
    return screen({ title: 'Notes', subtitle: c.name, className: 'screen-text', body: [h('div', { class: 'page-sheet' }, field.el)] });
  }

  const def = SECTION_BY_KEY[section];
  if (!def || c.kind !== 'main') return null;
  const sec = ensureSections(c)[section];
  const promote = () => {
    if (sec.status === 'todo') sec.status = 'tocomplete';
  };

  let body;
  if (sec.mode === 'freetext') {
    const field = richField({
      html: sec.text, lang: p.language, className: 'prose-page',
      placeholder: `Write freely about ${c.name}: ${def.hint.toLowerCase()}`,
      onChange: (v) => { sec.text = v; if (v) promote(); touch(); },
    });
    body = h('div', { class: 'page-sheet' }, field.el);
  } else {
    body = h('div', { class: 'interview' },
      def.questions.map((q, i) => {
        const field = richField({
          html: sec.answers[i] || '',
          lang: p.language,
          className: 'answer',
          placeholder: 'Answer in their voice, or in yours…',
          onChange: (v) => {
            if (v) sec.answers[i] = v;
            else delete sec.answers[i];
            if (v) promote();
            touch();
          },
        });
        return h('div', { class: 'qa' },
          h('p', { class: 'question' }, q),
          field.el);
      }));
  }

  return screen({
    title: def.title,
    subtitle: c.name,
    className: 'screen-text',
    body: [
      h('div', { class: 'item-head' },
        liveStatusChip(() => sec.status, (s) => { sec.status = s; }),
        segmented([['interview', 'Interview'], ['freetext', 'Free text']], sec.mode, (m) => {
          sec.mode = m;
          touch();
          rerender();
        }),
        h('p', { class: 'hint' }, def.hint)),
      body,
    ],
  });
}

// ---------------------------------------------------------------- locations & objects

export function locationsScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const add = async () => {
    const r = await formDialog({
      title: 'New location',
      okLabel: 'Create',
      fields: [
        { key: 'name', label: 'Name', placeholder: 'e.g. The lighthouse', autofocus: true },
        { key: 'city', label: 'Town or city' },
        { key: 'state', label: 'Region' },
        { key: 'nation', label: 'Country' },
      ],
    });
    if (!r) return;
    const l = { id: uid(), name: r.name, city: r.city, state: r.state, nation: r.nation, description: '', image: '', status: 'todo' };
    p.locations.push(l);
    touch();
    go(`${base}/locs/${l.id}`);
  };
  const sorted = [...p.locations].sort((a, b) =>
    (a.nation || '').localeCompare(b.nation || '') || (a.state || '').localeCompare(b.state || '') ||
    (a.city || '').localeCompare(b.city || '') || locationLabel(a).localeCompare(locationLabel(b)));
  return screen({
    title: 'Locations',
    body: sorted.length
      ? list(sorted.map((l) => row({
          lead: l.image ? h('span', { class: 'thumb' }, h('img', { src: imgSrc(l.image), alt: '' })) : h('span', { class: 'thumb' }, icon('place', 20)),
          title: locationLabel(l),
          sub: locationSub(l) || excerpt(l.description, 60) || 'No description yet',
          status: l.status,
          onClick: () => go(`${base}/locs/${l.id}`),
        })))
      : empty({ icon: 'place', title: 'No locations yet', text: 'Describe the places where the story happens: cities, houses, rooms, landscapes.', action: { label: 'New location', onClick: add } }),
    fab: sorted.length ? { label: 'New location', onClick: add } : null,
  });
}

export function locationScreen({ id }) {
  const p = getProject();
  const l = findById(p.locations, id);
  if (!l) return null;
  const set = (k) => (v) => { l[k] = v; touch(); };
  const field = richField({
    html: l.description, lang: p.language, className: 'prose-page',
    placeholder: 'What does it look like, sound like, smell like? What happened here before?',
    onChange: (v) => { l.description = v; if (l.status === 'todo' && v) l.status = 'tocomplete'; touch(); },
  });
  return screen({
    title: locationLabel(l),
    className: 'screen-text',
    actions: [menuButton(() => [
      { key: 'photo', label: l.image ? 'Change picture' : 'Add a picture', icon: 'image', run: () => changeImage(l) },
      l.image && { key: 'nophoto', label: 'Remove picture', icon: 'close', run: () => { l.image = ''; touch(); rerender(); } },
      { key: 'delete', label: 'Delete location', icon: 'trash', danger: true, run: () => deleteEntity(p.locations, l, 'locs', 'location') },
    ].filter(Boolean))],
    body: [
      imageHeader(l, 'a picture'),
      h('div', { class: 'form' },
        textField({ label: 'Name', value: l.name, onInput: set('name') }),
        h('div', { class: 'form-grid' },
          textField({ label: 'Town or city', value: l.city, onInput: set('city') }),
          textField({ label: 'Region', value: l.state, onInput: set('state') })),
        textField({ label: 'Country', value: l.nation, onInput: set('nation') })),
      h('div', { class: 'item-head' }, liveStatusChip(() => l.status, (s) => { l.status = s; })),
      h('div', { class: 'page-sheet' }, field.el),
      appearances('locs', l.id),
    ],
  });
}

export function objectsScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const add = async () => {
    const r = await formDialog({ title: 'New object', okLabel: 'Create', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Grandfather’s pocket watch', autofocus: true }] });
    if (!r) return;
    const o = { id: uid(), name: r.name || 'Unnamed object', description: '', image: '', status: 'todo' };
    p.objects.push(o);
    touch();
    go(`${base}/objs/${o.id}`);
  };
  return screen({
    title: 'Objects',
    body: p.objects.length
      ? list(p.objects.map((o) => row({
          lead: o.image ? h('span', { class: 'thumb' }, h('img', { src: imgSrc(o.image), alt: '' })) : h('span', { class: 'thumb' }, icon('object', 20)),
          title: o.name || 'Unnamed object',
          sub: excerpt(o.description, 70) || 'No description yet',
          status: o.status,
          onClick: () => go(`${base}/objs/${o.id}`),
        })))
      : empty({ icon: 'object', title: 'No objects yet', text: 'Keep track of the things that matter to the plot: a letter, a weapon, a key, an heirloom.', action: { label: 'New object', onClick: add } }),
    fab: p.objects.length ? { label: 'New object', onClick: add } : null,
  });
}

export function objectScreen({ id }) {
  const p = getProject();
  const o = findById(p.objects, id);
  if (!o) return null;
  const field = richField({
    html: o.description, lang: p.language, className: 'prose-page',
    placeholder: 'What is it, where does it come from, and why does it matter?',
    onChange: (v) => { o.description = v; if (o.status === 'todo' && v) o.status = 'tocomplete'; touch(); },
  });
  return screen({
    title: o.name || 'Unnamed object',
    onTitleClick: () => renameItem(o, 'name', 'Rename object'),
    className: 'screen-text',
    actions: [menuButton(() => [
      { key: 'rename', label: 'Rename', icon: 'edit', run: () => renameItem(o, 'name', 'Rename object') },
      { key: 'photo', label: o.image ? 'Change picture' : 'Add a picture', icon: 'image', run: () => changeImage(o) },
      o.image && { key: 'nophoto', label: 'Remove picture', icon: 'close', run: () => { o.image = ''; touch(); rerender(); } },
      { key: 'delete', label: 'Delete object', icon: 'trash', danger: true, run: () => deleteEntity(p.objects, o, 'objs', 'object') },
    ].filter(Boolean))],
    body: [
      o.image ? imageHeader(o, 'a picture') : null,
      h('div', { class: 'item-head' }, liveStatusChip(() => o.status, (s) => { o.status = s; })),
      h('div', { class: 'page-sheet' }, field.el),
      appearances('objs', o.id),
    ],
  });
}

