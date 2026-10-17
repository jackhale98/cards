import { nextRandom, shuffle } from '../rng';
import { meetings, sideResults, standings } from './standings';
import type { EventState, TableRound } from './types';

/**
 * Who meets whom each round. A round is a list of tables, each listing the entrant for each side
 * (null: a bot fills the gap), and the entrants with a bye. Null: the event is over.
 */
export interface Pairing {
  tables: (string | null)[][];
  byes: string[];
  /** The bracket's places, for its picture (see Round). */
  order?: (string | null)[];
}

const active = (e: EventState) => e.entrants.filter((x) => !x.out);
const metCount = (met: Map<string, Map<string, number>>, a: string, b: string) => met.get(a)?.get(b) ?? 0;

/** Table sizes as even as they can be: `n` entrants at tables of `k` sides (bots fill the gaps). */
export function tableSizes(n: number, k: number): number[] {
  const tables = Math.max(1, Math.ceil(n / k));
  const base = Math.floor(n / tables);
  return Array.from({ length: tables }, (_, i) => base + (i < n % tables ? 1 : 0));
}

/** A table's sides in a fair order: who sits where shouldn't depend on rank. */
function seatOrder(e: EventState, sides: (string | null)[]): (string | null)[] {
  return shuffle([...sides], e);
}

// ---- Swiss ---------------------------------------------------------------------------------

/** Rounds a Swiss event plays unless the director says: enough for one winner to stand out. */
export const swissRounds = (entrants: number, sides: number) => Math.max(1, Math.ceil(Math.log(Math.max(2, entrants)) / Math.log(sides)));

/**
 * Swiss: everyone plays every round, against others on the same points, never the same opponent
 * twice while that can be avoided. With two sides a table and an odd number, the lowest who
 * hasn't had one gets a bye (worth a win); with more sides, bots fill the gaps.
 */
export function swiss(e: EventState): Pairing | null {
  const k = e.config.sides.length;
  if (e.rounds.length >= (e.config.rounds ?? swissRounds(active(e).length, k))) return null;
  const ranked = standings(e)
    .filter((r) => !r.out)
    .map((r) => r.entrant);
  if (ranked.length < 2) return null;
  const met = meetings(e);
  const byes: string[] = [];
  if (k === 2 && ranked.length % 2) {
    const had = new Set(e.rounds.flatMap((r) => r.byes));
    const pick = [...ranked].reverse().find((id) => !had.has(id)) ?? ranked.at(-1)!;
    byes.push(pick);
    ranked.splice(ranked.indexOf(pick), 1);
  }
  const tables = k === 2 ? pairUp(ranked, met) : groupUp(ranked, k, met);
  return { tables: tables.map((t) => seatOrder(e, t)), byes };
}

/**
 * Two a table, top down: each with the next on points they haven't met, backing up when a choice
 * leaves someone below with nobody new to play. If repeats can't be avoided, as few as can be.
 */
function pairUp(ranked: string[], met: Map<string, Map<string, number>>): string[][] {
  let budget = 50_000;
  const used = new Set<string>();
  const out: string[][] = [];
  const go = (): boolean => {
    const i = ranked.findIndex((x) => !used.has(x));
    if (i < 0) return true;
    const a = ranked[i];
    used.add(a);
    for (let j = i + 1; j < ranked.length && budget > 0; j++) {
      const b = ranked[j];
      if (used.has(b) || metCount(met, a, b)) continue;
      budget--;
      used.add(b);
      out.push([a, b]);
      if (go()) return true;
      used.delete(b);
      out.pop();
    }
    used.delete(a);
    return false;
  };
  if (go()) return out;
  // (repeats can't be avoided: each with the next they've met least)
  const left = [...ranked];
  const pairs: string[][] = [];
  while (left.length > 1) {
    const a = left.shift()!;
    let best = 0;
    for (let j = 1; j < left.length; j++) if (metCount(met, a, left[j]) < metCount(met, a, left[best])) best = j;
    pairs.push([a, left.splice(best, 1)[0]]);
  }
  return pairs;
}

/** More than two sides a table: tables filled top down, each with the next on points who has met the table's players least. */
function groupUp(ranked: string[], k: number, met: Map<string, Map<string, number>>): (string | null)[][] {
  const left = [...ranked];
  return tableSizes(ranked.length, k).map((size) => {
    const table: string[] = [left.shift()!];
    while (table.length < size) {
      // (looking a little way down, so tables stay among players on similar points)
      const window = left.slice(0, Math.max(size * 2, 4));
      let best = 0;
      const clash = (id: string) => table.reduce((n, x) => n + metCount(met, id, x), 0);
      for (let j = 1; j < window.length; j++) if (clash(window[j]) < clash(window[best])) best = j;
      table.push(left.splice(best, 1)[0]);
    }
    return [...table, ...Array<null>(k - table.length).fill(null)];
  });
}

// ---- round robin ---------------------------------------------------------------------------

/**
 * Round robin (two sides a table): everyone plays everyone once, by the circle method on the
 * draw's order. With an odd number, each sits out one round (a bye, worth nothing: everyone has one).
 */
