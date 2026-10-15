import { beforeEach, describe, expect, it } from 'vitest';
import { loadRecord, noteGames, summarise } from '../src/ui/record';
import type { Night } from '../src/net/protocol';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

const night: Night = {
  games: [
    {
      game: 'hearts',
      name: 'Hearts',
      at: 1000,
      results: [
        { id: 'me', name: 'Hana', place: 0, points: 3 },
        { id: 'ann', name: 'Ann', place: 1, points: 2 },
        { id: 'bot:x', name: 'Ada', place: 2, points: 1 },
        { id: 'ben', name: 'Ben', place: 3, points: 0 },
      ],
    },
    {
      game: 'spades',
      name: 'Spades',
      at: 2000,
      results: [
        { id: 'me', name: 'Hana', place: 1, points: 0 },
        { id: 'ann', name: 'Ann', place: 0, points: 3 },
      ],
    },
    { game: 'hearts', name: 'Hearts', at: 3000, results: [{ id: 'other', name: 'Zed', place: 0, points: 3 }] },
  ],
};

describe('your record across nights', () => {
  it('notes the games you played, once each, and who you finished ahead of (people, not bots)', () => {
    noteGames(night, 'me');
    noteGames(night, 'me');
    const list = loadRecord();
    expect(list.map((g) => g.game)).toEqual(['hearts', 'spades']);
    expect(list[0]).toMatchObject({ place: 0, players: 4, beat: ['Ann', 'Ben'], lostTo: [] });
    const sum = summarise(list);
    expect(sum).toMatchObject({ played: 2, won: 1 });
    expect(sum.games).toEqual([
      { name: 'Hearts', played: 1, won: 1 },
      { name: 'Spades', played: 1, won: 0 },
    ]);
    expect(sum.rivals[0]).toEqual({ name: 'Ann', played: 2, beat: 1, lostTo: 1 });
  });
});
