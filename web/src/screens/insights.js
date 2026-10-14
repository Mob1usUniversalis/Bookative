import { h, icon, uid, fmtNum, plural, fmtStoryTime, debounce, todayKey } from '../util.js';
import { getProject, touch } from '../store.js';
import {
  allScenes, sceneLabel, chapterLabel, sceneText, chapterWords, findById, POV, POV_LABEL, locationLabel,
  ARCH_ITEMS, ensureSections, STATUS_LABEL,
} from '../model.js';
import { CHARACTER_SECTIONS } from '../questions.js';
import { screen, sectionTitle, list, row, empty, formDialog, actionSheet, statusDot, segmented } from '../ui.js';
import { go, rerender } from '../router.js';
import { htmlToText } from '../text.js';
import { isComic } from '../model.js';
import { allPages, comicStats, pageWords, pageCharacters, letteringOf, LETTERING } from '../comic/model.js';
import { countWords } from '../text.js';

// ---------------------------------------------------------------- timeline

async function editEvent(p, ev) {
  const r = await formDialog({
    title: ev ? 'Edit event' : 'New event',
    okLabel: ev ? 'Save' : 'Add',
    fields: [
      { key: 'title', label: 'What happens', value: ev ? ev.title : '', placeholder: 'e.g. The war ends', autofocus: true },
      { key: 'time', label: 'Date and time', type: 'datetime', value: ev ? ev.time : '' },
    ],
  });
  if (!r) return;
  if (!r.time) r.time = new Date().toISOString().slice(0, 16);
  if (ev) Object.assign(ev, r);
  else p.events.push({ id: uid(), title: r.title || 'Untitled event', time: r.time });
  touch();
  rerender();
}

export function timelineScreen() {
  const p = getProject();
  const base = `/p/${p.id}`;
  const scenes = allScenes(p);
  const dated = scenes.filter((x) => x.scene.time).map((x) => ({ time: x.scene.time, kind: 'scene', ...x }));
  const events = p.events.map((ev) => ({ time: ev.time, kind: 'event', ev }));
  const items = [...dated, ...events].sort((a, b) => a.time.localeCompare(b.time));
  const undated = scenes.filter((x) => !x.scene.time);

  const groups = [];
  for (const it of items) {
    const day = it.time.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }

  const body = [];
  if (!items.length) {
    body.push(empty({
      icon: 'timeline',
      title: 'Nothing on the timeline yet',
      text: 'Give a scene a date in its details, or add events that happen off the page, to see the story in chronological order.',
      action: { label: 'Add an event', onClick: () => editEvent(p) },
    }));
  } else {
    body.push(h('div', { class: 'timeline' }, groups.map((g) =>
      h('section', { class: 'tl-day' },
        h('h2', { class: 'tl-date' }, fmtStoryTime(g.day)),
        g.items.map((it) => {
          const time = it.time.includes('T') ? it.time.split('T')[1].slice(0, 5) : '';
          if (it.kind === 'scene') {
            return h('button', { class: 'tl-item', onclick: () => go(`${base}/sc/${it.scene.id}`) },
              h('span', { class: 'tl-time' }, time),
              h('span', { class: 'tl-body' },
                h('span', { class: 'tl-title' }, sceneLabel(it.scene, it.chapter, p)),
                h('span', { class: 'tl-sub' }, chapterLabel(it.chapter, p))),
              statusDot(it.scene.status));
          }
          return h('button', {
            class: 'tl-item tl-event',
            onclick: async () => {
              const k = await actionSheet({ title: it.ev.title, items: [{ key: 'edit', label: 'Edit event', icon: 'edit' }, { key: 'delete', label: 'Delete event', icon: 'trash', danger: true }] });
              if (k === 'edit') editEvent(p, it.ev);
              if (k === 'delete') {
                p.events.splice(p.events.indexOf(it.ev), 1);
                touch();
                rerender();
              }
            },
          },
          h('span', { class: 'tl-time' }, time),
          h('span', { class: 'tl-body' }, h('span', { class: 'tl-title' }, it.ev.title), h('span', { class: 'tl-sub' }, 'Event off the page')));
        })))));
  }
  if (undated.length && items.length) {
    body.push(sectionTitle(`${plural(undated.length, 'scene')} without a date`));
    body.push(list(undated.slice(0, 50).map(({ scene, chapter }) =>
      row({ title: sceneLabel(scene, chapter, p), sub: chapterLabel(chapter, p), onClick: () => go(`${base}/sc/${scene.id}/details`) }))));
  }

  return screen({
    title: 'Timeline',
    body,
    fab: items.length ? { label: 'Add an event', onClick: () => editEvent(p) } : null,
  });
}

