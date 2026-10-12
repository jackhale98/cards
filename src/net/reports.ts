import { RELAY_URL } from './relayTransport';

/**
 * Anonymous error reports: when something breaks in the browser, or the host's rules engine hits
 * an error it shouldn't, send the relay a short note so it can be fixed: the message, where in the
 * code, the game and phase, the browser and the app version. Never cards, names or table codes.
 * Only the real site sends them (not local development or tests), each distinct error once, and at
 * most a few per visit.
 */

declare const __APP_VERSION__: string;

const MAX_PER_VISIT = 8;
const sent = new Set<string>();
let context: { game?: string; phase?: string } = {};

/** What the player is doing, for context (kept up to date by the app). */
export function setReportContext(c: { game?: string; phase?: string }) {
  context = c;
}

/** The relay's https address (reports are plain POSTs, not WebSocket messages). */
const endpoint = () => RELAY_URL.replace(/^ws/, 'http').replace(/\/$/, '') + '/report';

/** The real site: lamplight.cards (and its previews), not localhost or a test run. */
export const reportingOn = () =>
  typeof location !== 'undefined' && (location.hostname === 'lamplight.cards' || location.hostname.endsWith('.lamplight.cards') || location.hostname.endsWith('.pages.dev'));

/** Card ids, table codes and the like don't belong in a report: strip anything that looks like one. */
export function scrub(text: string): string {
  return text
    .replace(/#\/(room|display|join)\/[A-Z]{4,5}/g, '#/$1/…')
    .replace(/\b(?:[2-9TJQKA][SHDC]|X\d)(?:#\d)?\b/g, '…')
    .slice(0, 1500);
}

export function report(kind: 'error' | 'rejection' | 'engine' | 'bot', err: unknown, extra: { action?: string; game?: string; phase?: string } = {}) {
  try {
    if (!reportingOn() || sent.size >= MAX_PER_VISIT) return;
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    const msg = scrub(`${e.name === 'Error' ? '' : `${e.name}: `}${e.message}`).slice(0, 300);
    const stack = scrub(e.stack ?? '');
    const sig = `${kind}|${msg}|${stack.split('\n')[1] ?? ''}`;
    if (sent.has(sig)) return;
    sent.add(sig);
    const body = JSON.stringify({
      kind,
      msg,
      stack,
      game: extra.game ?? context.game ?? '',
      phase: extra.phase ?? context.phase ?? '',
      action: extra.action ?? '',
      ua: navigator.userAgent,
      v: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    });
    void fetch(endpoint(), { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never break anything */
  }
}

/** Catch what nothing else did. */
export function watchErrors() {
  if (typeof window === 'undefined') return;
  addEventListener('error', (e) => report('error', e.error ?? e.message));
  addEventListener('unhandledrejection', (e) => report('rejection', e.reason));
}
