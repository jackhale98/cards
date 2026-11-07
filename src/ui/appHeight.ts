/**
 * A Home Screen app on an iPhone fills the screen, but iOS 26 sometimes tells the page it's
 * shorter than that (most often after the keyboard has been up: WebKit bug 292603), and the
 * app, as tall as the page, stops short, leaving a blank band along the bottom with the lobby's
 * deal bar and the table's hand floating above it. There, the app is made as tall as the screen.
 * Only a Home Screen app on iOS (Safari's `navigator.standalone`), and only one as wide as the
 * screen (an iPad's app in a window beside another isn't): a browser tab, or an Android app whose
 * screen includes the system bars, keeps the page's own height.
 */

export interface Viewport {
  /** Safari's own flag: opened from the Home Screen. */
  standalone?: boolean;
  innerW: number;
  innerH: number;
  /** The screen (on iOS, as held upright whichever way the phone is turned). */
  screenW: number;
  screenH: number;
}

/** How tall the app should be, in CSS pixels, when the page's own height falls short; else null. */
export function fullHeight(v: Viewport): number | null {
  if (v.standalone !== true) return null;
  const long = Math.max(v.screenW, v.screenH);
  const short = Math.min(v.screenW, v.screenH);
  const sideways = v.innerW > v.innerH;
  const [w, h] = sideways ? [long, short] : [short, long];
  // (not the whole screen's width: a window, not the whole screen)
  if (Math.abs(v.innerW - w) > 1) return null;
  return v.innerH < h - 1 ? h : null;
}

/** Keep `--app-h` (the app's height, in tokens.css) right as the page resizes and turns. */
export function watchAppHeight() {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone !== true) return;
  const root = document.documentElement;
  const fit = () => {
    const h = fullHeight({ standalone: nav.standalone, innerW: innerWidth, innerH: innerHeight, screenW: screen.width, screenH: screen.height });
    if (h == null) root.style.removeProperty('--app-h');
    else root.style.setProperty('--app-h', `${h}px`);
  };
  fit();
  addEventListener('resize', fit);
  addEventListener('orientationchange', fit);
  visualViewport?.addEventListener('resize', fit);
  // (iOS settles its sizes a moment after the keyboard goes)
  addEventListener('focusout', () => setTimeout(fit, 300));
}
