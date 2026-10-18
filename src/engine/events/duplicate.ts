import { buildDeck } from '../cards';
import { boardDealer, boardVul, imps, matchpoints, matchpointTop, type Vulnerable } from '../lib/duplicate';
import { nextRandom, shuffle } from '../rng';
import type { Board, BoardResult } from '../types';
import type { Entrant, EventState, Round, StandingRow, TableRound, TableSeat } from './types';

/**
 * Duplicate bridge as a tournament. Every table of a round plays the same boards, dealt here from
 * the event's dice, so each result is compared with the others on that board:
 *
 * - Pairs: each partnership against every other sitting the same way on the board, in matchpoints,
 *   added up as a percentage of the most it could have scored on the boards it played.
 * - Teams of four: two pairs, one sitting North–South at one table and the other East–West at the
 *   other table of their match, against another team's pairs the other way round. Each board's two
 *   results net to a swing in IMPs, and the match is won on IMPs.
 *
 * Pairs and teams meet as in a Swiss (see pairing.ts): on similar standing, never the same twice
 * while that can be avoided. A board counts once every table of its round has played it (before
 * that, a table still to play it could learn how it went: see `released`).
 */

export const isDuplicate = (e: Pick<EventState, 'config'>) => e.config.format === 'pairs' || e.config.format === 'teams';

/** Boards a round plays unless the director says. */
export const BOARDS_PER_ROUND = { pairs: 3, teams: 6 } as const;
export const boardsPerRound = (e: Pick<EventState, 'config'>) => e.config.boards ?? BOARDS_PER_ROUND[e.config.format === 'teams' ? 'teams' : 'pairs'];

/** Rounds unless the director says: pairs meet up to seven others, teams up to four. */
export const duplicateRounds = (teams: boolean, entrants: number) => Math.max(1, Math.min(entrants - 1, teams ? 4 : 7));

/** The fewest entrants to start: two tables to compare (pairs), or one match (teams). */
export const duplicateMin = (teams: boolean) => (teams ? 2 : 4);

/** A round's boards: numbered on from the last round's (so dealer and vulnerability go round), dealt from the event's dice. */
export function dealRound(e: EventState, round: number): Board[] {
  const count = boardsPerRound(e);
  return Array.from({ length: count }, (_, k) => {
    const deck = shuffle(buildDeck(), e);
    return { n: (round - 1) * count + k + 1, hands: [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13)) };
  });
}

const seat = (entrant: string | null, member: string | undefined): TableSeat => ({ entrant, member: member || null });

/**
 * Pairs: a table for each pairing. The pair that has sat North–South less often does now (a toss
 * when they're even), so everyone takes both ways round.
 */
export function seatPairs(e: EventState, tables: (string | null)[][]): TableRound[] {
  const ns = new Map<string, number>();
  for (const r of e.rounds) for (const t of r.tables) if (t.seats[0].entrant) ns.set(t.seats[0].entrant, (ns.get(t.seats[0].entrant) ?? 0) + 1);
  return tables.map(([a, b], i) => {
    const swap = (ns.get(a!) ?? 0) > (ns.get(b!) ?? 0) || ((ns.get(a!) ?? 0) === (ns.get(b!) ?? 0) && nextRandom(e) < 0.5);
    const [n, w] = swap ? [b, a] : [a, b];
    const pn = e.entrants.find((x) => x.id === n);
    const pw = e.entrants.find((x) => x.id === w);
    return {
      table: i + 1,
      seats: [seat(n, pn?.members[0]), seat(w, pw?.members[0]), seat(n, pn?.members[1]), seat(w, pw?.members[1])],
      seed: Math.floor(nextRandom(e) * 2 ** 32),
    };
  });
}

/**
 * Teams: two tables for each match. A team's first pair (its first two members) sits North–South
 * at one, its second pair East–West at the other, and the other team the other way round.
 */
