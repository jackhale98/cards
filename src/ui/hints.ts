/**
 * Playable-card hints: the cards you can't use right now shaded, the ones you can edged in gold.
 * Quick to play with, but some people like to find their own legal moves, as at a real table. A
 * choice for this device, remembered; on unless turned off.
 */
const KEY = 'cards.hints';

export function hintsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setHints(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: for this visit only */
  }
}
