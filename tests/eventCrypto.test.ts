import { describe, expect, it } from 'vitest';
import { checkMove, isSecret, newSecret, prove, same, seatKeyFor, signMove } from '../src/net/eventCrypto';

describe('a tournament’s secrets', () => {
  it('a seat key belongs to one player at one table of one round', async () => {
    const a = newSecret();
    const b = newSecret();
    expect(isSecret(a)).toBe(true);
    expect(isSecret('short')).toBe(false);
    const k = await seatKeyFor(a, 'BCDFGH', 1, 3);
    expect(k).toBe(await seatKeyFor(a, 'BCDFGH', 1, 3));
    expect(k).not.toBe(await seatKeyFor(a, 'BCDFGH', 1, 4));
    expect(k).not.toBe(await seatKeyFor(a, 'BCDFGH', 2, 3));
    expect(k).not.toBe(await seatKeyFor(b, 'BCDFGH', 1, 3));
    // (it fits a seat key's limits: see Host.greet)
    expect(k.length).toBeLessThanOrEqual(128);
  });

  it('a move can’t be redirected or passed off as another player’s', async () => {
    const a = newSecret();
    const m = await signMove(a, { event: 'BCDFGH', round: 2, table: 1, room: 'KLMNP', host: false });
    expect(await checkMove(a, m)).toBe(true);
    expect(await checkMove(a, { ...m, room: 'QRSTV' })).toBe(false);
    expect(await checkMove(a, { ...m, host: true })).toBe(false);
    expect(await checkMove(a, { ...m, round: 1 })).toBe(false);
    expect(await checkMove(newSecret(), m)).toBe(false);
  });

  it('a challenge answered only with the secret', async () => {
    const a = newSecret();
    expect(await prove(a, 'n1', 'me')).not.toBe(await prove(a, 'n2', 'me'));
    expect(same(await prove(a, 'n1', 'table', 1, 2), await prove(a, 'n1', 'table', 1, 2))).toBe(true);
    expect(same('abc', 'abd')).toBe(false);
  });
});
