import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/engine/cards';
import type { TrickData } from '../src/engine/families/trick';
import { redact } from '../src/engine/redact';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES.whist as GameModule<TrickData>;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));

/** Play every trick with the bots (system steps included) until the hand is scored. */
function playOut(s: GameState<TrickData>) {
  for (let i = 0; i < 400 && s.phase !== 'roundOver' && s.phase !== 'gameOver'; i++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
    g.apply(s, seat, g.bot!(s, seat)!);
  }
}

describe('whist (pagat)', () => {
  it('deals 13 each; the dealer’s last card is turned up for trumps, for everyone to see', () => {
    const s = g.setup(people(4), 1, {});
    for (let i = 0; i < 4; i++) expect(s.zones[`hand:${i}`].cards).toHaveLength(13);
    const shown = s.zones[`hand:${s.dealer}`].cards.find((c) => c.up)!;
    expect(shown.id).toBe(s.data.trumpCard);
    expect(parseCard(shown.id).suit).toBe(s.data.trump);
    // another player can see it in the dealer's hand
    const other = (s.dealer + 1) % 4;
    expect(redact(g, s, other).zones[`hand:${s.dealer}`].cards.map((c) => c.id)).toContain(shown.id);
    // and the player left of the dealer leads
    expect(s.turn).toBe(other);
  });

  it('the dealer picks the trump card back up on playing to the first trick', () => {
    const s = g.setup(bots(4), 2, {});
    const card = s.data.trumpCard!;
    for (let i = 0; i < 20 && s.data.trumpCard; i++) {
      const seat = s.turn!;
      g.apply(s, seat, g.bot!(s, seat)!);
    }
    expect(s.data.trumpCard).toBeNull();
    const still = s.zones[`hand:${s.dealer}`].cards.find((c) => c.id === card);
    if (still) expect(still.up).toBeFalsy();
  });

  it('scores one point a trick over six to the side taking more', () => {
    const s = g.setup(bots(4), 3, {});
    playOut(s);
    const won = [0, 1].map((t) => s.data.tricks[t] + s.data.tricks[t + 2]);
    const best = won[0] > won[1] ? 0 : 1;
    expect(s.data.scores[best]).toBe(won[best] - 6);
    expect(s.data.scores[1 - best]).toBe(0);
  });

  it('honours (an option): three or four of A K Q J of trumps', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = g.setup(bots(4), seed, { honours: true });
      const h = s.data.honours;
      if (!h) continue;
      playOut(s);
      const won = [0, 1].map((t) => s.data.tricks[t] + s.data.tricks[t + 2]);
      const best = won[0] > won[1] ? 0 : 1;
      const tricks = [0, 1].map((t) => (t === best ? won[t] - 6 : 0));
      expect(s.data.scores[h.team]).toBe(tricks[h.team] + (h.count === 4 ? 4 : 2));
      return;
    }
    throw new Error('no deal with honours in 60 seeds');
  });

  it('bots play whole games to 5', () => {
    const s = g.setup(bots(4), 4, {});
    for (let i = 0; i < 5000 && s.phase !== 'gameOver'; i++) {
      if (s.phase === 'roundOver') {
        g.apply(s, 0, { type: 'next' });
        continue;
      }
      playOut(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(Math.max(...s.data.scores)).toBeGreaterThanOrEqual(5);
  });
});
