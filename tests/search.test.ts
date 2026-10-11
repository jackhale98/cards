import { describe, expect, it } from 'vitest';
import { dealConstrained } from '../src/engine/bots/search';
import { parseCard } from '../src/engine/cards';
import type { TrickData } from '../src/engine/families/trickTaking';
import { GAMES } from '../src/games';
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
    expect(GAMES.holdem.config.options?.some((o) => o.id === 'botLevel')).toBe(false);
  });

  it('deals around known voids', () => {
    const pool = ['AS', 'KS', 'QH', 'JH', '2C', '3C'];
    for (let i = 0; i < 50; i++) {
      const [a, b] = dealConstrained(pool, [{ count: 3, forbid: (c) => c.endsWith('S') }, { count: 3 }]);
      expect(a.some((c) => c.endsWith('S'))).toBe(false);
      expect([...a, ...b].sort()).toEqual([...pool].sort());
    }
  });

  it.each(['spades', 'hearts', 'euchre', 'five-hundred', 'bridge', 'oh-hell'])('%s: searched moves are legal through whole hands', (id) => {
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
  }, 60000);

  it('ducks under its partner’s winning card', () => {
    const g = GAMES['five-hundred'] as GameModule<TrickData>;
    const s = g.setup(bots(4), 5, { ...defaults(g), botLevel: 2 }) as GameState<TrickData>;
    for (const z of Object.values(s.zones)) z.cards = [];
    // seat 0 (partner) leads the A♥, seat 1 follows; seat 2 holds K♥ 4♥ — two tricks to go
    s.zones.trick.cards = [{ id: 'AH', by: 0, up: true }, { id: '5H', by: 1, up: true }];
    s.zones['hand:0'].cards = [{ id: '9D' }];
    s.zones['hand:1'].cards = [{ id: 'QH' }];
    s.zones['hand:2'].cards = [{ id: 'KH' }, { id: '4H' }];
    s.zones['hand:3'].cards = [{ id: '6H' }, { id: '7C' }];
    Object.assign(s.data, { trump: 'S', maker: 0, contract: { tricks: 7, suit: 'S', value: 140 }, trickNo: 8, handSize: 10, tricks: [3, 4, 3, 4], sittingOut: null, ledSuits: ['H'] });
    s.phase = 'play';
    s.turn = 2;
    const a = g.bot!(s, 2)!;
    expect(a).toEqual({ type: 'play', cards: ['4H'] });
    expect(parseCard(a.cards![0]).rank).toBe(4);
  });
});