// ---------------------------------------------------------------- analysis

let presenceTab = 'chars';

function bars(rows, max, onClick) {
  return h('div', { class: 'bars' }, rows.map((r) =>
    h(onClick ? 'button' : 'div', { class: 'bar-row', onclick: onClick ? () => onClick(r) : null },
      h('span', { class: 'bar-label' }, r.label),
      h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: max ? `${(r.value / max) * 100}%` : '0' } })),
      h('span', { class: 'bar-value' }, fmtNum(r.value)))));
}

function presence(p, field) {
  const entities = {
    chars: p.characters.map((c) => ({ id: c.id, name: c.name })),
    locs: p.locations.map((l) => ({ id: l.id, name: locationLabel(l) })),
    objs: p.objects.map((o) => ({ id: o.id, name: o.name || 'Unnamed object' })),
    strands: p.strands.map((s) => ({ id: s.id, name: s.title || 'Untitled strand' })),
  }[field];
  if (!entities.length || !p.chapters.length) {
    return h('p', { class: 'muted small pad' }, 'Tag scenes with characters, locations, objects and strands in their details to see who and what appears in each chapter.');
  }
  const has = (sc, id) => (sc[field] || []).includes(id) || (field === 'chars' && sc.povChar === id);
  const head = h('tr', null, h('th', { class: 'sticky' }, ''), p.chapters.map((_, i) => h('th', null, String(i + 1))), h('th', null, 'Scenes'));
  const rowsEl = entities.map((e) => {
    let total = 0;
    const cells = p.chapters.map((ch) => {
      const n = ch.scenes.filter((sc) => has(sc, e.id)).length;
      total += n;
      return h('td', null, n ? h('span', { class: 'cell-on', title: `${n} ${n === 1 ? 'scene' : 'scenes'}` }, n > 1 ? String(n) : '') : h('span', { class: 'cell-off' }));
    });
    return h('tr', null, h('th', { class: 'sticky' }, e.name), cells, h('td', { class: 'total' }, String(total)));
  });
  return h('div', { class: 'matrix-wrap' }, h('table', { class: 'matrix' }, h('thead', null, head), h('tbody', null, rowsEl)));
}

