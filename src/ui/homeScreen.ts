/**
 * Suggesting Lamplight be added to the Home Screen, on iPhones and iPads: there Safari can't go full
 * screen for a website, and it clears a site's saved name and settings after a week away, unless
 * it's on the Home Screen. Shown once (if the browser forgets, it may show once more: no harm).
 */
const KEY = 'cards.homeTip';

/** What's needed to tell (the real `navigator` and `matchMedia` in the app). */
export interface Device {
  userAgent: string;
  maxTouchPoints: number;
  /** Safari's own flag: opened from the Home Screen. */
  standalone?: boolean;
  /** Does this media query match (`display-mode`)? */
  matches: (query: string) => boolean;
}

/**
 * An iPhone or iPad in a browser that can add to the Home Screen, not opened from there already.
 * (An app's own browser, Instagram's say, can't: its user agent has no "Safari".)
 */
export function canAddToHomeScreen(d: Device): boolean {
  // (an iPad asks for desktop sites: it says Macintosh, but has a touch screen)
  const ios = /iPhone|iPad|iPod/.test(d.userAgent) || (/Macintosh/.test(d.userAgent) && d.maxTouchPoints > 1);
  if (!ios || !/Safari\//.test(d.userAgent)) return false;
  const home = d.standalone === true || d.matches('(display-mode: standalone)') || d.matches('(display-mode: fullscreen)');
  return !home;
}

function thisDevice(): Device {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    matches: (q) => matchMedia(q).matches,
  };
}

/** Show the suggestion now? Yes the first time on a device that could use it; asking counts as showing. */
export function takeHomeScreenTip(): boolean {
  if (!canAddToHomeScreen(thisDevice())) return false;
  try {
    if (localStorage.getItem(KEY)) return false;
    localStorage.setItem(KEY, 'shown');
  } catch {
    // (private mode: nothing is remembered, so don't ask on every visit either)
    return false;
  }
  return true;
}
