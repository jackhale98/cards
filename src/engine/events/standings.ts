import type { EventState, StandingRow, TableRound } from './types';

/**
 * How everyone stands. A table's sides score by place: a point for every other side they finished
 * ahead of and a half for each they tied with (3 / 2 / 1 / 0 at a table of four, 1 / 0 for two;
 * a bot filling a gap counts as a side). Then, for equal points, Swiss looks at the points of
 * everyone each has played (the strength of their opposition), then the game's own score where it
 * keeps one per player, then wins, and last the draw made when the event started.
 */

/** Each side's result at a finished table: who, their place, points, and score (when the game keeps one per player). */
export function sideResults(e: EventState, t: TableRound): { entrant: string | null; place: number; points: number; score: number | null }[] {
  if (!t.result) return [];
  const sides = e.config.sides;
  const places = sides.map((side) => t.result!.places[side[0]]);
  return sides.map((side, i) => ({
    entrant: t.seats[side[0]].entrant,
    place: places[i],
    points: places.reduce((p, other, j) => p + (j === i ? 0 : places[i] < other ? 1 : places[i] === other ? 0.5 : 0), 0),
    score: t.result!.scores?.[side[0]] ?? null,
  }));
}

/** A bye is worth a win in Swiss (one point for each other side a table has); elsewhere nothing. */
export const byePoints = (e: EventState) => (e.config.format === 'swiss' ? e.config.sides.length - 1 : 0);

/** Who has met whom, and how often (opponents at the same table). */
export function meetings(e: EventState): Map<string, Map<string, number>> {
  const met = new Map<string, Map<string, number>>();
  for (const r of e.rounds)
    for (const t of r.tables) {
      const at = [...new Set(t.seats.map((s) => s.entrant).filter((x): x is string => !!x))];
      for (const a of at) {
        const mine = met.get(a) ?? new Map<string, number>();
        met.set(a, mine);
        for (const b of at) if (a !== b) mine.set(b, (mine.get(b) ?? 0) + 1);
      }
    }
  return met;
}

export function standings(e: EventState): StandingRow[] {
  const rows = new Map<string, StandingRow & { against: Set<string>; scored: boolean }>(
    e.entrants.map((x) => [
      x.id,
      {
        entrant: x.id,
        name: x.name,
        rank: 0,
        points: 0,
        played: 0,
        wins: 0,
        score: null,
        opponents: 0,
        ...(x.out ? { out: true } : {}),
        ...(x.bot ? { bot: true } : {}),
        against: new Set<string>(),
        scored: false,
      },
    ]),
  );
  const bye = byePoints(e);
  for (const r of e.rounds) {
    for (const id of r.byes) {
      const row = rows.get(id);
      if (row) row.points += bye;
    }
    for (const t of r.tables) {
      const res = sideResults(e, t);
      for (const s of res) {
        const row = s.entrant ? rows.get(s.entrant) : undefined;
        if (!row) continue;
        row.points += s.points;
        row.played++;
        if (s.place === 0) row.wins++;
        if (s.score != null) {
          row.score = (row.score ?? 0) + s.score;
          row.scored = true;
        }
        for (const o of res) if (o.entrant && o.entrant !== s.entrant) row.against.add(o.entrant);
      }
    }
  }
  for (const row of rows.values()) row.opponents = [...row.against].reduce((n, id) => n + (rows.get(id)?.points ?? 0), 0);
  const draw = new Map(e.entrants.map((x, i) => [x.id, x.draw ?? i]));
  const alive = e.config.format === 'knockout' && e.order ? new Set(e.order.filter((x): x is string => !!x)) : null;
  const reached = (id: string) => e.rounds.filter((r) => r.byes.includes(id) || r.tables.some((t) => t.seats.some((s) => s.entrant === id))).length;
  const swiss = e.config.format === 'swiss';
  const key = (r: StandingRow): number[] =>
    alive ? [alive.has(r.entrant) ? 1 : 0, reached(r.entrant), r.points] : [r.points, swiss ? r.opponents : 0, r.score ?? 0, r.wins];
  const cmp = (a: StandingRow, b: StandingRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const out = [...rows.values()]
    .map(({ against: _a, scored: _s, ...row }) => (alive ? { ...row, alive: alive.has(row.entrant) } : row))
    .sort((a, b) => cmp(a, b) || draw.get(a.entrant)! - draw.get(b.entrant)!);
  out.forEach((row, i) => (row.rank = i && !cmp(out[i - 1], row) ? out[i - 1].rank : i + 1));
  return out;
}