function comicAnalysis(p) {
  const base = `/p/${p.id}`;
  const pages = allPages(p);
  if (!pages.length) {
    return screen({
      title: 'Analysis',
      body: empty({ icon: 'chart', title: 'Nothing to analyse yet', text: 'Lay out a few pages and letter them. Page counts, lettering and who appears where show up here.' }),
    });
  }
  const st = comicStats(p);
  const facts = h('dl', { class: 'facts' },
    [['Pages', fmtNum(st.pages)], ['Panels', fmtNum(st.panels)], ['Panels per page', (st.panels / st.pages).toFixed(1)],
      ['Balloons and captions', fmtNum(st.items)], ['Words of lettering', fmtNum(st.words)],
      ['Words per page', fmtNum(Math.round(st.words / st.pages))]]
      .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));
  const perChapter = p.chapters.map((ch, i) => ({ label: String(i + 1), value: ch.pages.length, id: ch.id }));
  const counts = { completed: 0, tocomplete: 0, todo: 0 };
  pages.forEach((x) => counts[x.page.status || 'todo']++);
  const statusEl = h('div', { class: 'status-split' },
    h('div', { class: 'split-bar' }, ['completed', 'tocomplete', 'todo'].map((k) =>
      counts[k] ? h('span', { class: `seg seg-${k}`, style: { flexGrow: counts[k] } }) : null)),
    h('div', { class: 'split-legend' }, ['completed', 'tocomplete', 'todo'].map((k) =>
      h('span', null, statusDot(k), `${STATUS_LABEL[k]}: ${counts[k]}`))));
  const byChar = new Map();
  const kinds = new Map();
  for (const { page } of pages) {
    for (const { item } of letteringOf(page)) {
      kinds.set(item.type, (kinds.get(item.type) || 0) + 1);
      if (item.speaker) byChar.set(item.speaker, (byChar.get(item.speaker) || 0) + countWords(item.text || '', true));
    }
  }
  const charRows = [...byChar.entries()]
    .map(([id, w]) => ({ label: findById(p.characters, id)?.name || 'Deleted character', value: w }))
    .sort((a, b) => b.value - a.value);
  // presence: characters per chapter (speakers and tagged characters)
  let matrix = h('p', { class: 'muted small pad' }, 'Choose who speaks in each balloon, or tag characters in Page details, to see who appears where.');
  if (p.characters.length && p.chapters.length) {
    const head = h('tr', null, h('th', { class: 'sticky' }, ''), p.chapters.map((_, i) => h('th', null, String(i + 1))), h('th', null, 'Pages'));
    const body = p.characters.map((c) => {
      let total = 0;
      const cells = p.chapters.map((ch) => {
        const n = ch.pages.filter((pg) => pageCharacters(pg).includes(c.id)).length;
        total += n;
        return h('td', null, n ? h('span', { class: 'cell-on' }, n > 1 ? String(n) : '') : h('span', { class: 'cell-off' }));
      });
      return h('tr', null, h('th', { class: 'sticky' }, c.name), cells, h('td', { class: 'total' }, String(total)));
    });
    matrix = h('div', { class: 'matrix-wrap' }, h('table', { class: 'matrix' }, h('thead', null, head), h('tbody', null, body)));
  }
  const busiest = [...pages].sort((a, b) => pageWords(b.page) - pageWords(a.page)).slice(0, 5)
    .filter((x) => pageWords(x.page) > 0)
    .map((x) => ({ label: `p. ${x.number}`, value: pageWords(x.page), id: x.page.id }));
  return screen({
    title: 'Analysis',
    body: [
      facts,
      sectionTitle('Pages per chapter'),
      bars(perChapter, Math.max(1, ...perChapter.map((r) => r.value)), (r) => go(`${base}/ch/${r.id}`)),
      sectionTitle('Page status'),
      statusEl,
      sectionTitle('Lettering by character, in words'),
      charRows.length ? bars(charRows, Math.max(...charRows.map((r) => r.value))) : h('p', { class: 'muted small pad' }, 'Choose who speaks in each balloon to see this.'),
      busiest.length ? [sectionTitle('Wordiest pages'), h('p', { class: 'muted small pad' }, 'Comic pages usually read best with under about 200 words.'),
        bars(busiest, Math.max(...busiest.map((r) => r.value)), (r) => go(`${base}/pg/${r.id}`))] : null,
      sectionTitle('Who appears where'),
      h('p', { class: 'muted small pad' }, 'Columns are chapters; a mark means the character speaks or is tagged on at least one of its pages.'),
      matrix,
      h('div', { class: 'pov-types' }, [...kinds.entries()].map(([k, n]) => h('span', { class: 'chip' }, `${LETTERING[k] || k}: ${n}`))),
    ],
  });
}

