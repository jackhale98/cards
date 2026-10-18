import { nextRandom, shuffle } from '../rng';
import type { Blinds, TableReport } from '../types';
import { tableSizes } from './pairing';
import type { EventState, Round, StandingRow, TableRound } from './types';

/**
 * A multi-table poker tournament (Hold'em, Omaha): everyone starts with the same chips at tables
 * drawn at random, and plays until one player has them all. The blinds go up on a clock. As players
 * are knocked out the tables are kept even (no two differ by two or more), and a table is broken
 * up as soon as everyone left fits at fewer, down to the final table.
 *
 * Each change of seats is a new round (see Round): the tables whose players changed start afresh
 * (in a new room, with each player's chips and the button where it was due), the rest carry on.
 * Finishing places go by when a player was knocked out (two in the same hand: the one who started
 * it with more chips finishes higher), the last one in first.
 */

export interface MttState {
  /** Each entrant's chips, as their table last reported them (0: knocked out). */
  chips: Record<string, number>;
  /** Who has been knocked out, first out first. */
  out: string[];
  /** The blind level (0: the first), and when it ends (ms; null until the start). */
  level: number;
  levelEnds: number | null;
}

/** How the blinds go up: each level's big blind, as a multiple of the first (10/20, 15/30, 20/40, 30/60…). */
const LADDER = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000];
/** Minutes a level unless the director says. */
export const LEVEL_MINUTES = 10;

/** A round number for chips: two significant figures (1, 15, 250, 4000…). */
const nice = (x: number) => {
  if (x < 10) return Math.max(1, Math.round(x));
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};

/** The blinds at a level: the big blind up the ladder from the game's, the small half of it, and from the fourth level an ante of a tenth. */
export function blindsAt(e: EventState, level: number): Blinds {
  const first = Number(e.config.game.options.bigBlind ?? 10);
  const mult = LADDER[Math.min(level, LADDER.length - 1)] * 2 ** Math.max(0, level - LADDER.length + 1);
  const bb = nice(first * mult);
  return { sb: Math.max(1, nice(bb / 2)), bb, ...(level >= 3 ? { ante: Math.max(1, nice(bb / 10)) } : {}) };
}

export const isMtt = (e: Pick<EventState, 'config'>) => e.config.format === 'mtt';
const live = (e: EventState) => Object.keys(e.mtt!.chips).filter((id) => e.mtt!.chips[id] > 0);
const seatOf = (e: EventState, entrant: string) => {
  const x = e.entrants.find((y) => y.id === entrant);
  return { entrant, member: x && !x.bot ? x.members[0] || null : null };
};

/** The draw: everyone at a table at random, the tables as even as they can be, the button anywhere. Round 1. */
export function mttStart(e: EventState, now: number): Round {
  const stack = Number(e.config.game.options.stack ?? 1000);
  e.mtt = { chips: Object.fromEntries(e.entrants.filter((x) => !x.out).map((x) => [x.id, stack])), out: [], level: 0, levelEnds: now + minutes(e) * 60_000 };
  const order = shuffle(Object.keys(e.mtt.chips), e);
  const tables = tableSizes(order.length, e.config.seats).map((size, i) => {
    const at = order.splice(0, size);
    return newTable(e, i + 1, at, Math.floor(nextRandom(e) * at.length));
  });
  const round: Round = { n: 1, tables, byes: [] };
  e.rounds.push(round);
  e.phase = 'playing';
  return round;
}

const minutes = (e: EventState) => e.config.minutes ?? LEVEL_MINUTES;

/** A table to deal afresh: who sits where (in order round the table), with their chips, the button, and the blinds now. */
function newTable(e: EventState, table: number, at: string[], button: number): TableRound {
  return {
    table,
    seats: at.map((id) => seatOf(e, id)),
    seed: Math.floor(nextRandom(e) * 2 ** 32),
    setup: { chips: at.map((id) => e.mtt!.chips[id]), button, blinds: blindsAt(e, e.mtt!.level) },
  };
}

/**
 * A table's hand is over: everyone's chips there, and who was knocked out in it (returned, in the
 * order they finish: the smaller stack at the start of the hand first). A report for a table not in
 * this round, or of the wrong shape, changes nothing.
 */
