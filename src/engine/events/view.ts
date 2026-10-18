import { boardAt, boardsPerRound, isDuplicate, travellers, type Traveller } from './duplicate';
import { isMtt, mttView, type MttView } from './mtt';
import { tableSizes } from './pairing';
import { standings } from './standings';
import type { EventState, FormatId, StandingRow, TableRound } from './types';

/**
 * What everyone may see of a tournament (the screens, and every player): the standings, the
 * round's tables and the bracket. Never a table's deal or its private inputs; in duplicate, nothing
 * of a board (how it went, its hands) until every table has played it.
 */
export interface EventPublic {
  name: string;
  format: FormatId;
  game: { id: string; options: Record<string, number | boolean> };
  /** People to a side: 2 in a partnership game (they sign up as pairs). */
  perSide: number;
  phase: EventState['phase'];
  /** The round being played or just played (0 before the start). */
  round: number;
  /** Swiss and duplicate: the rounds it will play. */
  rounds?: number;
  /** Duplicate: boards a round. */
  boards?: number;
  /**
   * What the standings' numbers are, when not points and the game's score (duplicate pairs: a
   * percentage and matchpoints; poker: chips, and no games played).
   */
  units?: { points: string; score: string; played?: false };
  entrants: { id: string; name: string; bot?: boolean; out?: boolean }[];
  standings: StandingRow[];
  /**
   * The round's tables: each side's entrant (null: a bot filling the gap), and once it's done, places
   * (not in duplicate, where a table's result means something only beside the others'). Duplicate:
   * the board it's on; teams, its match. Poker: each player's chips (0: out).
   */
  tables: { table: number; sides: (string | null)[]; done?: boolean; places?: number[]; board?: number; match?: number; chips?: number[] }[];
  byes: string[];
  /** Knockout: every round, table by table, and who went through; then the rounds to come (`later`). */
  bracket?: BracketRound[];
  /** Duplicate: the round's boards every table has played, each with every table's result and its hands. */
  travellers?: Traveller[];
  /** Multi-table poker: the blinds now and next, when they go up, how many are left and the average stack. */
  mtt?: MttView;
}

/**
 * A knockout round in the bracket: its places in order (two sides a table: each pair meets, and
 * the winners of two neighbouring pairs meet next). A `bye` is someone through with nobody to play
 * (or, both places empty, nobody at all). The rounds to come have their places filled in as far
 * as anyone has gone through to them.
 */
export interface BracketRound {
  round: number;
  tables: { sides: (string | null)[]; through: string[]; bye?: boolean }[];
  later?: boolean;
}

/** One person's place in the tournament: their entrant, where they sit this round (table and seat), and how they stand. */
export interface EventPersonal {
  entrant: string | null;
  name: string | null;
  round: number;
  table: number | null;
  /** Their seat at the table (its game seat). */
  seat: number | null;
  bye: boolean;
  rank: number | null;
  points: number | null;
  out: boolean;
}

const sidesOf = (e: EventState, seats: { entrant: string | null }[]) => e.config.sides.map((side) => seats[side[0]]?.entrant ?? null);

export function publicView(e: EventState): EventPublic {
  const r = e.rounds.at(-1);
  const rows = standings(e);
  const dup = isDuplicate(e);
  const mtt = isMtt(e);
  return {
    name: e.config.name,
    format: e.config.format,
    game: e.config.game,
    perSide: e.config.sides[0]?.length ?? 1,
    phase: e.phase,
    round: r?.n ?? 0,
    ...((e.config.format === 'swiss' || dup) && e.config.rounds ? { rounds: e.config.rounds } : {}),
    ...(dup ? { boards: boardsPerRound(e) } : {}),
    ...(e.config.format === 'pairs'
      ? { units: { points: '%', score: 'MPs' } }
      : e.config.format === 'teams'
        ? { units: { points: 'Pts', score: 'IMPs' } }
        : mtt
          ? { units: { points: 'Chips', score: '', played: false as const } }
          : {}),
    entrants: e.entrants.map((x) => ({ id: x.id, name: x.name, ...(x.bot ? { bot: true } : {}), ...(x.out ? { out: true } : {}) })),
    standings: rows,
    tables: (r?.tables ?? []).map((t) => {
      const board = dup && r ? boardAt(r, t) : null;
      return {
        table: t.table,
        // (poker: everyone at the table, however many)
        sides: mtt ? t.seats.map((s) => s.entrant) : sidesOf(e, t.seats),
        ...(t.result ? { done: true } : {}),
        ...(t.result && !dup ? { places: e.config.sides.map((side) => t.result!.places[side[0]]) } : {}),
        ...(board != null ? { board } : {}),
        ...(t.match ? { match: t.match } : {}),
        ...(mtt && e.mtt ? { chips: t.seats.map((s) => (s.entrant ? (e.mtt!.chips[s.entrant] ?? 0) : 0)) } : {}),
      };
    }),
    byes: r?.byes ?? [],
    ...(e.config.format === 'knockout' ? { bracket: bracket(e) } : {}),
    ...(dup && r ? { travellers: travellers(e, r) } : {}),
    ...(mtt && e.mtt ? { mtt: mttView(e) } : {}),
  };
}