export function analysisScreen() {
  const p = getProject();
  if (isComic(p)) return comicAnalysis(p);
  const base = `/p/${p.id}`;
  const scenes = allScenes(p);
  const words = scenes.reduce((n, x) => n + (x.scene.words || 0), 0);

  if (!scenes.length) {
    return screen({
      title: 'Analysis',
      body: empty({ icon: 'chart', title: 'Nothing to analyse yet', text: 'Write a few scenes and tag them with characters, places and points of view. The numbers appear here.' }),
    });
  }

  const longest = p.chapters.reduce((m, ch) => Math.max(m, chapterWords(ch)), 0);
  const facts = h('dl', { class: 'facts' },
    [['Words', fmtNum(words)], ['Chapters', fmtNum(p.chapters.length)], ['Scenes', fmtNum(scenes.length)],
      ['Average scene', `${fmtNum(Math.round(words / scenes.length))} words`],
      ['Average chapter', `${fmtNum(Math.round(words / Math.max(1, p.chapters.length)))} words`],
      ['Reading time', `about ${fmtNum(Math.max(1, Math.round(words / 250)))} min`]]
      .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));

  // status
  const counts = { completed: 0, tocomplete: 0, todo: 0 };
  scenes.forEach((x) => counts[x.scene.status || 'todo']++);
  const statusEl = h('div', { class: 'status-split' },
    h('div', { class: 'split-bar' }, ['completed', 'tocomplete', 'todo'].map((k) =>
      counts[k] ? h('span', { class: `seg seg-${k}`, style: { flexGrow: counts[k] } }) : null)),
    h('div', { class: 'split-legend' }, ['completed', 'tocomplete', 'todo'].map((k) =>
      h('span', null, statusDot(k), `${STATUS_LABEL[k]}: ${counts[k]}`))));

  // words per day, last 14 days
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = todayKey(d);
    days.push({ k, v: p.stats.days[k] || 0, label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }) });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.v));
  const weekTotal = days.slice(7).reduce((n, d) => n + d.v, 0);
  const daily = h('div', { class: 'daily' },
    h('div', { class: 'cols' }, days.map((d) =>
      h('div', { class: 'col', title: `${d.k}: ${fmtNum(d.v)} words` },
        h('span', { class: 'col-fill', style: { height: `${(d.v / maxDay) * 100}%` } }),
        h('span', { class: 'col-label' }, d.label)))),
    h('p', { class: 'muted small' }, `${plural(weekTotal, 'word')} written in the last 7 days.`));

  // POV
  const povChars = new Map();
  const povTypes = new Map();
  for (const { scene } of scenes) {
    if (scene.povChar) povChars.set(scene.povChar, (povChars.get(scene.povChar) || 0) + (scene.words || 0));
    const k = scene.pov || '';
    povTypes.set(k, (povTypes.get(k) || 0) + 1);
  }
  const povRows = [...povChars.entries()]
    .map(([id, w]) => ({ label: findById(p.characters, id)?.name || 'Deleted character', value: w }))
    .sort((a, b) => b.value - a.value);

  return screen({
    title: 'Analysis',
    body: [
      facts,
      sectionTitle('Chapter length in words'),
      bars(p.chapters.map((ch, i) => ({ label: String(i + 1), value: chapterWords(ch), id: ch.id })), longest, (r) => go(`${base}/ch/${r.id}`)),
      sectionTitle('Scene status'),
      statusEl,
      sectionTitle('Writing in the last 14 days'),
      daily,
      sectionTitle('Who appears where'),
      h('div', { class: 'pad-x' }, segmented([['chars', 'Characters'], ['locs', 'Locations'], ['objs', 'Objects'], ['strands', 'Strands']], presenceTab, (v) => { presenceTab = v; rerender(); })),
      h('p', { class: 'muted small pad' }, 'Columns are chapters; a mark means the entity appears in at least one of its scenes.'),
      presence(p, presenceTab),
      sectionTitle('Point of view'),
      povRows.length
        ? [h('p', { class: 'muted small pad' }, 'Words narrated by each point-of-view character.'), bars(povRows, Math.max(...povRows.map((r) => r.value)))]
        : null,
      h('div', { class: 'pov-types' },
        POV.map((x) => povTypes.get(x.key) ? h('span', { class: 'chip' }, `${x.key ? POV_LABEL[x.key] : 'Not set'}: ${povTypes.get(x.key)}`) : null)),
    ],
  });
}

// ---------------------------------------------------------------- search

let lastQuery = '';

function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + q.length + 70);
  return h('span', { class: 'snippet' },
    (start > 0 ? '…' : '') + text.slice(start, i),
    h('mark', null, text.slice(i, i + q.length)),
    text.slice(i + q.length, end) + (end < text.length ? '…' : ''));
}

