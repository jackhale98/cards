import type { Night } from './protocol';

export interface NightRow {
  id: string;
  name: string;
  points: number;
  wins: number;
  played: number;
  /** Place on tonight's board (0 = leading; ties share). */
  rank: number;
}

/** Tonight's running totals, best first (points, then wins). */
export function nightTotals(night: Night | undefined): NightRow[] {
  const rows = new Map<string, NightRow>();
  for (const g of night?.games ?? []) {
    for (const r of g.results) {
      const row = rows.get(r.id) ?? { id: r.id, name: r.name, points: 0, wins: 0, played: 0, rank: 0 };
      row.name = r.name; // latest name
      row.points += r.points;
      row.wins += r.place === 0 ? 1 : 0;
      row.played++;
      rows.set(r.id, row);
    }
  }
  const list = [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  for (const row of list) row.rank = list.filter((o) => o.points > row.points || (o.points === row.points && o.wins > row.wins)).length;
  return list;
}

/** Winners of a finished game, by name ("Ada & Cleo"). */
export const gameWinners = (g: Night['games'][number]) =>
  g.results
    .filter((r) => r.place === 0)
    .map((r) => r.name)
    .join(' & ');
