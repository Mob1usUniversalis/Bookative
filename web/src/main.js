import './styles.css';
import { FONT_CSS, COMIC_FONT_CSS } from './gen/fonts.js';
import { route, start, currentPath } from './router.js';
import { installFormatBar } from './editor.js';
import { applyTheme } from './theme.js';
import { getSettings, listProjects } from './store.js';
import { projectsScreen, settingsScreen, aboutScreen } from './screens/projects.js';
import { homeScreen, projectInfoScreen } from './screens/home.js';
import { architectureScreen, archItemScreen, strandScreen, notesScreen, noteScreen } from './screens/story.js';
import {
  charactersScreen, characterScreen, characterSectionScreen, locationsScreen, locationScreen, objectsScreen, objectScreen,
} from './screens/characters.js';
import { chaptersScreen, chapterScreen, chapterFieldScreen, sceneScreen, sceneDetailsScreen } from './screens/chapters.js';
import { timelineScreen, analysisScreen, searchScreen } from './screens/insights.js';
import { exportScreen } from './screens/exporter.js';
import { readerScreen } from './screens/reader.js';
import { pageScreen, pageDetailsScreen } from './comic/editor.js';
import { importText } from './backup.js';
import { takeIncoming } from './platform.js';
import { navigate } from './router.js';

const fontStyle = document.createElement('style');
fontStyle.textContent = FONT_CSS + COMIC_FONT_CSS;
document.head.appendChild(fontStyle);

route('/', projectsScreen);
route('/settings', settingsScreen);
route('/about', aboutScreen);
route('/p/:pid', homeScreen);
route('/p/:pid/info', projectInfoScreen);
route('/p/:pid/arch', architectureScreen);
route('/p/:pid/arch/:key', archItemScreen);
route('/p/:pid/strands/:id', strandScreen);
route('/p/:pid/chars', charactersScreen);
route('/p/:pid/chars/:id', characterScreen);
route('/p/:pid/chars/:id/:section', characterSectionScreen);
route('/p/:pid/locs', locationsScreen);
route('/p/:pid/locs/:id', locationScreen);
route('/p/:pid/objs', objectsScreen);
route('/p/:pid/objs/:id', objectScreen);
route('/p/:pid/chapters', chaptersScreen);
route('/p/:pid/ch/:cid', chapterScreen);
route('/p/:pid/ch/:cid/:field', chapterFieldScreen);
route('/p/:pid/sc/:sid', sceneScreen);
route('/p/:pid/sc/:sid/details', sceneDetailsScreen);
route('/p/:pid/notes', notesScreen);
route('/p/:pid/notes/:id', noteScreen);
route('/p/:pid/timeline', timelineScreen);
route('/p/:pid/analysis', analysisScreen);
route('/p/:pid/search', searchScreen);
route('/p/:pid/export', exportScreen);
route('/p/:pid/pg/:pgid', pageScreen);
route('/p/:pid/pg/:pgid/details', pageDetailsScreen);
route('/p/:pid/read', readerScreen);
route('/p/:pid/read/:start', readerScreen);

applyTheme();
installFormatBar();

// After a cold start (the app was closed by the system), return to where the writer was.
const s = getSettings();
if (currentPath() === '/' && s.lastRoute && s.lastRoute !== '/') {
  const m = s.lastRoute.match(/^\/p\/([^/]+)/);
  if (!m || listProjects().some((e) => e.id === m[1])) {
    if (m && s.lastRoute !== `/p/${m[1]}`) {
      // Put the project overview underneath so "back" leads somewhere sensible.
      history.replaceState(null, '', `#/p/${m[1]}`);
      history.pushState(null, '', '#' + s.lastRoute);
    } else {
      history.replaceState(null, '', '#' + s.lastRoute);
    }
  }
}

start();
document.documentElement.classList.add('ready');

// A backup opened with, or shared to, Bookative from another app (e.g. sent from another phone).
async function handleIncoming() {
  const text = takeIncoming();
  if (!text) return;
  navigate('/', { replace: true });
  const r = await importText(text);
  if (r) navigate('/', { replace: true });
}
window.__incoming = handleIncoming;
setTimeout(handleIncoming, 300);
