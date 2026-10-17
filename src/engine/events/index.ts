import { nextRandom, seedState, shuffle, type Seed } from '../rng';
import type { GameConfig, TableReport } from '../types';
import { knockout, knockoutAdvance, knockoutOrder, roundRobin, roundRobinOrder, swiss, swissRounds, type Pairing } from './pairing';
import { standings } from './standings';
import type { Entrant, EventConfig, EventState, FormatId, Round, TableSeat } from './types';

export * from './types';
export { standings } from './standings';
export { personalView, publicView, type BracketRound, type EventPersonal, type EventPublic } from './view';
export { bracketSeeds, swissRounds, tableSizes } from './pairing';

/**
 * A tournament's course, as plain functions over its state: take entrants, start (the draw and the
 * first round), record each table's result, and on to the next round when every table is done.
 * The director (src/net/director.ts) seats the tables and reports back; this decides everything else.
 */

const FORMATS: Record<FormatId, { pair: (e: EventState) => Pairing | null; start?: (e: EventState) => void; after?: (e: EventState) => void }> = {
  // (how many rounds is settled at the start: everyone knows, and a withdrawal doesn't change it)
  swiss: { pair: swiss, start: (e) => void (e.config.rounds ??= swissRounds(e.entrants.length, e.config.sides.length)) },
  roundRobin: { pair: roundRobin, start: (e) => (e.order = roundRobinOrder(e)) },
  knockout: { pair: knockout, start: (e) => (e.order = knockoutOrder(e)), after: knockoutAdvance },
};

/**
 * The formats a game can be played in: Swiss and knockout for any game with a result; round robin
 * only with two sides a table (everyone meets everyone).
 */
export function formatsFor(config: GameConfig, sides: number[][]): FormatId[] {
  if (config.rules.family === 'free') return [];
  return sides.length === 2 ? ['swiss', 'roundRobin', 'knockout'] : ['swiss', 'knockout'];
}

export function createEvent(config: EventConfig, seed: Seed): EventState {
  return { config: structuredClone(config), entrants: [], rounds: [], phase: 'registering', rng: seedState(seed) };
}

/** How many people play for one entrant: a side's seats. */
export const sideSize = (e: EventState) => e.config.sides[0]?.length ?? 1;

/** Someone (or a partnership) signs up. Null: done; else why not. */
export function addEntrant(e: EventState, x: Entrant): string | null {
  if (e.phase !== 'registering') return 'The tournament has started';
  if (!x.id || e.entrants.some((y) => y.id === x.id)) return 'Already signed up';
  if (!x.bot && x.members.length !== sideSize(e)) return sideSize(e) === 2 ? 'Sign up as a pair' : 'Sign up one at a time';
  // (an empty member is a bot partnering someone left without a partner)
  const people = x.members.filter(Boolean);
  const taken = new Set(e.entrants.flatMap((y) => y.members).filter(Boolean));
  if (people.some((m) => taken.has(m)) || new Set(people).size !== people.length) return 'Already signed up';
  e.entrants.push({ id: x.id, name: x.name, members: [...x.members], ...(x.names ? { names: [...x.names] } : {}), ...(x.bot ? { bot: true } : {}) });
  return null;
}

/** Off the list before the start; after it, withdrawn (not paired again; their results stand). */
export function withdraw(e: EventState, id: string) {
  const x = e.entrants.find((y) => y.id === id);
  if (!x) return;
  if (e.phase === 'registering') e.entrants = e.entrants.filter((y) => y !== x);
  else x.out = true;
}

/** Why the event can't start yet (null: it can). */
export function startProblem(e: EventState): string | null {
  if (e.phase !== 'registering') return 'Already started';
  if (e.entrants.filter((x) => !x.out).length < 2) return 'At least two to start';
  return null;
}

/** The draw, then the first round. */
export function startEvent(e: EventState): Round | null {
  if (startProblem(e)) return null;
  shuffle(
    e.entrants.map((x) => x),
    e,
  ).forEach((x, i) => (x.draw = i));
  FORMATS[e.config.format].start?.(e);
  return nextRound(e);
}

/** The round being played (or just finished). */
export const currentRound = (e: EventState): Round | undefined => e.rounds.at(-1);

/** The next round's tables (or the end: null). Only between rounds, or at the start. */
export function nextRound(e: EventState): Round | null {
  if (e.phase === 'done' || e.phase === 'playing') return null;
  const f = FORMATS[e.config.format];
  for (;;) {
    const p = f.pair(e);
    if (!p) {
      e.phase = 'done';
      return null;
    }
    const round: Round = {
      n: e.rounds.length + 1,
      byes: p.byes,
      tables: p.tables.map((sides, i) => seatTable(e, sides, i + 1)),
      ...(p.order ? { order: p.order } : {}),
    };
    e.rounds.push(round);
    if (round.tables.length) {
      e.phase = 'playing';
      return round;
    }
    // (only byes: that round is done already)
    f.after?.(e);
  }
}

/** A table's seats from its sides' entrants: each member in their side's seats, bots where there's nobody. */
function seatTable(e: EventState, sides: (string | null)[], table: number) {
  const seats: TableSeat[] = Array.from({ length: e.config.seats }, () => ({ entrant: null, member: null }));
  e.config.sides.forEach((side, i) => {
    const x = e.entrants.find((y) => y.id === sides[i]);
    side.forEach((seat, j) => (seats[seat] = { entrant: x?.id ?? null, member: x && !x.bot ? x.members[j] || null : null }));
  });
  return { table, seats, seed: Math.floor(nextRandom(e) * 2 ** 32) };
}

/**
 * A table's result (each seat's place, 0 = first; scores when the game keeps one per player).
 * True when it completes the round. A result for another round, an unknown table, one already in,
 * or of the wrong shape is ignored (results can arrive twice, or late).
 */
export function recordResult(e: EventState, round: number, table: number, result: { places: number[]; scores?: number[] }, report?: TableReport): boolean {
  const r = currentRound(e);
  const t = r?.tables.find((x) => x.table === table);
  if (!r || r.n !== round || !t || t.result || e.phase !== 'playing') return false;
  const ok = (a: unknown) => Array.isArray(a) && a.length === e.config.seats && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!ok(result.places) || (result.scores !== undefined && !ok(result.scores))) return false;
  t.result = { places: [...result.places], ...(result.scores ? { scores: [...result.scores] } : {}) };
  if (report) t.report = structuredClone(report);
  if (r.tables.some((x) => !x.result)) return false;
  e.phase = 'between';
  FORMATS[e.config.format].after?.(e);
  return true;
}

/** The winner (or winners, sharing first) once the event is over. */
export function winners(e: EventState): string[] {
  if (e.phase !== 'done') return [];
  return standings(e)
    .filter((r) => r.rank === 1)
    .map((r) => r.entrant);
}