function searchProject(p, q) {
  const base = `/p/${p.id}`;
  const results = [];
  const test = (group, title, html, route, extraText = '') => {
    const t = htmlToText(html || '').replace(/\s+/g, ' ');
    const inTitle = (title || '').toLowerCase().includes(q);
    const snip = snippet(t, q) || snippet(extraText, q);
    if (inTitle || snip) results.push({ group, title, snip, route, count: countIn(t, q) });
  };
  for (const { scene, chapter } of allScenes(p)) {
    test('Scenes', sceneLabel(scene, chapter, p), sceneText(scene), `${base}/sc/${scene.id}`);
  }
  p.chapters.forEach((ch) => {
    test('Chapters', chapterLabel(ch, p), (ch.reason.text || '') + ' ' + (ch.notes || ''), `${base}/ch/${ch.id}`);
  });
  for (const a of ARCH_ITEMS) test('Architecture', a.title, p.architecture[a.key].text, `${base}/arch/${a.key}`);
  for (const s of p.strands) test('Architecture', s.title, s.description, `${base}/strands/${s.id}`);
  for (const c of p.characters) {
    let html = (c.description || '') + ' ' + (c.notes || '');
    if (c.kind === 'main') {
      const secs = ensureSections(c);
      for (const def of CHARACTER_SECTIONS) {
        const sec = secs[def.key];
        html += ' ' + (sec.text || '') + ' ' + Object.values(sec.answers || {}).join(' ');
      }
    }
    test('Characters', c.name, html, `${base}/chars/${c.id}`);
  }
  for (const l of p.locations) test('Locations', locationLabel(l), l.description, `${base}/locs/${l.id}`, [l.city, l.state, l.nation].join(' '));
  for (const o of p.objects) test('Objects', o.name, o.description, `${base}/objs/${o.id}`);
  for (const n of p.notes) test('Notes', n.title, n.text, `${base}/notes/${n.id}`);
  for (const { page, number } of allPages(p)) {
    const words = page.panels.map((pn) => [pn.desc || '', ...pn.items.map((it) => it.text || '')].join(' ')).join(' ');
    const esc = words.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    test('Comic pages', `Page ${number}`, `<p>${esc}</p>${page.notes || ''}`, `${base}/pg/${page.id}`);
  }
  return results;
}

function countIn(t, q) {
  let n = 0;
  let i = t.toLowerCase().indexOf(q);
  while (i >= 0) {
    n++;
    i = t.toLowerCase().indexOf(q, i + q.length);
  }
  return n;
}

export function searchScreen() {
  const p = getProject();
  const out = h('div', { class: 'search-results' });
  const input = h('input', {
    class: 'search-input', type: 'search', placeholder: 'Search the whole project', value: lastQuery,
    enterkeyhint: 'search', autocomplete: 'off',
  });
  const run = () => {
    const q = input.value.trim().toLowerCase();
    lastQuery = input.value;
    if (q.length < 2) {
      out.replaceChildren(h('p', { class: 'muted small pad' }, 'Type at least two letters. Bookative searches scenes, chapters, architecture, characters, locations, objects and notes.'));
      return;
    }
    const res = searchProject(p, q);
    if (!res.length) {
      out.replaceChildren(h('p', { class: 'muted pad' }, `Nothing matches “${input.value.trim()}”.`));
      return;
    }
    const groups = new Map();
    for (const r of res) {
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    const total = res.reduce((n, r) => n + r.count, 0);
    out.replaceChildren(
      h('p', { class: 'muted small pad' }, `${plural(total, 'match', 'matches')} in ${plural(res.length, 'place')}`),
      ...[...groups.entries()].map(([g, rs]) => [
        sectionTitle(g),
        list(rs.map((r) => row({ title: r.title || 'Untitled', sub: r.snip, meta: r.count > 1 ? `×${r.count}` : null, onClick: () => go(r.route) }))),
      ]).flat());
  };
  input.addEventListener('input', debounce(run, 200));
  setTimeout(() => input.focus(), 80);
  run();
  return screen({
    title: 'Search',
    body: [h('div', { class: 'search-box' }, icon('search', 20), input), out],
  });
}
