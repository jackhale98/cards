import { nextRandom, seedState, shuffle, type Seed } from '../rng';
import { familyRules, type GameConfig, type TableReport } from '../types';
import { dealRound, duplicateMin, duplicateRounds, isDuplicate, seatPairs, seatTeams } from './duplicate';
import { isMtt, mttStart } from './mtt';
import { knockout, knockoutAdvance, knockoutOrder, roundRobin, roundRobinOrder, swiss, swissRounds, type Pairing } from './pairing';
import { standings } from './standings';
import type { Entrant, EventConfig, EventState, FormatId, Round, TableRound, TableSeat } from './types';

export * from './types';
export { standings } from './standings';
export { personalView, publicView, type BracketRound, type EventPersonal, type EventPublic } from './view';
export { bracketSeeds, swissRounds, tableSizes } from './pairing';
export { BOARDS_PER_ROUND, boardAt, duplicateRounds, isDuplicate, otherTable, showable, type Traveller } from './duplicate';
export { blindsAt, isMtt, LEVEL_MINUTES, mttHand, mttPlan, mttReseat, mttTick, type MttView } from './mtt';

/**
 * A tournament's course, as plain functions over its state: take entrants, start (the draw and the
 * first round), record each table's result, and on to the next round when every table is done.
 * The director (src/net/director.ts) seats the tables and reports back; this decides everything else.
 */

interface Format {
  pair: (e: EventState) => Pairing | null;
  start?: (e: EventState) => void;
  after?: (e: EventState) => void;
  /** The round's tables from its pairing (else a table each, see seatTable). */
  seat?: (e: EventState, tables: (string | null)[][]) => TableRound[];
}

const FORMATS: Record<FormatId, Format> = {
  // (how many rounds is settled at the start: everyone knows, and a withdrawal doesn't change it)
  swiss: { pair: swiss, start: (e) => void (e.config.rounds ??= swissRounds(e.entrants.length, e.config.sides.length)) },
  roundRobin: { pair: roundRobin, start: (e) => (e.order = roundRobinOrder(e)) },
  knockout: { pair: knockout, start: (e) => (e.order = knockoutOrder(e)), after: knockoutAdvance },
  // (duplicate: pairs and teams meet as in a Swiss, ranked by their own standings: see duplicate.ts)
  pairs: { pair: swiss, start: (e) => void (e.config.rounds ??= duplicateRounds(false, e.entrants.length)), seat: seatPairs },
  teams: { pair: swiss, start: (e) => void (e.config.rounds ??= duplicateRounds(true, e.entrants.length)), seat: seatTeams },
  // (multi-table poker isn't played in rounds of pairings: it seats its own, see mtt.ts)
  mtt: { pair: () => null },
};

/**
 * The formats a game can be played in: Swiss and knockout for any game with a result; round robin
 * only with two sides a table (everyone meets everyone); a game played duplicate (bridge: its
 * module's `duplicate`), as pairs or teams; and a flop poker game (Hold'em, Omaha) as a multi-table
 * tournament, first (each table of a Swiss or a knockout plays a game to its end: a sit and go).
 */
export function formatsFor(config: GameConfig, sides: number[][], duplicate = false): FormatId[] {
  if (config.rules.family === 'free') return [];
  if (config.rules.family === 'poker') {
    const R = familyRules(config, 'poker');
    if (R.board.length && !R.draw && !R.stud) return ['mtt', 'swiss', 'knockout'];
  }
  if (sides.length !== 2) return ['swiss', 'knockout'];
  return ['swiss', 'roundRobin', 'knockout', ...(duplicate && sides.every((s) => s.length === 2) ? (['pairs', 'teams'] as const) : [])];
}

export function createEvent(config: EventConfig, seed: Seed): EventState {
  return { config: structuredClone(config), entrants: [], rounds: [], phase: 'registering', rng: seedState(seed) };
}

/** How many people play for one side at a table: its seats. */
export const sideSize = (e: EventState) => e.config.sides[0]?.length ?? 1;
/** How many people play for one entrant: a side, or a duplicate team's two. */
export const entrantSize = (e: EventState) => sideSize(e) * (e.config.format === 'teams' ? 2 : 1);

/** Someone (or a partnership, or a team) signs up. Null: done; else why not. */
export function addEntrant(e: EventState, x: Entrant): string | null {
  if (e.phase !== 'registering') return 'The tournament has started';
  if (!x.id || e.entrants.some((y) => y.id === x.id)) return 'Already signed up';
  const size = entrantSize(e);
  if (!x.bot && x.members.length !== size) return size === 4 ? 'Sign up as a team of four' : size === 2 ? 'Sign up as a pair' : 'Sign up one at a time';
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
  const n = e.entrants.filter((x) => !x.out).length;
  if (n < 2) return 'At least two to start';
  if (isDuplicate(e) && n < duplicateMin(e.config.format === 'teams'))
    return e.config.format === 'teams' ? 'At least two teams to start' : 'At least four pairs to start: two tables to compare';
  return null;
}

/** The draw, then the first round (`now`: the director's clock, for poker's blinds). */
export function startEvent(e: EventState, now = 0): Round | null {
  if (startProblem(e)) return null;
  shuffle(
    e.entrants.map((x) => x),
    e,
  ).forEach((x, i) => (x.draw = i));
  if (isMtt(e)) return mttStart(e, now);
  FORMATS[e.config.format].start?.(e);
  return nextRound(e);
}

/** The round being played (or just finished). */
export const currentRound = (e: EventState): Round | undefined => e.rounds.at(-1);

/** The next round's tables (or the end: null). Only between rounds, or at the start. */
export function nextRound(e: EventState): Round | null {
  if (e.phase === 'done' || e.phase === 'playing' || isMtt(e)) return null;
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
      tables: f.seat ? f.seat(e, p.tables) : p.tables.map((sides, i) => seatTable(e, sides, i + 1)),
      ...(p.order ? { order: p.order } : {}),
    };
    if (isDuplicate(e) && round.tables.length) {
      // (every table plays the round's boards; a team's two tables hear each other's results as they go)
      const boards = dealRound(e, round.n);
      for (const t of round.tables) t.setup = { boards: structuredClone(boards), ...(e.config.format === 'teams' ? { compared: true } : {}) };
    }
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

/**
 * A table's report as it goes (each hand): what it has played so far (duplicate: each board's
 * result, which the standings and the travellers count once every table has played the board).
 * True when it's news.
 */
export function recordReport(e: EventState, round: number, table: number, report: TableReport): boolean {
  const r = currentRound(e);
  const t = r?.tables.find((x) => x.table === table);
  if (!r || r.n !== round || !t || t.result || e.phase !== 'playing') return false;
  if (JSON.stringify(t.report) === JSON.stringify(report)) return false;
  t.report = structuredClone(report);
  return true;
}

/** The winner (or winners, sharing first) once the event is over. */
export function winners(e: EventState): string[] {
  if (e.phase !== 'done') return [];
  return standings(e)
    .filter((r) => r.rank === 1)
    .map((r) => r.entrant);
}
