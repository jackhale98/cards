/**
 * Chromecast. A phone (Chrome on Android, or Chrome on a computer) starts our receiver on the TV —
 * the app itself at `/?cast=1`, registered in the Google Cast SDK Developer Console — and sends it
 * the table code over a custom channel; the TV then opens the table display. The receiver's App ID
 * is built in (VITE_CAST_APP_ID can point a build at a different, test receiver).
 */

/** Lamplight's published Cast receiver (the Google Cast SDK Developer Console). Not a secret. */
export const LAMPLIGHT_CAST_APP_ID = '221DFB34';
// (VITE_CAST_APP_ID overrides it, e.g. for a test receiver)
export const CAST_APP_ID = (import.meta.env.VITE_CAST_APP_ID as string | undefined) || LAMPLIGHT_CAST_APP_ID;
export const CAST_NS = 'urn:x-cast:cards.lamplight';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __onGCastApiAvailable?: (ok: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

let sdk: Promise<boolean> | null = null;
/** Load Google's sender library (Chrome only); resolves whether casting is available. */
export function castAvailable(): Promise<boolean> {
  if (!CAST_APP_ID || typeof window === 'undefined' || !window.chrome) return Promise.resolve(false);
  sdk ??= new Promise((resolve) => {
    window.__onGCastApiAvailable = (ok) => {
      if (ok) {
        window.cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: CAST_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
      }
      resolve(ok);
    };
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.onerror = () => resolve(false);
    document.head.append(s);
    setTimeout(() => resolve(false), 8000);
  });
  return sdk;
}

/** Pick a TV and show this table on it. Resolves when the TV has been told (or throws). */
export async function castTable(table: string): Promise<void> {
  if (!(await castAvailable())) throw new Error('Casting isn’t available in this browser');
  const ctx = window.cast.framework.CastContext.getInstance();
  if (!ctx.getCurrentSession()) await ctx.requestSession();
  await ctx.getCurrentSession().sendMessage(CAST_NS, { table });
}

/** On the TV (the receiver): start Google's receiver framework and pass on table codes. */
export function startReceiver(onTable: (table: string) => void) {
  const s = document.createElement('script');
  s.src = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
  s.onload = () => {
    const ctx = window.cast.framework.CastReceiverContext.getInstance();
    ctx.addCustomMessageListener(CAST_NS, (e: { data: { table?: string } }) => e.data?.table && onTable(e.data.table));
    // a card table sits idle between moves: don't let the TV give up on it
    ctx.start({ disableIdleTimeout: true, customNamespaces: { [CAST_NS]: window.cast.framework.system.MessageType.JSON } });
  };
  document.head.append(s);
}
