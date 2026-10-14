import { getSettings } from './store.js';
import { setChrome } from './platform.js';

const FONTS = {
  serif: "'Literata', Georgia, 'Noto Serif', serif",
  sans: "system-ui, 'Roboto', 'Segoe UI', sans-serif",
  mono: "'Roboto Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
};

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const bridge = window.AndroidBridge;

// Inside the Android WebView, prefers-color-scheme follows the app theme rather
// than the system setting, so the native side reports dark mode directly.
let systemDark = bridge && bridge.isSystemDark ? bridge.isSystemDark() : mq.matches;
window.__systemDark = (dark) => {
  systemDark = !!dark;
  applyTheme();
};

export function isDark() {
  const t = getSettings().theme;
  return t === 'dark' || (t === 'system' && systemDark);
}

export function applyTheme() {
  const s = getSettings();
  const root = document.documentElement;
  const dark = isDark();
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--prose-font', FONTS[s.font] || FONTS.serif);
  root.style.setProperty('--prose-size', `${s.size}px`);
  root.style.setProperty('--prose-leading', String(s.lineHeight));
  root.dataset.para = s.para;
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim() || (dark ? '#15171D' : '#F2F3EE');
  setChrome(paper, !dark);
}

mq.addEventListener?.('change', () => {
  if (bridge) return;
  systemDark = mq.matches;
  applyTheme();
});
