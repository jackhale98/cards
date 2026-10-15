import { describe, expect, it } from 'vitest';
import { botView } from '../src/engine/botView';
import { canSee } from '../src/engine/redact';
import { mulberry } from '../src/engine/families/trick/systems/hands';
import type { GameModule, GameState } from '../src/engine/types';
import { GAME_LIST } from './games';

/** A table a few moves in (bots playing), so hands, piles and tricks all hold something. */
function midGame(g: GameModule, seed: number): GameState {
  const n = Math.max(g.config.players.min, Math.min(g.config.players.max, 4));
  const s: GameState = g.setup(
    Array.from({ length: n }, (_, i) => ({ name: `B${i}`, bot: true })),
    seed,
    { ...Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default])), botLevel: 0 },
  );
  for (let i = 0; i < 12; i++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const p = s.players.find((x) => g.bot!(s, x.seat));
    if (!p) break;
    g.apply(s, p.seat, g.bot!(s, p.seat)!);
  }
  return s;
}

/** The same table with the cards `seat` can't see shuffled around among the places it can't see. */
function reshuffled(s: GameState, seat: number, rand: () => number): GameState {
  const t = structuredClone(s);
  const spots = Object.values(t.zones).flatMap((z) => z.cards.filter((c) => !canSee(z, c, seat)));
  const ids = spots.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  spots.forEach((c, i) => (c.id = ids[i]));
  return t;
}

describe('bots think only with what their seat can see', () => {
  for (const g of GAME_LIST.filter((g) => g.bot))
    it(`${g.config.id}: a bot's view is the same whatever the hidden cards are`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const s = midGame(g, seed);
        const t = reshuffled(s, 0, mulberry(seed));
        // (the same dice for both: the view depends on nothing else)
        expect(botView(g, t, 0, mulberry(7)).view).toEqual(botView(g, s, 0, mulberry(7)).view);
      }
    });

  it('cards already played stay known: in a trick game, the tricks won are the real ones in a bot’s view', () => {
    for (const id of ['bridge', 'hearts', 'spades', 'euchre', 'pinochle']) {
      const g = GAME_LIST.find((x) => x.config.id === id)!;
      const s = midGame(g, 4);
      // play on until some tricks are won
      for (let i = 0; i < 40; i++) {
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        const p = s.players.find((x) => g.bot!(s, x.seat));
        if (!p) break;
        g.apply(s, p.seat, g.bot!(s, p.seat)!);
      }
      const piles = Object.keys(s.zones).filter((z) => /^(taken|won):/.test(z));
      expect(
        piles.some((z) => s.zones[z].cards.length),
        id,
      ).toBe(true);
      const { view } = botView(g, s, 1);
      for (const z of piles)
        expect(
          view.zones[z].cards.map((c) => c.id),
          `${id} ${z}`,
        ).toEqual(s.zones[z].cards.map((c) => c.id));
    }
  });

  it('the cards a bot sees in place of hidden ones are real cards nobody else in the view holds', () => {
    const g = GAME_LIST.find((x) => x.config.id === 'bridge')!;
    const { view } = botView(g, midGame(g, 5), 1);
    const all = Object.values(view.zones).flatMap((z) => z.cards.map((c) => c.id));
    expect(all.some((c) => c.startsWith('?'))).toBe(false);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(52);
  });
});