export function mttHand(e: EventState, round: number, table: number, report: TableReport): string[] {
  const r = e.rounds.at(-1);
  const t = r?.tables.find((x) => x.table === table);
  const m = e.mtt;
  if (!m || !r || r.n !== round || !t || e.phase !== 'playing' || !report.stacks || report.stacks.length !== t.seats.length) return [];
  t.report = structuredClone(report);
  const busted: { id: string; before: number }[] = [];
  t.seats.forEach((s, i) => {
    if (!s.entrant || !(s.entrant in m.chips)) return;
    const had = m.chips[s.entrant];
    m.chips[s.entrant] = report.stacks![i];
    if (had > 0 && report.stacks![i] === 0) busted.push({ id: s.entrant, before: report.before?.[i] ?? had });
  });
  busted.sort((a, b) => a.before - b.before);
  m.out.push(...busted.map((x) => x.id));
  if (live(e).length <= 1) e.phase = 'done';
  return busted.map((x) => x.id);
}

/** The players still in at a table. */
const liveAt = (e: EventState, t: TableRound) => t.seats.map((s) => s.entrant).filter((id): id is string => !!id && e.mtt!.chips[id] > 0);

/**
 * What needs re-seating now (the table numbers; null: nothing): a table to break up when everyone
 * left fits at fewer (the one with fewest players, the highest numbered of those), and the tables
 * that receive its players; or, the tables uneven, the biggest and the smallest.
 */
export function mttPlan(e: EventState): number[] | null {
  const r = e.rounds.at(-1);
  if (!e.mtt || !r || e.phase !== 'playing') return null;
  const tables = r.tables.map((t) => ({ t: t.table, n: liveAt(e, t).length })).filter((x) => x.n > 0);
  const players = tables.reduce((s, x) => s + x.n, 0);
  if (tables.length > Math.ceil(players / e.config.seats)) return tables.map((x) => x.t);
  const big = Math.max(...tables.map((x) => x.n));
  const small = Math.min(...tables.map((x) => x.n));
  if (big - small < 2) return null;
  return [tables.find((x) => x.n === big)!.t, tables.find((x) => x.n === small)!.t].sort((a, b) => a - b);
}

/**
 * The new seats (a new round): the tables `plan` names re-seated, the rest carried on as they are
 * (`carried`: the round their game began). A table broken up loses its number; its players, and
 * one at a time from the biggest table to the smallest, go to the seats open, at random. Everyone
 * stays in their order round the table, and the button goes to whoever was due it next.
 */
export function mttReseat(e: EventState, plan: number[]): Round {
  const r = e.rounds.at(-1)!;
  const changing = r.tables.filter((t) => plan.includes(t.table));
  const players = r.tables.reduce((s, t) => s + liveAt(e, t).length, 0);
  // who's at each changing table now, and who's due the button there next
  const at = new Map(changing.map((t) => [t.table, liveAt(e, t)]));
  const due = new Map(changing.map((t) => [t.table, dueButton(e, t)]));
  const homeless: string[] = [];
  // break up tables while everyone fits at fewer (smallest first, the highest numbered of equals),
  // as long as the other tables changing have the seats for its players (the plan may be older
  // than the latest knockouts: whatever's still to do is planned again)
  let count = r.tables.filter((t) => liveAt(e, t).length > 0).length;
  while (count > Math.max(1, Math.ceil(players / e.config.seats))) {
    const pick = [...at.entries()].filter(([, ids]) => ids.length > 0).sort((a, b) => a[1].length - b[1].length || b[0] - a[0])[0];
    const room = [...at.entries()].reduce((n, [t, ids]) => n + (t === pick?.[0] ? 0 : e.config.seats - ids.length), 0);
    if (!pick || pick[1].length + homeless.length > room) break;
    homeless.push(...pick[1]);
    at.delete(pick[0]);
    count--;
  }
  // tables of the changing ones that broke up entirely (nobody left): gone too
  for (const [n, ids] of at) if (!ids.length) at.delete(n);
  // to the seats open, the fewest players first (at random among equals)
  for (const id of shuffle(homeless, e)) {
    const open = [...at.entries()].filter(([, ids]) => ids.length < e.config.seats).sort((a, b) => a[1].length - b[1].length);
    const to = open[0];
    if (!to) break;
    to[1].splice(Math.floor(nextRandom(e) * (to[1].length + 1)), 0, id);
  }
  // then even: one at a time from the biggest to the smallest
  for (;;) {
    const sizes = [...at.entries()].sort((a, b) => b[1].length - a[1].length);
    const big = sizes[0];
    const small = sizes.at(-1);
    if (!big || !small || big[1].length - small[1].length < 2) break;
    const id = big[1].splice(Math.floor(nextRandom(e) * big[1].length), 1)[0];
    small[1].splice(Math.floor(nextRandom(e) * (small[1].length + 1)), 0, id);
  }
  const tables: TableRound[] = [];
  for (const t of r.tables) {
    if (!plan.includes(t.table)) {
      if (liveAt(e, t).length) tables.push({ ...t, carried: t.carried ?? r.n });
      continue;
    }
    const ids = at.get(t.table);
    if (!ids?.length) continue;
    const next = due.get(t.table);
    const button = Math.max(0, next ? ids.indexOf(next) : -1);
    tables.push(newTable(e, t.table, ids, button));
  }
  const round: Round = { n: r.n + 1, tables, byes: [] };
  e.rounds.push(round);
  return round;
}

