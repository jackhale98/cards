import { standings, type EventState } from '../../engine/events';
import { otherTable, resultOn, roundBoards } from '../../engine/events/duplicate';
import { boardDealer, boardVul, imps, matchpoints, matchpointTop } from '../../engine/lib/duplicate';
import { ascii, handText } from './pbn';

/**
 * A duplicate tournament's record in PBN (2.1, export format), as clubs publish their results:
 * one game per board, with its deal and every table's result on it (the traveller, a ScoreTable:
 * each table's pairs, contract, declarer, tricks, North–South's score, and the matchpoints or
 * IMPs it earned), and after the last board the standings (a TotalScoreTable). Pairs and teams
 * are numbered in the order they signed up. Only boards every table has finished with are written.
 */

const SEAT = ['N', 'E', 'S', 'W'];
const tag = (name: string, value: string) => `[${name} "${value}"]`;
/** A value in a table's row: quoted when it has spaces (or is empty). */
const cell = (v: string | number) => (typeof v === 'number' || (v && !/\s/.test(v)) ? String(v) : `"${v}"`);

export function eventPbn(e: EventState, at: Date): string {
  const teams = e.config.format === 'teams';
  const id = new Map(e.entrants.map((x, i) => [x.id, i + 1]));
  const num = (entrant: string | null) => (entrant ? (id.get(entrant) ?? '-') : '-');
  const date = `${at.getFullYear()}.${String(at.getMonth() + 1).padStart(2, '0')}.${String(at.getDate()).padStart(2, '0')}`;
  const games: string[] = [];
  for (const r of e.rounds) {
    const boards = r.tables[0]?.setup?.boards ?? [];
    const done = new Set(roundBoards(r).filter((n) => r.tables.every((t) => t.result || resultOn(t, n))));
    for (const b of boards) {
      if (!done.has(b.n)) continue;
      const at = r.tables.filter((t) => resultOn(t, b.n));
      const mp = matchpoints(at.map((t) => resultOn(t, b.n)!.ns));
      const top = matchpointTop(at.length);
      const lines = [
        tag('Event', ascii(e.config.name)),
        tag('Site', 'lamplight.cards'),
        tag('Date', date),
        tag('Board', String(b.n)),
        tag('West', ''),
        tag('North', ''),
        tag('East', ''),
        tag('South', ''),
        tag('Dealer', SEAT[boardDealer(b.n)]),
        tag('Vulnerable', boardVul(b.n)),
        tag('Deal', `N:${b.hands.map(handText).join(' ')}`),
        tag('Scoring', teams ? 'IMP' : 'MP'),
        tag('Declarer', ''),
        tag('Contract', ''),
        tag('Result', ''),
        tag(
          'ScoreTable',
          teams
            ? 'Table\\2R;TeamId_NS\\2R;TeamId_EW\\2R;Contract\\5L;Declarer\\1R;Result\\2R;Score_NS\\6R;IMP_NS\\3R;IMP_EW\\3R'
            : 'Table\\2R;PairId_NS\\2R;PairId_EW\\2R;Contract\\5L;Declarer\\1R;Result\\2R;Score_NS\\6R;MP_NS\\3R;MP_EW\\3R',
        ),
      ];
      at.forEach((t, i) => {
        const res = resultOn(t, b.n)!;
        const o = teams ? otherTable(r, t) : undefined;
        const there = o && resultOn(o, b.n);
        const swing = there ? imps(res.ns - there.ns) : null;
        lines.push(
          [
            t.table,
            num(t.seats[0].entrant),
            num(t.seats[1].entrant),
            res.contract ?? 'Pass',
            res.declarer != null ? SEAT[res.declarer] : '-',
            res.tricks ?? '-',
            res.ns,
            ...(teams ? [swing ?? '-', swing != null ? -swing : '-'] : [mp[i], top - mp[i]]),
          ]
            .map(cell)
            .join(' '),
        );
      });
      games.push(lines.join('\r\n'));
    }
  }
  if (!games.length) return '';
  // the standings, with the last board
  const rows = standings(e);
  const total = [
    tag('TotalScoreTable', teams ? 'Rank\\2R;TeamId\\2R;TotalScoreIMP\\4R;Names\\40L' : 'Rank\\2R;PairId\\2R;TotalPercentage\\6R;TotalScoreMP\\5R;Names\\40L'),
    ...rows.map((x) => [x.rank, num(x.entrant), ...(teams ? [x.score ?? 0] : [x.points.toFixed(2), x.score ?? 0]), ascii(x.name)].map(cell).join(' ')),
  ];
  games[games.length - 1] += `\r\n${total.join('\r\n')}`;
  return ['% PBN 2.1', '% EXPORT', '', games.join('\r\n\r\n'), ''].join('\r\n');
}
