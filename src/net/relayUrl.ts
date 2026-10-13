/**
 * Our own relay (a Cloudflare Worker, see `relay/`). On a dev server or localhost, `?relay=ws://…`
 * points the app at another one for testing; the real site ignores it, so a shared link can't send
 * a table's traffic somewhere else.
 */
const testing = typeof location !== 'undefined' && (import.meta.env.DEV || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));

export const RELAY_URL: string =
  (testing ? new URLSearchParams(location.search).get('relay') : null) ??
  (import.meta.env.VITE_RELAY_URL as string | undefined) ??
  'wss://relay.lamplight.cards';
