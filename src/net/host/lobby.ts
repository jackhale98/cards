import type { GameModule } from '../../engine/types';
import { GAMES } from '../../games';

/** The lobby's settings: a game's defaults, and a game carried over from another table. */

/**
 * The game a split-off table starts on (it came over the network, so only a game we have, and
 * only that game's own settings with values of the right kind; the rest are its defaults).
 */
export function carriedGame(game: unknown): { id: string; options: Record<string, number | boolean> } | null {
  if (!game || typeof game !== 'object') return null;
  const { id, options } = game as { id?: unknown; options?: unknown };
  if (typeof id !== 'string' || !Object.hasOwn(GAMES, id)) return null;
  const given = options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
  const out = defaultOptions(GAMES[id]);
  for (const o of GAMES[id].config.options ?? []) {
    const v = given[o.id];
    if (typeof v === typeof o.default && (typeof v !== 'number' || Number.isFinite(v))) out[o.id] = v as number | boolean;
  }
  return { id, options: out };
}

export function defaultOptions(g: { config: GameModule['config'] }): Record<string, number | boolean> {
  return Object.fromEntries((g.config.options ?? []).map((o) => [o.id, o.default]));
}