export function roundRobin(e: EventState): Pairing | null {
  if (e.config.sides.length !== 2) return null;
  const order = e.order ?? [];
  const n = order.length;
  const r = e.rounds.length;
  if (n < 2 || r >= n - 1) return null;
  // (the first stays put; the rest turn one place a round)
  const rest = order.slice(1);
  const turned = [...rest.slice(rest.length - (r % rest.length)), ...rest.slice(0, rest.length - (r % rest.length))];
  const ring = [order[0], ...turned];
  const still = new Set(active(e).map((x) => x.id));
  const tables: string[][] = [];
  const byes: string[] = [];
  for (let i = 0; i < n / 2; i++) {
    // (someone who has withdrawn leaves their opponent a bye)
    const a = ring[i] && still.has(ring[i]!) ? ring[i] : null;
    const b = ring[n - 1 - i] && still.has(ring[n - 1 - i]!) ? ring[n - 1 - i] : null;
    if (a && b) tables.push((r + i) % 2 ? [b, a] : [a, b]);
    else if (a || b) byes.push((a ?? b)!);
  }
  return { tables, byes };
}

/** Round robin's draw: everyone in a random order, and an empty place when there's an odd number. */
export function roundRobinOrder(e: EventState): (string | null)[] {
  const ids = shuffle(
    active(e).map((x) => x.id),
    e,
  );
  return ids.length % 2 ? [...ids, null] : ids;
}

// ---- knockout -------------------------------------------------------------------------------

/** Where each seed starts in a bracket of `size` (a power of two), so the top two can only meet in the final. */
export function bracketSeeds(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) seeds = seeds.flatMap((s) => [s, seeds.length * 2 + 1 - s]);
  return seeds;
}

/**
 * The knockout's first round. Two sides a table: a bracket, the draw seeding it, byes to the top
 * seeds. More: everyone still in, in the draw's order.
 */
export function knockoutOrder(e: EventState): (string | null)[] {
  const ids = active(e)
    .slice()
    .sort((a, b) => (a.draw ?? 0) - (b.draw ?? 0))
    .map((x) => x.id);
  if (e.config.sides.length !== 2) return ids;
  let size = 1;
  while (size < ids.length) size *= 2;
  return bracketSeeds(size).map((s) => ids[s - 1] ?? null);
}

/**
 * Knockout: the tables of the round, from those still in. Two sides: the bracket's pairs (a pair
 * with a bye goes through at once). More sides: tables as even as can be, the top `advance` of
 * each going through; when there are few enough for one table, that's the final.
 */
export function knockout(e: EventState): Pairing | null {
  // (someone who has withdrawn leaves their place empty: their opponent goes through)
  const still = new Set(active(e).map((x) => x.id));
  const order = (e.order ?? []).map((x) => (x && still.has(x) ? x : null));
  const alive = order.filter((x): x is string => !!x);
  if (alive.length < 2) return null;
  const k = e.config.sides.length;
  if (k === 2) {
    const tables: string[][] = [];
    const byes: string[] = [];
    for (let i = 0; i + 1 < order.length; i += 2) {
      const [a, b] = [order[i], order[i + 1]];
      if (a && b) tables.push([a, b]);
      else if (a || b) byes.push((a ?? b)!);
    }
    return { tables, byes, order };
  }
  const left = [...alive];
  const tables = tableSizes(alive.length, k).map((size) => [...left.splice(0, size), ...Array<null>(k - size).fill(null)]);
  return { tables: tables.map((t) => seatOrder(e, t)), byes: [] };
}

/** Who goes through from a finished table: the best placed (score, then a draw of lots, breaking a tie). */
export function goingThrough(e: EventState, t: TableRound, count: number): string[] {
  const sides = sideResults(e, t)
    .filter((s): s is typeof s & { entrant: string } => !!s.entrant)
    .map((s) => ({ ...s, lot: nextRandom(e) }));
  sides.sort((a, b) => a.place - b.place || (b.score ?? 0) - (a.score ?? 0) || a.lot - b.lot);
  return sides.slice(0, count).map((s) => s.entrant);
}

/** After a knockout round: those going through, in bracket order. */
export function knockoutAdvance(e: EventState) {
  const r = e.rounds.at(-1);
  if (!r || !e.order) return;
  const k = e.config.sides.length;
  if (k === 2) {
    const next: (string | null)[] = [];
    for (let i = 0; i + 1 < e.order.length; i += 2) {
      const [a, b] = [e.order[i], e.order[i + 1]];
      const t = r.tables.find((x) => x.seats.some((s) => s.entrant === a) && x.seats.some((s) => s.entrant === b));
      // (a pair with a bye, or someone withdrawn: whoever had the bye goes through)
      next.push(t ? (goingThrough(e, t, 1)[0] ?? null) : ([a, b].find((x) => x && r.byes.includes(x)) ?? null));
    }
    e.order = next;
    return;
  }
  const alive = e.order.filter((x): x is string => !!x);
  const final = alive.length <= k;
  e.order = r.tables.flatMap((t) => goingThrough(e, t, final ? 1 : (e.config.advance ?? 1)));
}
