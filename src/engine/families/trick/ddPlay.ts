import { parseCard } from '../../cards';
import { moreSamples, now, TESTING, type SearchBudget } from '../../bots/search';
import { solveCards } from '../../bots/dds';
import { ids, zone } from '../../state';
import { legalCards, suitOf } from './play';
import { readAuction } from './systems/bidder';
import { biddingSystem } from './systems/choice';
import { handInfo } from './systems/auction';
import type { Hand, Picture } from './systems/hands';
import { teamOf } from './sides';
import type { S, TrickGame } from './types';

/**
 * Hard bridge card play: the way the strong bridge programs play. The bot deals the cards it
 * can't see many times over, each deal fitting everything that's public (the cards played, who
 * has shown out of a suit, and in SAYC or two over one what each player's bids promised), has
 * DDS (the double-dummy solver) work out what every card it may play is worth on each deal with
 * all the cards known, and plays the card that does best across them.
 *
 * It only ever sees its own seat's view (see botView.ts): its own hand, dummy once it's down, and
 * the cards played. Returns null when DDS isn't loaded yet, or the table isn't bridge.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = '23456789TJQKA';

/** Hard's budget: deals per card, and time (early in a hand each deal takes longest to solve). */
export const DD_BUDGET: SearchBudget & { least: number } = { samples: 40, ms: 1200, least: 6 };

/** The budget to use: under the test runner a fixed few deals (DD_SAMPLES to measure with more). */
export function ddBudget(): SearchBudget & { least: number } {
  if (!TESTING) return DD_BUDGET;
  const n = Number(typeof process !== 'undefined' ? process.env?.DD_SAMPLES : 0) || 4;
  return { samples: n, ms: Infinity, least: n };
}

export function ddCard(g: TrickGame, s: S, seat: number, budget = DD_BUDGET, rand: () => number = Math.random): string | null {
  const d = s.data;
  const mover = s.turn!;
  if (!g.bridgeBids || s.players.length !== 4 || s.phase !== 'play') return null;
  const legal = legalCards(g, s, mover);
  if (legal.length <= 1) return legal[0] ?? null;

  // what this seat knows: its hand, dummy (once down), the trick, and the cards already played
  const known = new Map<number, string[]>();
  known.set(seat, ids(zone(s, `hand:${seat}`)));
  const dummy = d.dummyUp && d.dummy != null ? d.dummy : null;
  if (dummy != null) known.set(dummy, ids(zone(s, 'dummy')));
  const trick = zone(s, 'trick').cards;
  const gone = new Set<string>([...trick.map((c) => c.id), ...(d.played ?? []).flat()]);
  for (const cards of known.values()) for (const c of cards) gone.add(c);
  const pool = g.deckCards.filter((c) => !gone.has(c));
  const hidden = [0, 1, 2, 3].filter((x) => !known.has(x));
  const counts = hidden.map((x) => (x === dummy ? 0 : zone(s, `hand:${x}`).cards.length));
  if (counts.reduce((a, b) => a + b, 0) !== pool.length) return null;

  // what each hidden hand's bids promised (its whole hand: the cards it holds and those it played)
  const system = biddingSystem(g, s);
  const team = teamOf(g, s, seat);
  const vul = d.vul ?? [false, false];
  const pics = hidden.map((x) => (system ? readAuction(system, d.calls ?? [], (x + 2) % 4, [!!vul[team], !!vul[1 - team]]).pic : null));
  const voids = hidden.map((x) => new Set(d.voids?.[x] ?? []));

  const leader = trick.length ? trick[0].by! : mover;
  const trump = d.trump ? SUITS.indexOf(d.trump) : 4;
  const shown = trick.map((c) => {
    const p = parseCard(c.id);
    return { suit: SUITS.indexOf(p.suit), rank: p.rank - 2 };
  });
  const maskOf = (cards: string[]) => {
    const m = [0, 0, 0, 0];
    for (const c of cards) {
      const p = parseCard(c);
      m[SUITS.indexOf(p.suit)] |= 1 << (p.rank - 2);
    }
    return m;
  };

  const total = new Map<string, number>(legal.map((c) => [c, 0]));
  const best = new Map<string, number>(legal.map((c) => [c, 0]));
  let runs = 0;
  let strict = true;
  const stop = now() + budget.ms;
  for (let tries = 0; moreSamples(runs, budget.samples, budget.least, stop) && tries < budget.samples * 60; tries++) {
    // (after many misses, the bids are let go: someone may have bid a little off the card)
    if (tries === budget.samples * 30) strict = false;
    const dealt = deal(pool, counts, voids, rand);
    if (!dealt) continue;
    if (strict && !hidden.every((x, i) => !pics[i] || fits(pics[i]!, [...dealt[i], ...(d.played?.[x] ?? [])]))) continue;
    const hands = [0, 1, 2, 3].map((x) => maskOf(known.get(x) ?? dealt[hidden.indexOf(x)]));
    const values = solveCards({ hands, trump, leader, trick: shown });
    if (!values) return null;
    runs++;
    const top = Math.max(...values.map((v) => v.tricks));
    for (const v of values) {
      const id = `${RANKS[v.rank]}${SUITS[v.suit]}`;
      if (!total.has(id)) continue;
      total.set(id, total.get(id)! + v.tricks);
      if (v.tricks === top) best.set(id, best.get(id)! + 1);
    }
  }
  if (!runs) return null;
  // the most tricks on average; then the card that's best most often (it keeps the most chances);
  // then the cheapest
  const score = (c: string) => total.get(c)! / runs + (0.05 * best.get(c)!) / runs;
  return [...legal].sort((a, b) => score(b) - score(a) || parseCard(a).rank - parseCard(b).rank)[0];

  function fits(p: Picture, cards: string[]): boolean {
    const hand: Hand = SUITS.map((x) =>
      cards
        .filter((c) => suitOf(g, s, c) === x)
        .map((c) => parseCard(c).rank)
        .sort((a, b) => b - a),
    );
    const h = handInfo(hand);
    if (h.hcp < p.hcp[0] || h.hcp > p.hcp[1]) return false;
    if (h.len.some((n, k) => n < p.minLen[k] || n > p.maxLen[k])) return false;
    return !p.test || p.test(hand);
  }
}

/** The unseen cards dealt to the hidden hands (sizes `counts`), none in a suit its holder is out of. */
function deal(pool: string[], counts: number[], voids: Set<string>[], rand: () => number): string[][] | null {
  const cards = [...pool];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const out: string[][] = counts.map(() => []);
  // the cards that can only go one way first, so the free choices don't use up the room they need
  const choices = (c: string) => counts.map((_, i) => i).filter((i) => !voids[i].has(c[1]));
  cards.sort((a, b) => choices(a).length - choices(b).length);
  for (const c of cards) {
    const open = choices(c).filter((i) => out[i].length < counts[i]);
    if (!open.length) return null;
    out[open[Math.floor(rand() * open.length)]].push(c);
  }
  return out;
}
