import { standings } from './standings';
import type { EventState, FormatId, StandingRow } from './types';

/**
 * What everyone may see of a tournament (the screens, and every player): the standings, the
 * round's tables and the bracket. Never a table's deal or its private inputs.
 */
export interface EventPublic {
  name: string;
  format: FormatId;
  game: { id: string; options: Record<string, number | boolean> };
  phase: EventState['phase'];
  /** The round being played or just played (0 before the start). */
  round: number;
  /** Swiss: the rounds it will play. */
  rounds?: number;
  entrants: { id: string; name: string; bot?: boolean; out?: boolean }[];
  standings: StandingRow[];
  /** The round's tables: each side's entrant (null: a bot filling the gap), and places once it's done. */
  tables: { table: number; sides: (string | null)[]; places?: number[] }[];
  byes: string[];
  /** Knockout: every round so far, table by table, and who went through. */
  bracket?: { round: number; tables: { sides: (string | null)[]; through: string[] }[]; byes: string[] }[];
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
  return {
    name: e.config.name,
    format: e.config.format,
    game: e.config.game,
    phase: e.phase,
    round: r?.n ?? 0,
    ...(e.config.format === 'swiss' && e.config.rounds ? { rounds: e.config.rounds } : {}),
    entrants: e.entrants.map((x) => ({ id: x.id, name: x.name, ...(x.bot ? { bot: true } : {}), ...(x.out ? { out: true } : {}) })),
    standings: rows,
    tables: (r?.tables ?? []).map((t) => ({
      table: t.table,
      sides: sidesOf(e, t.seats),
      ...(t.result ? { places: e.config.sides.map((side) => t.result!.places[side[0]]) } : {}),
    })),
    byes: r?.byes ?? [],
    ...(e.config.format === 'knockout'
      ? {
          bracket: e.rounds.map((round, i) => {
            const next = e.rounds[i + 1];
            // (who went through: everyone at the next round; once the round is over and the next not
            // yet dealt, or after the final, those the bracket has moved on)
            const on = new Set(
              next ? [...next.byes, ...next.tables.flatMap((t) => t.seats.map((s) => s.entrant))] : e.phase !== 'playing' ? (e.order ?? []) : [],
            );
            return {
              round: round.n,
              tables: round.tables.map((t) => {
                const sides = sidesOf(e, t.seats);
                return { sides, through: sides.filter((x): x is string => !!x && on.has(x)) };
              }),
              byes: round.byes,
            };
          }),
        }
      : {}),
  };
}

export function personalView(e: EventState, member: string): EventPersonal {
  const x = e.entrants.find((y) => y.members.includes(member));
  const r = e.rounds.at(-1);
  const t = r?.tables.find((y) => y.seats.some((s) => s.member === member));
  const seat = t ? t.seats.findIndex((s) => s.member === member) : -1;
  const row = x ? standings(e).find((y) => y.entrant === x.id) : undefined;
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
