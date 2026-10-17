import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * "Your turn" while the app is in the background: a badge on an installed app, and a notification
 * if they're switched on. An iPhone keeps a Home Screen app's badge until the app takes it down,
 * and often closes the app in the background, so the page that opens next has to take down what
 * an earlier one left: on opening, and on coming back to it.
 */

/** A page (seen or not), with a badge and one notification an earlier page left up. */
function page(visible: boolean) {
  const listeners: Record<string, () => void> = {};
  const doc = { visibilityState: visible ? 'visible' : 'hidden', title: 'Lamplight', addEventListener: (t: string, f: () => void) => (listeners[t] = f) };
  const left = { badge: true, notifications: 1 };
  const nav = {
    setAppBadge: vi.fn(() => {
      left.badge = true;
      return Promise.resolve();
    }),
    clearAppBadge: vi.fn(() => {
      left.badge = false;
      return Promise.resolve();
    }),
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({
          getNotifications: () => Promise.resolve(Array.from({ length: left.notifications }, () => ({ close: () => left.notifications-- }))),
          showNotification: () => {
            left.notifications++;
            return Promise.resolve();
          },
        }),
    },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', nav);
  return { doc, listeners, left };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the "your turn" badge and notification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('come down when the app opens afresh, though this page never raised them', async () => {
    const { left } = page(true);
    await import('../src/ui/turnAlert');
    await settle();
    expect(left).toEqual({ badge: false, notifications: 0 });
  });

  it('come down when you come back to the app, though this page never raised them', async () => {
    const { doc, listeners, left } = page(false);
    await import('../src/ui/turnAlert');
    await settle();
    expect(left.badge).toBe(true);
    doc.visibilityState = 'visible';
    listeners.visibilitychange();
    await settle();
    expect(left).toEqual({ badge: false, notifications: 0 });
  });

  it('go up in the background, and down again when you leave the table', async () => {
    const { left } = page(false);
    const { clearTurn, raiseTurn } = await import('../src/ui/turnAlert');
    left.badge = false;
    raiseTurn('Hearts');
    expect(left.badge).toBe(true);
    clearTurn(true);
    await settle();
    expect(left.badge).toBe(false);
  });
});
