import { describe, expect, it } from 'vitest';
import { nextRandom, randomSeed, seedState, shuffle } from '../src/engine/rng';
import type { GameModule } from '../src/engine/types';
import { GAME_LIST } from './games';

/**
 * Is the shuffle fair? Statistical checks of the dice and of every game's deal. Seeds are fixed, so
 * these give the same answer every run; the bounds are wide (about six standard deviations), so
 * only a real bias fails them.
 */

/** How far a chi-square statistic is from what chance gives, in standard deviations. */
const sigmas = (chi: number, df: number) => (chi - df) / Math.sqrt(2 * df);

describe('the dice', () => {
  it('start from 128 unguessable bits', () => {
    const seeds = Array.from({ length: 50 }, () => randomSeed());
    expect(seeds.every((s) => s.length === 4 && s.every((w) => Number.isInteger(w) && w >= 0 && w < 2 ** 32))).toBe(true);
    expect(new Set(seeds.map((s) => s.join())).size).toBe(50);
  });

  it('replay exactly from the same seed, and differ from the next one', () => {
    const deck = () => Array.from({ length: 52 }, (_, i) => i);
    const a = shuffle(deck(), { rng: seedState(42) });
    expect(shuffle(deck(), { rng: seedState(42) })).toEqual(a);
    expect(shuffle(deck(), { rng: seedState(43) })).not.toEqual(a);
    // (a game saved with the old one-number state carries on)
    const old = { rng: 12345 as number | number[] };
    shuffle(deck(), old);
    expect(Array.isArray(old.rng)).toBe(true);
  });

  it('look uniform and independent', () => {
    const state = { rng: seedState(1) };
    const n = 400_000;
    const bins = new Array(100).fill(0);
    let sum = 0;
    let lag = 0;
    let prev = nextRandom(state);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      const x = nextRandom(state);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      bins[Math.floor(x * 100)]++;
      sum += x;
      lag += (x - 0.5) * (prev - 0.5);
      prev = x;
    }
    expect(lo >= 0 && hi < 1).toBe(true);
    const chi = bins.reduce((c, b) => c + (b - n / 100) ** 2 / (n / 100), 0);
    expect(Math.abs(sigmas(chi, 99))).toBeLessThan(6);
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.003);
    // (correlation between neighbours: about 1/sqrt(n) by chance)
    expect(Math.abs(lag / n / (1 / 12))).toBeLessThan(6 / Math.sqrt(n));
  }, 30_000);

  it('shuffle every card into every place equally often', () => {
    const state = { rng: seedState(7) };
    const n = 100_000;
    const count = Array.from({ length: 52 }, () => new Array(52).fill(0));
    let sameSuitNext = 0;
    for (let t = 0; t < n; t++) {
      const deck = shuffle(
        Array.from({ length: 52 }, (_, i) => i),
        state,
      );
      deck.forEach((card, place) => count[card][place]++);
      for (let i = 0; i < 51; i++) if (deck[i] % 4 === deck[i + 1] % 4) sameSuitNext++;
    }
    const e = n / 52;
    const chi = count.flat().reduce((c, x) => c + (x - e) ** 2 / e, 0);
    // (a card-by-place table whose rows and columns are fixed: (52-1)^2 degrees of freedom)
    expect(Math.abs(sigmas(chi, 51 * 51))).toBeLessThan(6);
    // neighbours share a suit 12 times in 51, as in a truly random deck
    const p = 12 / 51;
    const pairs = n * 51;
    expect(Math.abs(sameSuitNext - pairs * p) / Math.sqrt(pairs * p * (1 - p))).toBeLessThan(6);
  }, 30_000);
});

/**
 * Every game's deal: over many deals, each card should land in each place (your hand, the stock,
 * the table…) as often as any other card, allowing for decks with two of a card; and each card
 * should be equally likely to sit at the top of the stock (games that deal after bets start
 * there). Only a rule may keep a card out of a place: Canasta and Hand and Foot lay a red three
 * down at once and draw a replacement, so a hand never starts with one.
 */
const RULED_OUT: Record<string, Record<string, RegExp>> = {
  canasta: { hand: /^3[HD]/ },
  // (and the first discard can't be a wild card or a red three: one goes back into the stock)
  'hand-and-foot': { hand: /^3[HD]/, discard: /^(3[HD]|2|X)/ },
};

function dealBias(g: GameModule, players: number, deals: number) {
  const opts = Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));
  const people = Array.from({ length: players }, (_, k) => ({ name: `P${k}`, bot: true }));
  const tally = new Map<string, Map<string, number>>();
  const add = (key: string, id: string) => {
    const t = tally.get(key) ?? new Map<string, number>();
    tally.set(key, t);
    t.set(id, (t.get(id) ?? 0) + 1);
  };
  for (let i = 0; i < deals; i++) {
    const s = g.setup(people, 1_000_003 * (i + 1), opts);
    const zones = Object.entries(s.zones).filter(([, z]) => z.cards.length);
    for (const [zid, z] of zones) for (const c of z.cards) add(zid, c.id);
    // the top few cards of the stock or shoe (the biggest face-down pile; hands are sorted)
    const [sid, stock] = zones.filter(([, z]) => z.visibility === 'none').sort((a, b) => b[1].cards.length - a[1].cards.length)[0] ?? [];
    if (stock) stock.cards.slice(-3).forEach((c, k) => add(`${sid}@top${3 - k}`, c.id));
  }
  // every card in the deck, and how many of it
  const mult = new Map<string, number>();
  for (const z of Object.values(g.setup(people, 1, opts).zones)) for (const c of z.cards) mult.set(c.id, (mult.get(c.id) ?? 0) + 1);
  const deckSize = [...mult.values()].reduce((a, b) => a + b, 0);
  const out: { place: string; sigmas: number; never: string[] }[] = [];
  for (const [place, t] of tally) {
    const placed = [...t.values()].reduce((a, b) => a + b, 0);
    // (a place holding the whole deck every time tells us nothing; nor does a tiny sample)
    if (placed / deals >= deckSize || placed < 1000) continue;
    // cards the rules keep out of this place: never there, and left out of the count
    const ruled = Object.entries(RULED_OUT[g.config.id] ?? {}).find(([prefix]) => place.split(':')[0] === prefix)?.[1];
    const broken = ruled ? [...t.keys()].filter((id) => ruled.test(id)) : [];
    // (cards never seen there, though chance says they'd turn up at least ten times)
    const never = [...mult].filter(([id, m]) => !t.has(id) && !ruled?.test(id) && (placed * m) / deckSize >= 10).map(([id]) => id);
    const live = [...mult].filter(([id]) => !ruled?.test(id));
    const liveSize = live.reduce((a, [, m]) => a + m, 0);
    let chi = 0;
    for (const [id, m] of live) {
      const e = (placed * m) / liveSize;
      chi += ((t.get(id) ?? 0) - e) ** 2 / e;
    }
    out.push({ place, sigmas: sigmas(chi, live.length - 1), never: [...never, ...broken] });
  }
  return out;
}

describe('every game deals fairly', () => {
  for (const g of GAME_LIST) {
    it(g.config.id, () => {
      const players = g.config.players.counts ? g.config.players.counts[0] : Math.min(4, Math.max(g.config.players.min, 2));
      const results = dealBias(g, players, 1500);
      expect(results.filter((r) => Math.abs(r.sigmas) > 6 || r.never.length)).toEqual([]);
      expect(results.length).toBeGreaterThan(0);
    }, 60_000);
  }
});
