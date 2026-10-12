import type { GameConfig, GameModule } from '../types';
import { baccaratFamily } from './baccarat';
import { blackjackFamily } from './blackjack';
import { canastaFamily } from './canasta';
import { cheatFamily } from './cheat';
import { cornersFamily } from './corners';
import { climbingFamily } from './climbing';
import { cribbageFamily } from './cribbage';
import { eightsFamily } from './eights';
import { freeFamily } from './free';
import { goFishFamily } from './gofish';
import { handFootFamily } from './handfoot';
import { palaceFamily } from './palace';
import { pinochleFamily } from './pinochle';
import { pokerFamily } from './poker';
import { rummyFamily } from './rummy';
import { rummy500Family } from './rummy500';
import { slapFamily } from './slap';
import { spitFamily } from './spit';
import { trickTakingFamily } from './trick';

/**
 * Family engines. A game's `game.json` picks one with `"rules": { "family": "…" }` and sets its
 * parameters; most new games need no code at all. Add a family here when a new kind of game
 * (rummy, cribbage, …) needs mechanics the existing ones don't have.
 */
export const FAMILIES: Record<string, (config: GameConfig) => GameModule> = {
  free: freeFamily,
  baccarat: baccaratFamily,
  blackjack: blackjackFamily,
  cheat: cheatFamily,
  corners: cornersFamily,
  gofish: goFishFamily,
  handfoot: handFootFamily,
  palace: palaceFamily,
  pinochle: pinochleFamily,
  canasta: canastaFamily,
  climbing: climbingFamily,
  cribbage: cribbageFamily,
  eights: eightsFamily,
  'trick-taking': trickTakingFamily,
  poker: pokerFamily,
  slap: slapFamily,
  spit: spitFamily,
  // Gin (two players, knock) or Rummy 500 (melds on the table, any number)
  rummy: (config) => ((config.rules as { style?: string }).style === '500' ? rummy500Family(config) : rummyFamily(config)),
};

export function moduleFor(config: GameConfig): GameModule {
  const family = config.rules?.family ?? 'free';
  const make = FAMILIES[family];
  if (!make) throw new Error(`${config.id}: unknown rules family "${family}"`);
  return config.byPlayers ? bySize(config, make) : make(config);
}

/**
 * A game whose rules change with the number of players (`byPlayers` in game.json): the family
 * engine is built once per table size from the merged config, and every call goes to the one for
 * the table's size (setup by the players it's given, everything else by the game's own state).
 */
function bySize(config: GameConfig, make: (config: GameConfig) => GameModule): GameModule {
  const base = make(config);
  const built = new Map<number, GameModule>();
  const forSize = (n: number): GameModule => {
    const v = config.byPlayers?.[n];
    if (!v) return base;
    if (!built.has(n)) {
      const rules = { ...config.rules!, ...(v.rules ?? {}) } as GameConfig['rules'];
      built.set(n, make({ ...config, rules, deck: { ...config.deck, ...(v.deck ?? {}) } }));
    }
    return built.get(n)!;
  };
  const out: Record<string, unknown> = { ...base };
  for (const [k, f] of Object.entries(base)) {
    if (typeof f !== 'function') continue;
    out[k] =
      k === 'setup'
        ? (players: unknown[], ...rest: unknown[]) => (forSize(players.length).setup as (...a: unknown[]) => unknown)(players, ...rest)
        : (s: { players: unknown[] }, ...rest: unknown[]) => ((forSize(s.players.length) as unknown as Record<string, (...a: unknown[]) => unknown>)[k])(s, ...rest);
  }
  return out as unknown as GameModule;
}
