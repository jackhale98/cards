import type { Night } from './protocol';

export interface NightRow {
  id: string;
  name: string;
  points: number;
  wins: number;
  played: number;
  /** Points per game played: fair to someone who joined late. */
  perGame: number;
  /** Place on tonight's board (0 = leading; ties share). */
  rank: number;
}

/**
 * What tonight is counted in when every game so far kept a score of the same kind that adds up
 * from game to game (a night of duplicate bridge: "IMPs"); null: places (3 / 2 / 1 points).
 */
export function nightUnit(night: Night | undefined): string | null {
  const games = night?.games ?? [];
  const unit = games[0]?.unit;
  return unit && games.every((g) => g.unit === unit && g.results.every((r) => r.score !== undefined)) ? unit : null;
}

/**
 * Tonight's running totals, best first: by points (then wins), or with `by: 'perGame'` by points per
 * game played (then points), so someone who joined late isn't ranked low just for playing less.
 * A night all in one unit (see nightUnit) counts that instead of places: each player's IMPs.
 */
export function nightTotals(night: Night | undefined, by: 'points' | 'perGame' = 'points'): NightRow[] {
  const rows = new Map<string, NightRow>();
  const unit = nightUnit(night);
  for (const g of night?.games ?? []) {
    for (const r of g.results) {
      const row = rows.get(r.id) ?? { id: r.id, name: r.name, points: 0, wins: 0, played: 0, perGame: 0, rank: 0 };
      row.name = r.name; // latest name
      row.points += unit ? r.score! : r.points;
      row.wins += r.place === 0 ? 1 : 0;
      row.played++;
      rows.set(r.id, row);
    }
  }
  for (const row of rows.values()) row.perGame = row.points / row.played;
  // (compared a step at a time: a tie on the first measure goes to the second)
  const keys = (r: NightRow) => (by === 'perGame' ? [r.perGame, r.points] : [r.points, r.wins]);
  const better = (a: NightRow, b: NightRow) => {
    const [a1, a2] = keys(a);
    const [b1, b2] = keys(b);
    return a1 - b1 || a2 - b2;
  };
  const list = [...rows.values()].sort((a, b) => better(b, a) || a.name.localeCompare(b.name));
  for (const row of list) row.rank = list.filter((o) => better(o, row) > 0).length;
  return list;
}

/** A night's total in its unit, signed ("+17", "−4", "0"). */
export const signedTotal = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0');

/** Winners of a finished game, by name ("Ada & Cleo"). */
export const gameWinners = (g: Night['games'][number]) =>
  g.results
    .filter((r) => r.place === 0)
    .map((r) => r.name)
    .join(' & ');
