import { h, icon, slug } from '../util.js';
import { getProject, getSettings, setSettings } from '../store.js';
import { screen, sectionTitle, segmented, toast, list, row, progressDialog } from '../ui.js';
import { rerender } from '../router.js';
import { buildDoc, toText, toMarkdown, toHtml, toDocx, toEpub, DEFAULT_EXPORT } from '../export.js';
import { saveFile, printHtml, shareFile } from '../platform.js';
import { makeZip } from '../zip.js';
import { flushAllFields } from '../editor.js';
import { saveProjectBackup, sendProjectBackup } from '../backup.js';
import { isComic } from '../model.js';
import { comicPrintHtml, toCbz, buildComicScriptDoc } from '../comic/export.js';
import { allPages } from '../comic/model.js';

const FORMATS = [
  { key: 'pdf', name: 'PDF', desc: 'Opens the print dialog; choose “Save as PDF”' },
  { key: 'docx', name: 'Word', desc: '.docx with headings, pictures and page numbers' },
  { key: 'epub', name: 'EPUB', desc: 'E-book with a table of contents' },
  { key: 'html', name: 'Web page', desc: 'One .html file, pictures included' },
  { key: 'md', name: 'Markdown', desc: '.md; with pictures, a .zip with an images folder' },
  { key: 'txt', name: 'Plain text', desc: '.txt without formatting or pictures' },
];

const COMIC_FORMATS = [
  { key: 'comic-pdf', name: 'Comic PDF', desc: 'Print dialog at the page size; choose “Save as PDF”' },
  { key: 'cbz', name: 'CBZ', desc: 'Comic book archive of page images, for comic reader apps' },
  { key: 'cbz-send', name: 'Send CBZ', desc: 'Share the comic with Quick Share, a messenger…' },
];

function getOpts(comic) {
  const s = getSettings();
  const o = { ...DEFAULT_EXPORT, indent: s.para !== 'spaced', ...(s.exportOpts || {}) };
  if (comic) o.content = (s.exportOpts || {}).comicContent || 'comic';
  else if (!['novel', 'bible', 'everything'].includes(o.content)) o.content = 'novel';
  return o;
}

