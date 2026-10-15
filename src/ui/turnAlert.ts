/**
 * Your turn while Lamplight is in the background (another app, another tab, the screen off): the
 * tab's title says so, an installed app gets a badge, and, if you switched them on, a notification.
 * All cleared when you come back. Best effort: a phone may pause a page in the background, and
 * then nothing reaches it until it's opened again.
 */
const KEY = 'cards.turnAlerts';
const MARK = '● Your turn — ';
let raised = false;

/** Notifications switched on here (and allowed by the browser). */
export function turnAlertsOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Whether this browser can show notifications at all (an iPhone only from the Home Screen). */
export const canNotify = () => typeof Notification !== 'undefined';

/** Switch notifications on (asking the browser's permission) or off. Resolves to whether they're on. */
export async function setTurnAlerts(on: boolean): Promise<boolean> {
  try {
    if (!on) {
      localStorage.removeItem(KEY);
      return false;
    }
    if (!canNotify()) return false;
    const ok = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted';
    if (ok) localStorage.setItem(KEY, '1');
    return ok;
  } catch {
    return false;
  }
}

/** It's become your turn: if nobody is looking at this page, say so where they'll see it. */
export function raiseTurn(game: string) {
  if (document.visibilityState === 'visible') return;
  raised = true;
  if (!document.title.startsWith(MARK)) document.title = MARK + document.title;
  void (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge?.(1)?.catch(() => {});
  if (!turnAlertsOn()) return;
  const opts: NotificationOptions = { body: game, tag: 'lamplight-turn', icon: './icon-192.png' };
  // (a service worker's notification works where the page's own can't, e.g. Android)
  void navigator.serviceWorker?.getRegistration().then(
    (reg) => {
      try {
        if (reg) void reg.showNotification('Your turn', opts).catch(() => {});
        else new Notification('Your turn', opts);
      } catch {
        /* (some browsers only allow notifications from a service worker) */
      }
    },
    () => {},
  );
}

/** You're looking again, or it's no longer your turn: take it all down. */
export function clearTurn() {
  if (!raised) return;
  raised = false;
  if (document.title.startsWith(MARK)) document.title = document.title.slice(MARK.length);
  void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()?.catch(() => {});
  void navigator.serviceWorker?.getRegistration().then(
    (reg) => reg?.getNotifications({ tag: 'lamplight-turn' }).then((list) => list.forEach((n) => n.close())),
    () => {},
  );
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && clearTurn());
