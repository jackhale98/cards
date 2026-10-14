import { mount } from 'svelte';
import App from './App.svelte';
import { watchErrors } from './net/reports';
import { applyFourColour } from './ui/suits';
import './theme/tokens.css';

// anonymous reports of anything that breaks (the real site only; see net/reports.ts)
watchErrors();

// a tab left open across a deploy asks for chunks that no longer exist: load the new version
// (once a minute at most, so a real outage can't loop)
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('cards.reloadedAt') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('cards.reloadedAt', String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  location.reload();
});

// four-colour suits, if this device chose them
applyFourColour();

mount(App, { target: document.getElementById('app')! });

// the first screen (index.html) bows out now the app is drawn
const splash = document.getElementById('splash');
if (splash) {
  splash.classList.add('lc-gone');
  setTimeout(() => splash.remove(), 400);
}
