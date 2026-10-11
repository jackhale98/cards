import { CODE_LENGTH, type Msg } from './protocol';
import { createTransport, type TransportKind } from './transport';

/**
 * Pairing a TV with a table. A TV (a smart TV's browser at /tv, or a Chromecast running our
 * receiver) shows a short code and waits in its own little room on the relay; a phone at the table
 * types that code and sends the table code across, and the TV opens the table display.
 */

const PAIR_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
export function makeTvCode(): string {
  const a = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(a);
  return [...a].map((n) => PAIR_CHARS[n % PAIR_CHARS.length]).join('');
}

type TvMsg = { t: 'tvTable'; table: string } | { t: 'tvOk' };
const room = (tv: string) => `TV-${tv}`;
// pairing only ever needs our relay (or, in local test mode, the browser itself)
const kindFor = (net: TransportKind): TransportKind => (net === 'local' ? 'local' : 'relay');

/** On the TV: wait for a phone to send a table code. Returns a function that stops listening. */
export function waitForTable(net: TransportKind, tv: string, onTable: (table: string) => void): () => void {
  let stop = false;
  let leave = () => {};
  void createTransport(kindFor(net), room(tv), 'guest').then(({ transport }) => {
    if (stop) return transport.leave();
    leave = () => transport.leave();
    transport.onMessage = (raw, from) => {
      const m = raw as unknown as TvMsg;
      if (m.t !== 'tvTable' || typeof m.table !== 'string') return;
      transport.send({ t: 'tvOk' } as unknown as Msg, from);
      onTable(m.table);
    };
  });
  return () => {
    stop = true;
    leave();
  };
}

/** On a phone: send our table to the TV showing `tv`. Resolves true once the TV says it got it. */
export async function sendToTv(net: TransportKind, tv: string, table: string, timeoutMs = 15000): Promise<boolean> {
  const { transport } = await createTransport(kindFor(net), room(tv), 'guest');
  return new Promise((resolve) => {
    const send = () => transport.send({ t: 'tvTable', table } as unknown as Msg);
    const done = (ok: boolean) => {
      clearInterval(again);
      clearTimeout(give);
      transport.leave();
      resolve(ok);
    };
    transport.onMessage = (raw) => (raw as unknown as TvMsg).t === 'tvOk' && done(true);
    transport.onPeerJoin = () => send();
    // keep trying until the TV answers (it may still be connecting)
    const again = setInterval(send, 1000);
    const give = setTimeout(() => done(false), timeoutMs);
    send();
  });
}
