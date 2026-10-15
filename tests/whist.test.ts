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
      // nobody is told who holds honours until the hand is scored
      for (let v = 0; v < 4; v++) expect(g.redactData!(s, v).honours).toBeNull();
      playOut(s);
      expect(g.redactData!(s, 0).honours).toEqual(h);
      const won = [0, 1].map((t) => s.data.tricks[t] + s.data.tricks[t + 2]);
      const best = won[0] > won[1] ? 0 : 1;
      const tricks = [0, 1].map((t) => (t === best ? won[t] - 6 : 0));
      expect(s.data.scores[h.team]).toBe(tricks[h.team] + (h.count === 4 ? 4 : 2));
      return;
    }
    throw new Error('no deal with honours in 60 seeds');
  });

  it('tricks score before honours: a side whose tricks reach the target wins, whatever the other held', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = g.setup(bots(4), seed, { honours: true });
      const h = s.data.honours;
      if (!h) continue;
      const trial = structuredClone(s);
      playOut(trial);
      const won = [0, 1].map((t) => trial.data.tricks[t] + trial.data.tricks[t + 2]);
      const best = won[0] > won[1] ? 0 : 1;
      if (best === h.team) continue;
      // the trick winners need one point; the honours side, at 3, would pass them with honours added
      s.data.scores[best] = 4;
      s.data.scores[h.team] = 3;
      playOut(s);
      expect(s.phase).toBe('gameOver');
      expect(s.winner!.sort()).toEqual([best, best + 2]);
      expect(s.data.scores[h.team]).toBe(3);
      return;
    }
    throw new Error('no deal where the other side held honours');
  });

  it('must follow suit; with none of the suit led, any card, and the highest trump wins', () => {
    const s = g.setup(people(4), 5, {});
    const leader = s.turn!;
    const lead = s.zones[`hand:${leader}`].cards.find((c) => !c.up)!.id;
    g.apply(s, leader, { type: 'play', cards: [lead] });
    const next = s.turn!;
    const suit = parseCard(lead).suit;
    const hand = s.zones[`hand:${next}`].cards.map((c) => c.id);
    const offered = g.actions(s, next).find((a) => a.type === 'play')!.select!.cards;
    if (hand.some((id) => parseCard(id).suit === suit)) expect(offered.every((id) => parseCard(id).suit === suit)).toBe(true);
    else expect([...offered].sort()).toEqual([...hand].sort());
    // play the trick out: a trump in it wins, or else the highest of the suit led
    const plays = [{ seat: leader, card: parseCard(lead) }];
    for (let i = 0; i < 3; i++) {
      const seat = s.turn!;
      const a = g.bot!(s, seat)!;
      plays.push({ seat, card: parseCard(a.cards![0]) });
      g.apply(s, seat, a);
    }
    const trumps = plays.filter((p) => p.card.suit === s.data.trump);
    const best = (trumps.length ? trumps : plays.filter((p) => p.card.suit === suit)).reduce((a, b) => (b.card.rank > a.card.rank ? b : a));
    for (let i = 0; i < 3 && g.system?.(s); i++) g.system!(s)!.run(s);
    expect(s.data.tricks[best.seat]).toBe(1);
    expect(s.turn).toBe(best.seat);
  });

  it('the target is a lobby option, and a game ends the moment a side reaches it', () => {
    const s = g.setup(bots(4), 9, { target: 7 });
    s.data.scores = [6, 0];
    playOut(s);
    const won = [0, 1].map((t) => s.data.tricks[t] + s.data.tricks[t + 2]);
    if (won[0] > won[1]) {
      expect(s.phase).toBe('gameOver');
      expect(s.winner!.sort()).toEqual([0, 2]);
    } else expect(s.phase).toBe(s.data.scores[1] >= 7 ? 'gameOver' : 'roundOver');
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