/** Who has the button next at a table: the next player round from it who is still in. */
function dueButton(e: EventState, t: TableRound): string | null {
  const b = t.report?.button ?? t.setup?.button ?? 0;
  for (let i = 1; i <= t.seats.length; i++) {
    const id = t.seats[(b + i) % t.seats.length]?.entrant;
    if (id && e.mtt!.chips[id] > 0) return id;
  }
  return null;
}

/** The blind clock: the level now (moving on as many as have ended by `now`). True when it changed. */
export function mttTick(e: EventState, now: number): boolean {
  const m = e.mtt;
  if (!m || m.levelEnds == null || e.phase !== 'playing') return false;
  let changed = false;
  while (now >= m.levelEnds) {
    m.level++;
    m.levelEnds += minutes(e) * 60_000;
    changed = true;
  }
  return changed;
}

/** Standings: those still in by chips, then everyone knocked out, the last out first. */
export function mttStandings(e: EventState): StandingRow[] {
  const m = e.mtt;
  const chips = m?.chips ?? {};
  const out = m?.out ?? [];
  const row = (id: string): StandingRow => {
    const x = e.entrants.find((y) => y.id === id)!;
    return {
      entrant: id,
      name: x?.name ?? id,
      rank: 0,
      points: chips[id] ?? 0,
      played: 0,
      wins: 0,
      score: null,
      opponents: 0,
      alive: (chips[id] ?? 0) > 0,
      ...(x?.out ? { out: true } : {}),
      ...(x?.bot ? { bot: true } : {}),
    };
  };
  const alive = e.entrants
    .filter((x) => !out.includes(x.id))
    .map((x) => row(x.id))
    .sort((a, b) => b.points - a.points);
  const rows = [...alive, ...[...out].reverse().map(row)];
  rows.forEach((r, i) => (r.rank = i && r.alive && rows[i - 1].alive && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1));
  return rows;
}

/** What the screens show of the tournament: the blinds now and next, when they go up, how many are left, the average stack. */
export interface MttView {
  level: number;
  blinds: Blinds;
  next: Blinds;
  levelEnds: number | null;
  left: number;
  of: number;
  average: number;
}

export function mttView(e: EventState): MttView | undefined {
  const m = e.mtt;
  if (!m) return undefined;
  const left = live(e);
  const total = left.reduce((s, id) => s + m.chips[id], 0);
  return {
    level: m.level,
    blinds: blindsAt(e, m.level),
    next: blindsAt(e, m.level + 1),
    levelEnds: e.phase === 'playing' ? m.levelEnds : null,
    left: left.length,
    of: Object.keys(m.chips).length,
    average: left.length ? Math.round(total / left.length) : 0,
  };
}
