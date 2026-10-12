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

/** Why casting failed, in words (Chrome's error codes; `cancel` means the picker was closed). */
export const CAST_ERRORS: Record<string, string> = {
  timeout: 'The TV didn’t answer in time — check it’s on and on the same WiFi',
  receiver_unavailable: 'That TV can’t run Lamplight — is it a Chromecast or Google TV?',
  session_error: 'The TV couldn’t start Lamplight — try again in a moment',
  channel_error: 'Lost the connection to the TV — try again',
  extension_missing: 'Casting needs Chrome',
  api_not_initialized: 'Casting isn’t ready yet — try again in a second',
  load_media_failed: 'The TV couldn’t open Lamplight',
};

export class CastError extends Error {
  constructor(readonly code: string) {
    super(CAST_ERRORS[code] ?? `Casting didn’t work (${code})`);
  }
}

/**
 * Pick a TV and show this table on it. Resolves once the TV says it has the table (throws a
 * CastError otherwise; code `cancel` when the picker was closed).
 *
 * The TV takes a few seconds to load Lamplight after the session starts, and a message sent before
 * it's listening is lost, so the code is sent again until the TV confirms it (it also asks for it
 * as soon as it's ready).
 */
export async function castTable(table: string, opts: { tries?: number; every?: number } = {}): Promise<void> {
  if (!(await castAvailable())) throw new CastError('extension_missing');
  const ctx = window.cast.framework.CastContext.getInstance();
  if (!ctx.getCurrentSession()) {
    // (rejects with Chrome's error code; some versions resolve with it instead)
    const err = await ctx.requestSession().then(
      (e: unknown) => e,
      (e: unknown) => e ?? 'cancel',
    );
    if (err) throw new CastError(typeof err === 'string' ? err : String((err as { code?: string }).code ?? err));
  }
  const session = ctx.getCurrentSession();
  if (!session) throw new CastError('session_error');
  const send = () => session.sendMessage(CAST_NS, { table }).catch(() => {});
  await new Promise<void>((resolve, reject) => {
    let left = opts.tries ?? 20;
    const done = (ok: boolean) => {
      clearInterval(timer);
      session.removeMessageListener(CAST_NS, listener);
      if (ok) resolve();
      else reject(new CastError('timeout'));
    };
    const listener = (_ns: string, raw: string) => {
      let msg: { ready?: boolean; got?: string } = {};
      try {
        msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return;
      }
      if (msg.got === table) done(true);
      else if (msg.ready) void send();
    };
    session.addMessageListener(CAST_NS, listener);
    const timer = setInterval(() => (--left > 0 ? void send() : done(false)), opts.every ?? 1500);
    void send();
  });
}

/** On the TV (the receiver): start Google's receiver framework and pass on table codes. */
export function startReceiver(onTable: (table: string) => void) {
  const s = document.createElement('script');
  s.src = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
  s.onload = () => {
    const ctx = window.cast.framework.CastReceiverContext.getInstance();
    let shown = '';
    ctx.addCustomMessageListener(CAST_NS, (e: { senderId: string; data: { table?: string } }) => {
      const table = e.data?.table;
      if (!table) return;
      // tell the phone we have it (it keeps sending until we do); open it once
      ctx.sendCustomMessage(CAST_NS, e.senderId, { got: table });
      if (table !== shown) onTable((shown = table));
    });
    // a card table sits idle between moves: don't let the TV give up on it
    ctx.start({ disableIdleTimeout: true, customNamespaces: { [CAST_NS]: window.cast.framework.system.MessageType.JSON } });
    // ready: ask whoever started us for the table
    ctx.sendCustomMessage(CAST_NS, undefined, { ready: true });
  };
  document.head.append(s);
}