function bracket(e: EventState): BracketRound[] {
  const k = e.config.sides.length;
  const out: BracketRound[] = e.rounds.map((round, i) => {
    const next = e.rounds[i + 1];
    // (who went through: everyone at the next round; once the round is over and the next not yet
    // drawn, or after the final, those the bracket has moved on; while it's played, a finished
    // table's winners, unless a tie at the line waits for the draw of lots)
    const on = next
      ? new Set([...next.byes, ...next.tables.flatMap((t) => t.seats.map((s) => s.entrant))])
      : e.phase !== 'playing'
        ? new Set(e.order ?? [])
        : null;
    const count = k === 2 || round.tables.length === 1 ? 1 : (e.config.advance ?? 1);
    const slot = (t: TableRound) => {
      const sides = sidesOf(e, t.seats);
      let through: string[] = [];
      if (on) through = sides.filter((x): x is string => !!x && on.has(x));
      else if (t.result) {
        const top = sides.filter((x, j): x is string => !!x && t.result!.places[e.config.sides[j][0]] < count);
        if (top.length === count) through = top;
      }
      return { sides, through };
    };
    const bye = (who: string | null) => ({ sides: [who, null], through: who ? [who] : [], bye: true });
    if (!round.order) return { round: round.n, tables: [...round.tables.map(slot), ...round.byes.map(bye)] };
    const tables: BracketRound['tables'] = [];
    for (let j = 0; j + 1 < round.order.length; j += 2) {
      const [a, b] = [round.order[j], round.order[j + 1]];
      const t = round.tables.find((x) => x.seats.some((s) => s.entrant === a) && x.seats.some((s) => s.entrant === b));
      tables.push(t ? slot(t) : bye(a ?? b));
    }
    return { round: round.n, tables };
  });
  // the rounds to come
  const last = out.at(-1);
  if (!last || e.phase === 'done' || last.tables.length < 2) return out;
  let n = last.round;
  if (k === 2) {
    for (let prev = last.tables; prev.length >= 2;) {
      const tables = Array.from({ length: Math.floor(prev.length / 2) }, (_, j) => ({
        sides: [prev[2 * j].through[0] ?? null, prev[2 * j + 1].through[0] ?? null],
        through: [],
      }));
      out.push({ round: ++n, tables, later: true });
      prev = tables;
    }
    return out;
  }
  for (let alive = last.tables.length * (e.config.advance ?? 1); alive > 1;) {
    const tables = alive <= k ? 1 : tableSizes(alive, k).length;
    out.push({ round: ++n, tables: Array.from({ length: tables }, () => ({ sides: Array<null>(k).fill(null), through: [] })), later: true });
    if (tables === 1) break;
    alive = tables * (e.config.advance ?? 1);
  }
  return out;
}

/** Where `member` stands. `rows`: the standings, when they're to hand (worked out once for everyone). */
export function personalView(e: EventState, member: string, rows: StandingRow[] = standings(e)): EventPersonal {
  const x = e.entrants.find((y) => y.members.includes(member));
  const r = e.rounds.at(-1);
  const t = r?.tables.find((y) => y.seats.some((s) => s.member === member));
  const seat = t ? t.seats.findIndex((s) => s.member === member) : -1;
  const row = x ? rows.find((y) => y.entrant === x.id) : undefined;
  return {
    entrant: x?.id ?? null,
    name: x?.name ?? null,
    round: r?.n ?? 0,
    table: t?.table ?? null,
    seat: seat >= 0 ? seat : null,
    bye: !!x && !!r?.byes.includes(x.id),
    rank: row?.rank ?? null,
    points: row?.points ?? null,
    out: !!x?.out,
  };
}
