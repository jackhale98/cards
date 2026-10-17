/**
 * A tournament's secrets. Each player's phone makes a secret when they sign up and gives it to
 * the director, once. From it both work out, without it travelling again:
 *  - the key to their seat at each table (`seatKeyFor`): the director tells a table's host only the
 *    keys for that table, so a host learns nothing that would seat them anywhere else;
 *  - a check on where to go next (`signMove`): a move reaches a phone through its table's host,
 *    and the host can't send it elsewhere, or replay an old one, without it showing;
 *  - an answer to the director's challenge (`prove`), when a phone comes back, or a table's host links up.
 * HMAC-SHA-256 through the browser's own cryptography.
 */

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = new TextEncoder();

/** A new secret: 32 random bytes. */
export const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
/** A secret as it comes over the network: the right shape, or nothing. */
export const isSecret = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);

const keys = new Map<string, Promise<CryptoKey>>();
const keyOf = (secret: string) => {
  let k = keys.get(secret);
  if (!k) keys.set(secret, (k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])));
  return k;
};

/** The secret's signature over these parts, in order. */
export async function mac(secret: string, ...parts: (string | number | boolean)[]): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await keyOf(secret), enc.encode(parts.map(String).join('\u0000')));
  return b64url(new Uint8Array(sig));
}

/** Compare without stopping at the first difference (how far it got would say something). */
export function same(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The key that holds this player's seat at a table of the event. */
export const seatKeyFor = (secret: string, event: string, round: number, table: number) => mac(secret, 'seat', event, round, table);

/** Where a player goes next: the event, the round and table, the room, and whether they host it. */
export interface Move {
  event: string;
  round: number;
  table: number;
  room: string;
  host: boolean;
}
export interface SignedMove extends Move {
  sig: string;
}
const moveParts = (m: Move) => ['move', m.event, m.round, m.table, m.room, m.host] as const;
export const signMove = async (secret: string, m: Move): Promise<SignedMove> => ({ ...m, sig: await mac(secret, ...moveParts(m)) });
export const checkMove = async (secret: string, m: SignedMove) => same(m.sig, await mac(secret, ...moveParts(m)));

/** Answer the director's challenge (`nonce`) for a purpose ("me", or "table" plus its round and table). */
export const prove = (secret: string, nonce: string, ...what: (string | number)[]) => mac(secret, 'prove', nonce, ...what);