export function exportScreen() {
  const p = getProject();
  const comic = isComic(p);
  const o = getOpts(comic);
  const set = (patch) => {
    setSettings({ exportOpts: { ...(getSettings().exportOpts || {}), ...patch } });
    rerender();
  };

  const toggle = (label, key) =>
    h('label', { class: 'setting setting-toggle' },
      h('span', { class: 'setting-label' }, label),
      h('input', { type: 'checkbox', class: 'switch', checked: !!o[key], onchange: (e) => set({ [key]: e.target.checked }) }));

  async function runComic(fmt) {
    flushAllFields();
    if (!allPages(p).length) {
      toast('Add pages first');
      return;
    }
    const name = slug(p.title);
    try {
      if (fmt === 'comic-pdf') {
        const { html, size } = await comicPrintHtml(p);
        printHtml(p.title, html, size);
        return;
      }
      const dlg = progressDialog('Drawing the pages', 'Preparing…');
      let zip;
      try {
        zip = await toCbz(p, (done, total) => dlg.update(`Page ${done} of ${total}`, done / total));
      } finally {
        dlg.close();
      }
      if (fmt === 'cbz-send') {
        if (!(await shareFile(`${name}.cbz`, 'application/vnd.comicbook+zip', zip, p.title))) toast('The comic could not be shared');
        return;
      }
      const res = await saveFile(`${name}.cbz`, 'application/vnd.comicbook+zip', zip);
      if (res.ok) toast('Exported');
      else if (res.message !== 'cancelled') toast(`Not exported: ${res.message}`);
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message}`);
    }
  }

  async function run(fmt) {
    flushAllFields();
    let doc;
    let suffix;
    if (comic) {
      doc = o.content === 'script' ? buildComicScriptDoc(p, o) : buildDoc(p, { ...o, content: 'bible' });
      suffix = o.content === 'script' ? '-script' : '-story-notes';
    } else {
      doc = buildDoc(p, o);
      suffix = o.content === 'bible' ? '-story-notes' : o.content === 'everything' ? '-complete' : '';
    }
    const name = slug(p.title) + suffix;
    let res;
    try {
      switch (fmt) {
        case 'pdf':
          printHtml(p.title, toHtml(doc, { forPrint: true }));
          return;
        case 'docx':
          res = await saveFile(`${name}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', toDocx(doc));
          break;
        case 'epub':
          res = await saveFile(`${name}.epub`, 'application/epub+zip', toEpub(doc));
          break;
        case 'html':
          res = await saveFile(`${name}.html`, 'text/html', toHtml(doc));
          break;
        case 'md': {
          const md = toMarkdown(doc);
          if (md.images.length) {
            const zip = makeZip([
              { name: `${name}.md`, data: md.text },
              ...md.images.map((im) => ({ name: `images/${im.name}`, data: im.bytes })),
            ]);
            res = await saveFile(`${name}.zip`, 'application/zip', zip);
          } else {
            res = await saveFile(`${name}.md`, 'text/markdown', md.text);
          }
          break;
        }
        default:
          res = await saveFile(`${name}.txt`, 'text/plain', toText(doc));
      }
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message}`);
      return;
    }
    if (res.ok) toast('Exported');
    else if (res.message !== 'cancelled') toast(`Not exported: ${res.message}`);
  }

  const formatGrid = (formats, fn) => h('div', { class: 'format-grid' }, formats.map((f) =>
    h('button', { class: 'format', onclick: () => fn(f.key) },
      h('span', { class: 'format-name' }, f.name),
      h('span', { class: 'format-desc' }, f.desc))));

  const backup = [
    sectionTitle('Backup'),
    list([
      row({ lead: icon('download'), title: 'Save a backup file', sub: 'The whole project with its pictures, to import on any device', onClick: () => saveProjectBackup(p.id) }),
      row({ lead: icon('share'), title: 'Send to another device', sub: 'Open the file there with Bookative', onClick: () => sendProjectBackup(p.id) }),
    ]),
  ];

  if (comic) {
    const what = o.content;
    return screen({
      title: 'Export',
      body: [
        sectionTitle('What to export'),
        h('div', { class: 'pad-x' },
          segmented([['comic', 'Comic'], ['script', 'Script'], ['bible', 'Story notes']], what, (v) => set({ comicContent: v }))),
        h('p', { class: 'muted small pad' },
          what === 'comic' ? 'The finished pages, as drawn and lettered.'
            : what === 'script' ? 'The comic script: page and panel descriptions with dialogue, captions and sound effects, for an artist or letterer.'
              : 'Architecture, characters with their interviews, locations, objects, chapter plans and notes.'),
        sectionTitle('Format'),
        what === 'comic' ? formatGrid(COMIC_FORMATS, runComic) : formatGrid(FORMATS, run),
        what !== 'comic' ? [sectionTitle('Layout'), toggle('Title page', 'titlePage'), what === 'bible' ? toggle('Pictures', 'images') : null] : null,
        ...backup,
      ],
    });
  }

  const novel = o.content !== 'bible';
  return screen({
    title: 'Export',
    body: [
      sectionTitle('What to export'),
      h('div', { class: 'pad-x' },
        segmented([['novel', 'Novel'], ['bible', 'Story notes'], ['everything', 'Both']], o.content, (v) => set({ content: v }))),
      h('p', { class: 'muted small pad' },
        o.content === 'novel' ? 'The manuscript: chapters and scenes in order.'
          : o.content === 'bible' ? 'Architecture, characters with their interviews, locations, objects, chapter plans and notes.'
            : 'Story notes first, then the manuscript.'),
      sectionTitle('Format'),
      formatGrid(FORMATS, run),
      sectionTitle('Layout'),
      toggle('Title page', 'titlePage'),
      toggle('Pictures', 'images'),
      novel ? [
        h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Chapter headings'),
          segmented([['word', 'Chapter 1'], ['number', '1'], ['roman', 'I'], ['none', 'None']], o.chapterLabel, (v) => set({ chapterLabel: v }))),
        toggle('Chapter titles', 'chapterTitles'),
        toggle('Scene titles', 'sceneTitles'),
        h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Between scenes'),
          segmented([['* * *', '* * *'], ['#', '#'], ['⁂', '⁂'], ['blank', 'Space']], o.separator, (v) => set({ separator: v }))),
      ] : null,
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Paragraphs'),
        segmented([['indent', 'Indented'], ['spaced', 'Spaced']], o.indent ? 'indent' : 'spaced', (v) => set({ indent: v === 'indent' }))),
      ...backup,
    ],
  });
}