export function seatTeams(e: EventState, matches: (string | null)[][]): TableRound[] {
  return matches.flatMap((m, i) => {
    const [a, b] = shuffle([...m], e).map((id) => e.entrants.find((x) => x.id === id));
    const at = (x: Entrant | undefined, k: number) => seat(x?.id ?? null, x?.members[k]);
    const table = (ns: Entrant | undefined, ew: Entrant | undefined, k: number): TableRound => ({
      table: 2 * i + k + 1,
      match: i + 1,
      seats: [at(ns, 0), at(ew, 2), at(ns, 1), at(ew, 3)],
      seed: Math.floor(nextRandom(e) * 2 ** 32),
    });
    return [table(a, b, 0), table(b, a, 1)];
  });
}

/** The boards a round plays (each table has them all). */
export const roundBoards = (r: Round): number[] => r.tables[0]?.setup?.boards?.map((b) => b.n) ?? [];

/** A table's result on a board, once it's played it. */
export const resultOn = (t: TableRound, n: number): BoardResult | undefined => t.report?.boards?.find((b) => b.n === n);

/** Teams: the other table of a table's match. */
export const otherTable = (r: Round, t: TableRound): TableRound | undefined => (t.match ? r.tables.find((x) => x !== t && x.match === t.match) : undefined);

/**
 * The boards of a round every table has finished with (played, or done without it, the game ended
 * early): their results can be shown, and count.
 */
export function released(r: Round): number[] {
  return roundBoards(r).filter((n) => r.tables.every((t) => t.result || resultOn(t, n)));
}

/** The board a table is on (null: it has played them all, or isn't dealing yet). */
export function boardAt(r: Round, t: TableRound): number | null {
  if (t.result) return null;
  return roundBoards(r).find((n) => !resultOn(t, n)) ?? null;
}

/**
 * Whether a table may be shown on the screens as it plays: not while another table still has to
 * play the board it's on (they'd see how it goes). Any game but duplicate, always.
 */
export function showable(e: EventState, table: number): boolean {
  const r = e.rounds.at(-1);
  if (!isDuplicate(e) || !r || e.phase !== 'playing') return true;
  const t = r.tables.find((x) => x.table === table);
  const n = t ? boardAt(r, t) : null;
  return n == null || r.tables.every((x) => x === t || x.result || resultOn(x, n));
}

/** Matchpoints on a board: each table's North–South and East–West pairs', and the most either could score. */
function boardMatchpoints(r: Round, n: number): { at: TableRound[]; ns: number[]; top: number } {
  const at = r.tables.filter((t) => resultOn(t, n));
  return { at, ns: matchpoints(at.map((t) => resultOn(t, n)!.ns)), top: matchpointTop(at.length) };
}

/** Teams: the swing on a board between a match's two tables, in IMPs to the North–South team at `t`. */
function swing(r: Round, t: TableRound, n: number): number | null {
  const o = otherTable(r, t);
  const here = resultOn(t, n);
  const there = o && resultOn(o, n);
  return here && there ? imps(here.ns - there.ns) : null;
}

/**
 * Standings. Pairs: by percentage (matchpoints scored of those there were to score, on the boards
 * they played), and their matchpoints. Teams: a point for a match won and a half for a tie (a bye
 * is worth a win), then IMPs. Only boards every table has finished count.
 */
