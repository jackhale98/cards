import type { GameConfig } from '../src/engine/types';
import { moduleFor } from '../src/engine/families';
import { describe, expect, it } from 'vitest';
import { buildDeck, parseCard, sortCards } from '../src/engine/cards';
import { redact, isHidden } from '../src/engine/redact';
import { shuffle } from '../src/engine/rng';
import { GAMES, GAME_LIST } from '../src/games';

describe('cards', () => {
  it('builds standard and custom decks', () => {
    expect(buildDeck()).toHaveLength(52);
    expect(new Set(buildDeck()).size).toBe(52);
    expect(buildDeck({ jokers: 2 })).toHaveLength(54);
    expect(buildDeck({ decks: 2 })).toHaveLength(104);
    expect(new Set(buildDeck({ decks: 2 })).size).toBe(104);
    expect(buildDeck({ ranks: [9, 10, 11, 12, 13, 14] })).toHaveLength(24);
  });

  it('parses ids', () => {
    expect(parseCard('AS')).toMatchObject({ rank: 14, suit: 'S' });
    expect(parseCard('TD')).toMatchObject({ rank: 10, suit: 'D' });
    expect(parseCard('2C#2')).toMatchObject({ rank: 2, suit: 'C' });
    expect(parseCard('X1')).toMatchObject({ suit: 'X' });
  });

  it('sorts by suit then rank', () => {
    expect(sortCards(['AH', '2S', 'KS', '3H'])).toEqual(['2S', 'KS', '3H', 'AH']);
  });
});

describe('rng', () => {
  it('shuffles deterministically from a seed', () => {
    const a = shuffle(buildDeck(), { rng: 42 });
    const b = shuffle(buildDeck(), { rng: 42 });
    const c = shuffle(buildDeck(), { rng: 43 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('registry', () => {
  it('loads every game folder, including config-only games', () => {
    expect(Object.keys(GAMES).sort()).toEqual(['bridge', 'canasta', 'crazy-eights', 'cribbage', 'euchre', 'five-hundred', 'freetable', 'gin-rummy', 'hearts', 'holdem', 'oh-hell', 'omaha', 'president', 'rummy-500', 'spades']);
    for (const g of GAME_LIST) {
      expect(g.config.players.min).toBeLessThanOrEqual(g.config.players.max);
      expect(g.config.zones.some((z) => z.id === 'deck')).toBe(true);
    }
  });

  it('deals config-only games from their deal recipe', () => {
    // a sandbox game with its own deal recipe and no rules
    const g = moduleFor({
      ...GAMES['crazy-eights'].config,
      id: 'deal-test',
      rules: { family: 'free' },
      deal: [
        { to: 'hand', count: 7 },
        { to: 'table', count: 1, faceUp: true },
      ],
    } as GameConfig);
    const s = g.setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 1, {});
    expect(s.zones['hand:0'].cards).toHaveLength(7);
    expect(s.zones.table.cards).toHaveLength(1);
    expect(s.zones.deck.cards).toHaveLength(52 - 21 - 1);
  });
});

describe('redaction', () => {
  it('never reveals other players’ hands or the deck', () => {
    for (const g of GAME_LIST) {
      const players = Array.from({ length: g.config.players.min < 2 ? 2 : g.config.players.min }, (_, i) => ({ name: `P${i}` }));
      const s = g.setup(players, 7, {});
      const v = redact(g, s, 0);
      const json = JSON.stringify(v.zones);
      for (const [id, z] of Object.entries(s.zones)) {
        if (id.startsWith('hand:') && id !== 'hand:0') {
          for (const c of z.cards) expect(json).not.toContain(`"${c.id}"`);
          expect(v.zones[id].cards.every((c) => isHidden(c.id))).toBe(true);
        }
      }
      expect(v.zones.deck.cards.every((c) => isHidden(c.id))).toBe(true);
      expect(v.zones['hand:0'].cards.map((c) => c.id)).toEqual(s.zones['hand:0'].cards.map((c) => c.id));
    }
  });
});
