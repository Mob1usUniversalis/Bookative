# Bookative

Bookative is a workbench for writing novels and making comics on Android. It is modelled on bibisco's method. You plan the architecture of a story, interview your characters and describe places and objects. Then you write the story chapter by chapter, scene by scene, or lay it out, draw and letter it page by page.

## Features

### Writing a book

- **Projects.** Each project has a title, author and text language. The language drives spell check and hyphenation.
- **Architecture.** Premise, fabula and setting, plus narrative strands (plot lines).
- **Characters.**
  - Main characters get a nine-part interview: personal details, appearance, behaviour, psychology, beliefs, relationships, backstory, conflict and arc. Each part can be answered question by question or as free text.
  - Secondary characters get a single description.
- **Locations and objects**, each with a description and a picture.
- **Chapters and scenes.**
  - Chapters have a purpose and notes.
  - Scenes have rich text, revisions, a status, a story date and a point of view.
  - Scenes are tagged with characters, locations, objects and strands, and can have notes.
  - Focus mode hides everything but the text.
- **Pictures anywhere you write.** Insert them, paste them or drop them. Tap a picture to make it small, medium or full width, save a copy, or remove it.
- **Timeline, analysis and search.** A word goal with a deadline and daily snapshots.

### Making a comic

Every project can switch between **Book** and **Comic** view in Project details. Characters, locations, objects, architecture and notes are shared between the two views. Book view shows chapters and scenes. Comic view shows chapters and pages, and neither view deletes what the other made.

- **Page formats.** Comic book, manga (B6), A4 album, square and newspaper strip. A reading direction (right to left for manga) and a lettering-in-capitals option are set per project.
- **Layouts.** 15 panel layouts: splash page, tiers, grids, wide panels, staggered rows and strips. You can split, reorder or delete any panel, change the layout later, and undo or redo every change.
- **Pictures in panels.** Take them from the gallery or the clipboard, then move and zoom them inside the panel.
- **Drawing pad.**
  - Pen and eraser in four sizes and eleven colours.
  - Stylus pressure and palm rejection.
  - Undo and redo.
  - The panel picture can be shown underneath as a tracing guide.
- **Lettering.**
  - Kinds: speech, thought, whisper, shout, caption and sound effects.
  - Drag balloons to move them, aim their tails, and resize them.
  - Choose who speaks; each kind has its own look.
  - Lettering fonts with Latin and Cyrillic support, including Kazakh.
- **Script view.** Write panel descriptions and dialogue as text. New lines are placed on the page automatically.
- **Page details.** Status, characters who appear without speaking, and page notes.
- **Comic analysis.**
  - Pages per chapter, page status, and lettering by character.
  - The wordiest pages, and who appears in each chapter.

### Reading

The Read view shows a book as turning pages with its pictures, and a comic page by page. You can swipe, tap the edges or use the slider, and right-to-left reading is supported for manga.

### Export

| | Formats |
|---|---|
| Book | PDF (print dialog), Word, EPUB 3, HTML, Markdown (a .zip with pictures), plain text |
| Comic pages | Comic PDF at the page size, CBZ (page images plus `ComicInfo.xml`) |
| Comic script | Word, PDF, EPUB, HTML, Markdown, text. Script layout: pages, panels, descriptions, then `NAME:` lines |
| Story notes | Architecture, characters with interviews and pictures, locations, objects, chapter plans, notes |

### Storage, backups and other devices

- **Choose where projects live.** Settings → Storage offers two places:
  - App storage, which is private and the default.
  - Any folder you pick with Android's folder picker, such as Documents, an SD card, or a folder that Syncthing or Nextcloud keeps in sync with other devices. Bookative creates a `Bookative` subfolder there.

  When you switch, everything is copied. If a project exists in both places, the copy edited most recently wins. Settings such as the theme stay on the device. If the folder becomes unreachable, the shelf says so and offers to choose the folder again or go back to app storage.
- **Backups.** One project, or all projects at once, in a single `.bookative.json` file with every picture. You can save it anywhere, or send it to another device with Quick Share, Bluetooth, a messenger or e-mail.
- **Importing from another device.** Open the backup file with Bookative, share it to Bookative, or use Import a backup. When a project is already there, you choose to replace it, keep both, keep the newer copy or skip it. Backups from the earlier Folio app import as well.
- **Safety.** Every save is written so that it can't be left half-finished. Bookative keeps daily snapshots for the last five days you worked on a project, and unused pictures are cleaned up automatically.

## How it is built

A native Android shell hosts a WebView running a plain-JavaScript app. The shell is three Java classes in `android/src/app/bookative/`, and the app lives in `web/src`. The app is bundled into one offline `index.html` with its fonts embedded.

- **`Storage.java`.** App storage, plus folder storage through the Storage Access Framework. Saves are crash-safe. Moving between locations copies everything, and the newer copy of a project wins.
- **`ContentServer.java`.** A private content provider. It serves pictures to the WebView and shares files with other apps through temporary grants.
- **`MainActivity.java`.** Hosts the WebView. Its JavaScript bridge handles:
  - files, pictures and the clipboard;
  - downloading pictures from pasted web content and converting HEIC photos;
  - saving, sharing and printing;
  - receiving backups from other apps;
  - choosing and switching the storage folder.

Requirements and permissions:

- Minimum Android 7.0 (API 24). Target API 34.
- The only permission is internet access. The native side uses it solely to download pictures that appear in pasted web content. The WebView itself is blocked from the network, and it gets no file access; pictures come from the content provider.

## Building

No Gradle is needed. On Debian or Ubuntu:

```sh
sudo apt install aapt android-sdk-platform-23 dalvik-exchange zipalign apksigner openjdk-17-jdk nodejs npm
export KEYSTORE=~/.android-keys/bookative-release.jks   # created on first build if missing
export KEYSTORE_PASS='a long secret'
APP_ID=io.github.yourname.bookative VERSION_CODE=1 VERSION_NAME=1.2.0 ./build.sh
# → dist/Bookative-1.2.0.apk
```

- Set `APP_ID` to an ID you control before publishing; it can't change later without breaking updates.
- Keep the keystore outside the repository and back it up. Every update must be signed with the same key.

To work on the interface in a desktop browser, run `cd web && node build.mjs` and open `web/dist/index.html`. Outside Android, data lives in the browser's localStorage.

## Licenses

See `licenses/` for the bundled fonts (SIL Open Font License 1.1) and icons (ISC). Bookative's own license is not chosen yet; add a `LICENSE` file before publishing.

Bookative is inspired by [bibisco](https://bibisco.com) by Andrea Feccomandi. It is an independent project and is not affiliated with bibisco.
