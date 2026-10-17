import type { GameModule, GameState } from '../../engine/types';
import { familyRules } from '../../engine/types';
import { recordFormats, type ExportFormat } from '../exports/formats';
import { ohh } from '../exports/ohh';
import { pbn } from '../exports/pbn';
import type { HandFormat } from '../exports/types';
import type { NightFinal, NightGame, ScoreHistory } from '../protocol';
import { TABLE_MAX } from './limits';

/** A game's scores as it goes, and as it ends: for the chart, tonight's tally and the standard records. */

/** Hands kept in the score history (after the deal). */
export const SCORE_HANDS = 300;

/**
 * Everyone's running total, as the scoreboard shows it to someone watching (its last column), or
 * their chips in a chip game. Null when there's no number to follow (a game with no running score).
 */
export function totalsOf(m: GameModule, s: GameState, atDeal = false): (Omit<ScoreHistory, 'totals'> & { totals: number[] }) | null {
  try {
    // (at the deal, before the blinds and antes went in: everyone's starting chips)
    if (atDeal && m.config.chips) return { names: s.players.map((p) => p.name), totals: s.players.map(() => m.config.chips!.start) };
    const board = m.status(s, -1).scoreboard;
    if (board?.rows.length) {
      const totals = board.rows.map((r) => toNumber(r.values.at(-1)));
      if (totals.every((x) => x !== null)) return { names: board.rows.map((r) => r.name), totals: totals as number[] };
    }
    if (m.config.chips) return { names: s.players.map((p) => p.name), totals: s.players.map((p) => p.chips) };
  } catch {
    /* (a status that fails is reported elsewhere) */
  }
  return null;
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m =
    typeof v === 'string'
      ? v
          .replace(/[,\s]/g, '')
          .replace('−', '-')
          .match(/^-?\d+(\.\d+)?$/)
      : null;
  return m ? Number(m[0]) : null;
};

/** A finished game's own scores, as someone watching sees them (nothing private: it's over). */
export function finalScores(m: GameModule, s: GameState): NightFinal | undefined {
  try {
    const st = m.status(s, -1);
    const board =
      st.scoreboard ??
      (m.config.chips
        ? {
            columns: ['Chips'],
            rows: [...s.players]
              .sort((a, b) => b.chips - a.chips)
              .map((p) => ({ name: p.name, values: [p.chips.toLocaleString()], highlight: !!s.winner?.includes(p.seat) })),
          }
        : null);
    const out = cleanFinal({
      columns: board?.columns ?? [],
      rows: board?.rows.map((r) => ({ ...r, values: r.values.map(String) })) ?? [],
      lines: st.banner?.lines ?? [],
    });
    return out && (out.rows.length || out.lines.length) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** A game's final scores, size-limited and checked (they come from another device on a merge). */
export function cleanFinal(x: unknown): NightFinal | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const f = x as Record<string, unknown>;
  const strs = (a: unknown, n: number, len: number) =>
    Array.isArray(a)
      ? a
          .slice(0, n)
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.slice(0, len))
      : [];
  const rows = Array.isArray(f.rows)
    ? f.rows.slice(0, TABLE_MAX).flatMap((r) => {
        if (!r || typeof r !== 'object') return [];
        const { name, values, highlight } = r as Record<string, unknown>;
        return typeof name === 'string' ? [{ name: name.slice(0, 40), values: strs(values, 8, 24), ...(highlight === true ? { highlight: true } : {}) }] : [];
      })
    : [];
  return { columns: strs(f.columns, 8, 24), rows, lines: strs(f.lines, 12, 120) };
}

/** A finished game from another device, checked field by field (it goes into everyone's tally). */
export function cleanNightGame(x: unknown): NightGame | null {
  if (!x || typeof x !== 'object') return null;
  const g = x as Record<string, unknown>;
  if (typeof g.game !== 'string' || typeof g.name !== 'string' || typeof g.at !== 'number' || !Number.isFinite(g.at) || !Array.isArray(g.results)) return null;
  const results: NightGame['results'] = [];
  for (const r of g.results.slice(0, TABLE_MAX)) {
    if (!r || typeof r !== 'object') return null;
    const { id, name, place, points, score } = r as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof place !== 'number' || typeof points !== 'number') return null;
    if (!Number.isFinite(place) || !Number.isFinite(points)) return null;
    const own = typeof score === 'number' && Number.isFinite(score) ? { score } : {};
    results.push({ id: id.slice(0, 64), name: name.slice(0, 20), place, points, ...own });
  }
  const final = cleanFinal(g.final);
  const unit = typeof g.unit === 'string' && g.unit.length <= 12 ? { unit: g.unit } : {};
  return { game: g.game.slice(0, 40), name: g.name.slice(0, 40), at: g.at, results, ...unit, ...(final ? { final } : {}) };
}

/** The standard record formats a game is followed in (see exports/formats.ts). */
export function standardFormats(config: GameModule['config']): Partial<Record<ExportFormat, HandFormat<unknown>>> {
  const out: Partial<Record<ExportFormat, HandFormat<unknown>>> = {};
  for (const f of recordFormats(config)) {
    if (f === 'pbn') out.pbn = pbn as HandFormat<unknown>;
    if (f === 'ohh') out.ohh = ohh(familyRules(config, 'poker')) as HandFormat<unknown>;
  }
  return out;
}