export function duplicateStandings(e: EventState): StandingRow[] {
  const rows = new Map<string, StandingRow & { got: number; top: number }>(
    e.entrants.map((x) => [
      x.id,
      {
        entrant: x.id,
        name: x.name,
        rank: 0,
        points: 0,
        played: 0,
        wins: 0,
        score: 0,
        opponents: 0,
        ...(x.out ? { out: true } : {}),
        ...(x.bot ? { bot: true } : {}),
        got: 0,
        top: 0,
      },
    ]),
  );
  const pairs = e.config.format === 'pairs';
  for (const r of e.rounds) {
    const done = new Set(released(r));
    const all = roundBoards(r).every((n) => done.has(n));
    if (pairs) {
      for (const n of done) {
        const { at, ns, top } = boardMatchpoints(r, n);
        if (!top) continue;
        at.forEach((t, i) => {
          for (const [entrant, mp] of [
            [t.seats[0].entrant, ns[i]],
            [t.seats[1].entrant, top - ns[i]],
          ] as const) {
            const row = entrant ? rows.get(entrant) : undefined;
            if (!row) continue;
            row.got += mp;
            row.top += top;
          }
        });
      }
      if (all) for (const t of r.tables) for (const s of [t.seats[0], t.seats[1]]) if (s.entrant) rows.get(s.entrant)!.played++;
      continue;
    }
    if (!all) continue;
    for (const id of r.byes) {
      const row = rows.get(id);
      if (row) row.points += 1;
    }
    for (const t of r.tables) {
      const o = otherTable(r, t);
      // (each match once: from its first table, whose North–South team is "us")
      if (!o || o.table < t.table) continue;
      const net = [...done].reduce((sum, n) => sum + (swing(r, t, n) ?? 0), 0);
      for (const [entrant, mine] of [
        [t.seats[0].entrant, net],
        [t.seats[1].entrant, -net],
      ] as const) {
        const row = entrant ? rows.get(entrant) : undefined;
        if (!row) continue;
        row.played++;
        row.score = (row.score ?? 0) + mine;
        row.points += mine > 0 ? 1 : mine === 0 ? 0.5 : 0;
        if (mine > 0) row.wins++;
      }
    }
  }
  const draw = new Map(e.entrants.map((x, i) => [x.id, x.draw ?? i]));
  for (const row of rows.values()) if (pairs) row.points = row.top ? Math.round((10_000 * row.got) / row.top) / 100 : 0;
  const key = (r: StandingRow & { got: number }) => (pairs ? [r.points, r.got] : [r.points, r.score ?? 0]);
  const cmp = (a: StandingRow & { got: number }, b: StandingRow & { got: number }) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...rows.values()].sort((a, b) => cmp(a, b) || draw.get(a.entrant)! - draw.get(b.entrant)!);
  sorted.forEach((row, i) => (row.rank = i && !cmp(sorted[i - 1], row) ? sorted[i - 1].rank : i + 1));
  return sorted.map(({ got, top: _t, ...row }) => (pairs ? { ...row, score: got } : row));
}

/** A board's results at every table (once every table has played it), and its hands. */
export interface Traveller {
  n: number;
  /** Who dealt (a seat: North 0, East 1, South 2, West 3), and who was vulnerable. */
  dealer: number;
  vul: Vulnerable;
  /** Each seat's hand. */
  hands: string[][];
  /** Pairs: the most matchpoints a pair could score on it. */
  top?: number;
  rows: {
    table: number;
    /** The entrants sitting North–South and East–West (null: bots filling a gap). */
    ns: string | null;
    ew: string | null;
    /** The contract ("4SX": four spades doubled; null: passed out), who declared it, the tricks they took. */
    contract: string | null;
    declarer: number | null;
    tricks: number | null;
    /** Tricks over the contract (0: just made; less: down). */
    made: number | null;
    /** North–South's score. */
    score: number;
    /** Pairs: North–South's matchpoints (East–West's are the top less these). */
    mp?: number;
    /** Teams: the swing to North–South's team against their match's other table. */
    imps?: number;
  }[];
}

/** The travellers of a round's boards that every table has finished with, in board order. */
export function travellers(e: EventState, r: Round): Traveller[] {
  const boards = r.tables[0]?.setup?.boards ?? [];
  const done = new Set(released(r));
  const pairs = e.config.format === 'pairs';
  return boards
    .filter((b) => done.has(b.n))
    .map((b) => {
      const { at, ns, top } = boardMatchpoints(r, b.n);
      return {
        n: b.n,
        dealer: boardDealer(b.n),
        vul: boardVul(b.n),
        hands: b.hands.map((h) => [...h]),
        ...(pairs ? { top } : {}),
        rows: at.map((t, i) => {
          const res = resultOn(t, b.n)!;
          const imp = pairs ? null : swing(r, t, b.n);
          return {
            table: t.table,
            ns: t.seats[0].entrant,
            ew: t.seats[1].entrant,
            contract: res.contract,
            declarer: res.declarer,
            tricks: res.tricks,
            made: res.contract && res.tricks != null ? res.tricks - 6 - Number(res.contract[0]) : null,
            score: res.ns,
            ...(pairs ? { mp: ns[i] } : imp != null ? { imps: imp } : {}),
          };
        }),
      };
    });
}
