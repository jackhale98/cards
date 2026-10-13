import { describe, expect, it } from 'vitest';
import { dealConstrained } from '../src/engine/bots/search';
import { parseCard } from '../src/engine/cards';
import type { TrickData } from '../src/engine/families/trick';
import { GAMES } from './games';
import type { GameModule, GameState } from '../src/engine/types';

const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true }));
const defaults = (g: GameModule<any>) => Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));

describe('search bots', () => {
  it('trick-taking games offer the bot strength setting (Normal by default); others do not', () => {
    for (const id of ['spades', 'hearts', 'euchre', 'five-hundred', 'bridge', 'oh-hell']) {
      const o = GAMES[id].config.options!.find((x) => x.id === 'botLevel')!;
      expect(o.choices).toEqual(['Easy', 'Normal', 'Hard']);
      expect(o.default).toBe(1);
    }
    for (const id of ['crazy-eights', 'president', 'gin-rummy', 'cribbage', 'go-fish', 'cheat', 'holdem', 'omaha', 'five-card-draw'])
      expect(GAMES[id].config.options!.some((o) => o.id === 'botLevel')).toBe(true);
    // the dealer plays blackjack, and the long rummy games keep their quick bots for now
    for (const id of ['blackjack', 'canasta', 'rummy-500', 'palace']) expect(GAMES[id].config.options?.some((o) => o.id === 'botLevel') ?? false).toBe(false);
  });

  it('deals around known voids', () => {
    const pool = ['AS', 'KS', 'QH', 'JH', '2C', '3C'];
    for (let i = 0; i < 50; i++) {
      const [a, b] = dealConstrained(pool, [{ count: 3, forbid: (c) => c.endsWith('S') }, { count: 3 }]);
      expect(a.some((c) => c.endsWith('S'))).toBe(false);
      expect([...a, ...b].sort()).toEqual([...pool].sort());
    }
  });

  it.each(['spades', 'hearts', 'euchre', 'five-hundred', 'bridge', 'oh-hell'])(
    '%s: searched moves are legal through whole hands',
    (id) => {
      const g = GAMES[id] as GameModule<TrickData>;
      for (let seed = 1; seed <= 3; seed++) {
        const s = g.setup(bots(4), seed, { ...defaults(g), botLevel: 1 });
        for (let i = 0; i < 400 && s.phase !== 'roundOver' && s.phase !== 'gameOver'; i++) {
          const sys = g.system?.(s);
          if (sys) {
            sys.run(s);
            continue;
          }
          const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
          const hands = s.players.map((_, j) => s.zones[`hand:${j}`].cards.map((c) => c.id).join());
          const a = g.bot!(s, seat)!;
          // thinking about the hidden cards never changes the real ones
          expect(s.players.map((_, j) => s.zones[`hand:${j}`].cards.map((c) => c.id).join())).toEqual(hands);
          expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
          g.apply(s, seat, a);
        }
        expect(['roundOver', 'gameOver']).toContain(s.phase);
      }
    },
    60000,
  );

  it('ducks under its partner’s winning card', () => {
    const g = GAMES['five-hundred'] as GameModule<TrickData>;
    const s = g.setup(bots(4), 5, { ...defaults(g), botLevel: 2 }) as GameState<TrickData>;
    for (const z of Object.values(s.zones)) z.cards = [];
    // seat 0 (partner) leads the A♥, seat 1 follows; seat 2 holds K♥ 4♥ — two tricks to go
    s.zones.trick.cards = [
      { id: 'AH', by: 0, up: true },
      { id: '5H', by: 1, up: true },
    ];
    s.zones['hand:0'].cards = [{ id: '9D' }];
    s.zones['hand:1'].cards = [{ id: 'QH' }];
    s.zones['hand:2'].cards = [{ id: 'KH' }, { id: '4H' }];
    s.zones['hand:3'].cards = [{ id: '6H' }, { id: '7C' }];
    Object.assign(s.data, {
      trump: 'S',
      maker: 0,
      contract: { tricks: 7, suit: 'S', value: 140 },
      trickNo: 8,
      handSize: 10,
      tricks: [3, 4, 3, 4],
      sittingOut: null,
      ledSuits: ['H'],
    });
    s.phase = 'play';
    s.turn = 2;
    const a = g.bot!(s, 2)!;
    expect(a).toEqual({ type: 'play', cards: ['4H'] });
    expect(parseCard(a.cards![0]).rank).toBe(4);
  });

  /** Play `hands` hands with every bot at `level`, checking each move is on offer. */
  function playHands(id: string, n: number, level: number, hands = 2) {
    const g = GAMES[id] as GameModule<any>;
    for (let seed = 1; seed <= hands; seed++) {
      const s = g.setup(bots(n), seed, { ...defaults(g), botLevel: level });
      const first = JSON.stringify([s.data.handNo, s.data.round]);
      for (let i = 0; i < 3000 && !['roundOver', 'handOver', 'gameOver'].includes(s.phase) && JSON.stringify([s.data.handNo, s.data.round]) === first; i++) {
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) break;
        const a = g.bot!(s, seat)!;
        expect(g.actions(s, seat).map((o) => o.type)).toContain(a.type);
        g.apply(s, seat, a);
      }
    }
  }

  it.each([
    ['crazy-eights', 4],
    ['president', 4],
    ['cribbage', 2],
    ['cribbage', 4],
    ['gin-rummy', 2],
    ['holdem', 4],
    ['omaha', 4],
    ['five-card-draw', 4],
    ['go-fish', 4],
    ['cheat', 4],
  ] as const)(
    '%s (%i players): Normal and Hard bots make legal moves',
    (id, n) => {
      playHands(id, n, 1);
      playHands(id, n, 2);
    },
    60000,
  );

  it('Go Fish: Hard remembers who said “Go fish!”, Easy doesn’t care', () => {
    const g = GAMES['go-fish'] as GameModule<any>;
    const s = g.setup(bots(3), 1, { ...defaults(g), botLevel: 2 });
    s.zones['hand:0'].cards = [{ id: '7S' }];
    s.zones['hand:1'].cards = [{ id: '2C' }, { id: '3C' }, { id: '4C' }, { id: '5C' }];
    s.zones['hand:2'].cards = [{ id: '9D' }];
    s.data.known = [[], [], []];
    s.data.lacks = [[], [7], []]; // seat 1 has the bigger hand, but just said "Go fish!" to sevens
    s.turn = 0;
    expect(g.bot!(s, 0)).toMatchObject({ seat: 2 });
    s.options.botLevel = 1;
    expect(g.bot!(s, 0)).toMatchObject({ seat: 1 });
  });

  it('poker: Hard raises aces and folds rags to a big bet', () => {
    const g = GAMES.holdem as GameModule<any>;
    const s = g.setup(bots(2), 3, { ...defaults(g), botLevel: 2 });
    const me = s.turn!;
    s.zones[`hand:${me}`].cards = [{ id: 'AS' }, { id: 'AH' }];
    // (it slow-plays now and then)
    const moves = Array.from({ length: 20 }, () => g.bot!(s, me)!.type);
    expect(moves.filter((t) => t === 'raise' || t === 'allin').length).toBeGreaterThanOrEqual(6);
    expect(moves).not.toContain('fold');
    s.zones[`hand:${me}`].cards = [{ id: '7C' }, { id: '2D' }];
    // the other player shoves: 7-2 offsuit can't pay that price
    g.apply(s, me, { type: 'call' });
    const them = s.turn!;
    g.apply(s, them, { type: 'allin' });
    expect(g.bot!(s, me)).toEqual({ type: 'fold' });
  });
});
