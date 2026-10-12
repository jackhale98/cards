import { describe, expect, it } from 'vitest';
import { showingScore, type PokerData } from '../src/engine/families/poker';
import { bestHand } from '../src/engine/lib/pokerEval';
import { parseCard } from '../src/engine/cards';
import { isHidden, redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['seven-card-stud'] as GameModule<PokerData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const ups = (s: GameState<PokerData>, seat: number) => s.zones[`up:${seat}`].cards.map((c) => c.id);
const all = (s: GameState<PokerData>, seat: number) => [...s.zones[`hand:${seat}`].cards, ...s.zones[`up:${seat}`].cards].map((c) => c.id);
const key = (id: string) => parseCard(id).rank * 4 + 'CDHS'.indexOf(parseCard(id).suit);

/** Everyone to act calls (or checks) until the street changes. */
function callAround(s: GameState<PokerData>) {
  const street = s.data.street;
  for (let i = 0; i < 20 && s.data.street === street && s.phase === 'betting'; i++) {
    const acts = g.actions(s, s.turn!).map((a) => a.type);
    g.apply(s, s.turn!, { type: acts.includes('check') ? 'check' : 'call' });
  }
}

describe('seven card stud (pagat)', () => {
  it('ranks what’s showing: pairs beat high cards, no straights or flushes on four cards', () => {
    expect(showingScore(['2C', '2D'])).toBeGreaterThan(showingScore(['AS', 'KS']));
    expect(showingScore(['AS', 'KS'])).toBeGreaterThan(showingScore(['AS', 'QS']));
    expect(showingScore(['3C', '3D', '4H', '4S'])).toBeGreaterThan(showingScore(['AC', 'AD', 'KH', 'QS']));
    expect(showingScore(['5S', '6S', '7S', '8S'])).toBeLessThan(showingScore(['2C', '2D', '3H', '4S']));
  });

  it('antes, two down and one up, and the lowest up card brings it in', () => {
    const s = g.setup(people(4), 3, {});
    for (let i = 0; i < 4; i++) {
      expect(s.zones[`hand:${i}`].cards).toHaveLength(2);
      expect(ups(s, i)).toHaveLength(1);
    }
    const low = [0, 1, 2, 3].reduce((a, b) => (key(ups(s, b)[0]) < key(ups(s, a)[0]) ? b : a));
    expect(s.data.b.bets[low]).toBe(5);
    expect(s.data.b.committed[low]).toBe(7);
    expect(s.players[low].chips).toBe(993);
    expect(s.turn).toBe((low + 1) % 4);
    // others see the up card and not the two down
    const v = redact(g, s, (low + 1) % 4);
    expect(v.zones[`hand:${low}`].cards.every((c) => isHidden(c.id))).toBe(true);
    expect(v.zones[`up:${low}`].cards.map((c) => c.id)).toEqual(ups(s, low));
    // completing to the smallest bet is the minimum raise
    const raise = g.actions(s, s.turn!).find((a) => a.type === 'raise')!;
    expect(raise.amount!.min).toBe(10);
  });

  it('if everyone calls the bring-in the street ends; then the best hand showing bets first', () => {
    const s = g.setup(people(3), 5, {});
    callAround(s);
    expect(s.data.street).toBe(1);
    for (let i = 0; i < 3; i++) expect(ups(s, i)).toHaveLength(2);
    const best = [0, 1, 2].reduce((a, b) => (showingScore(ups(s, b)) > showingScore(ups(s, a)) ? b : a));
    expect(s.turn).toBe(best);
  });

  it('three more up, the last down, then the best five of seven wins', () => {
    const s = g.setup(people(3), 11, {});
    for (let st = 0; st < 5 && s.phase === 'betting'; st++) callAround(s);
    expect(s.phase).toBe('handOver');
    const values = [0, 1, 2].map((i) => bestHand(all(s, i)).score);
    const top = Math.max(...values);
    expect(s.data.result!.winners.sort()).toEqual([0, 1, 2].filter((i) => values[i] === top));
    for (let i = 0; i < 3; i++) expect(all(s, i)).toHaveLength(7);
  });

  it('the seventh card is dealt face down', () => {
    const s = g.setup(people(2), 8, {});
    for (let st = 0; st < 4; st++) callAround(s);
    expect(s.data.street).toBe(4);
    for (let i = 0; i < 2; i++) {
      expect(s.zones[`hand:${i}`].cards).toHaveLength(3);
      expect(ups(s, i)).toHaveLength(4);
    }
  });

  it('bots play whole games at every level', () => {
    for (const level of [0, 1]) {
      const s = g.setup(Array.from({ length: 5 }, (_, i) => ({ name: `B${i}`, bot: true })), 21 + level, { botLevel: level, stack: 200 });
      let hands = 0;
      for (let i = 0; i < 4000 && s.phase !== 'gameOver' && hands < 25; i++) {
        if (s.phase === 'handOver') {
          hands++;
          g.apply(s, s.players.find((p) => p.chips > 0)!.seat, { type: 'next' });
          continue;
        }
        const sys = g.system!(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const a = g.bot!(s, s.turn!)!;
        g.apply(s, s.turn!, a);
      }
      expect(hands).toBeGreaterThan(3);
      // chips are never made or lost
      const pot = s.data.b.committed.reduce((a, b) => a + b, 0);
      expect(s.players.reduce((n, p) => n + p.chips, 0) + pot).toBe(1000);
    }
  }, 60000);
});
