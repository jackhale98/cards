import { describe, expect, it } from 'vitest';
import { checkMove, isSecret, newSecret, prove, same, seatKeyFor, signMove } from '../src/net/eventCrypto';
import { hmacSha256, sha256 } from '../src/net/sha256';

describe('SHA-256 and HMAC, worked out here, agree with the browser’s', () => {
  it('for messages of every length around the block size, and long keys', async () => {
    const enc = new TextEncoder();
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 200, 1000]) {
      const msg = new Uint8Array(n).map((_, i) => (i * 7 + n) & 255);
      const want = new Uint8Array(await crypto.subtle.digest('SHA-256', msg));
      expect([...sha256(msg)]).toEqual([...want]);
      for (const keyLen of [5, 64, 100]) {
        const key = new Uint8Array(keyLen).map((_, i) => (i * 13 + keyLen) & 255);
        const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        expect([...hmacSha256(key, msg)]).toEqual([...new Uint8Array(await crypto.subtle.sign('HMAC', k, msg))]);
      }
    }
    expect([...sha256(enc.encode('abc'))].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('a tournament’s secrets', () => {
  it('a seat key belongs to one player at one table of one round', () => {
    const a = newSecret();
    const b = newSecret();
    expect(isSecret(a)).toBe(true);
    expect(isSecret('short')).toBe(false);
    const k = seatKeyFor(a, 'BCDFGH', 1, 3);
    expect(k).toBe(seatKeyFor(a, 'BCDFGH', 1, 3));
    expect(k).not.toBe(seatKeyFor(a, 'BCDFGH', 1, 4));
    expect(k).not.toBe(seatKeyFor(a, 'BCDFGH', 2, 3));
    expect(k).not.toBe(seatKeyFor(b, 'BCDFGH', 1, 3));
    // (it fits a seat key's limits: see Host.greet)
    expect(k.length).toBeLessThanOrEqual(128);
  });

  it('a move can’t be redirected or passed off as another player’s', () => {
    const a = newSecret();
    const m = signMove(a, { event: 'BCDFGH', round: 2, table: 1, room: 'KLMNP', host: false });
    expect(checkMove(a, m)).toBe(true);
    expect(checkMove(a, { ...m, room: 'QRSTV' })).toBe(false);
    expect(checkMove(a, { ...m, host: true })).toBe(false);
    expect(checkMove(a, { ...m, round: 1 })).toBe(false);
    expect(checkMove(newSecret(), m)).toBe(false);
  });

  it('a challenge answered only with the secret', () => {
    const a = newSecret();
    expect(prove(a, 'n1', 'me')).not.toBe(prove(a, 'n2', 'me'));
    expect(same(prove(a, 'n1', 'table', 1, 2), prove(a, 'n1', 'table', 1, 2))).toBe(true);
    expect(same('abc', 'abd')).toBe(false);
  });
});
