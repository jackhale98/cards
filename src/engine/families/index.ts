import type { GameConfig, GameModule } from '../types';

type Family = (config: GameConfig) => GameModule;

/**
 * Family engines, loaded only when a game of theirs is picked (each is its own download). A
 * game's `game.json` picks one with `"rules": { "family": "…" }` and sets its parameters; most new
 * games need no code at all. Add a family here, and its traits in `traits.ts`, when a new kind of
 * game (rummy, cribbage, …) needs mechanics the existing ones don't have.
 */
export const FAMILIES: Record<string, (config: GameConfig) => Promise<Family>> = {
  free: () => import('./free').then((m) => m.freeFamily),
  baccarat: () => import('./baccarat').then((m) => m.baccaratFamily),
  blackjack: () => import('./blackjack').then((m) => m.blackjackFamily),
  cheat: () => import('./cheat').then((m) => m.cheatFamily),
  corners: () => import('./corners').then((m) => m.cornersFamily),
  gofish: () => import('./gofish').then((m) => m.goFishFamily),
  handfoot: () => import('./handfoot').then((m) => m.handFootFamily),
  palace: () => import('./palace').then((m) => m.palaceFamily),
  pinochle: () => import('./pinochle').then((m) => m.pinochleFamily),
  canasta: () => import('./canasta').then((m) => m.canastaFamily),
  climbing: () => import('./climbing').then((m) => m.climbingFamily),
  cribbage: () => import('./cribbage').then((m) => m.cribbageFamily),
  eights: () => import('./eights').then((m) => m.eightsFamily),
  'trick-taking': () => import('./trick').then((m) => m.trickTakingFamily),
  poker: () => import('./poker').then((m) => m.pokerFamily),
  slap: () => import('./slap').then((m) => m.slapFamily),
  spit: () => import('./spit').then((m) => m.spitFamily),
  spoons: () => import('./spoons').then((m) => m.spoonsFamily),
  // Gin (two players, knock) or Rummy 500 (melds on the table, any number)
  rummy: (config) =>
    config.rules?.family === 'rummy' && config.rules.style === '500'
      ? import('./rummy500').then((m) => m.rummy500Family)
      : import('./rummy').then((m) => m.rummyFamily),
};

/** Load a game's rules engine (the family's code, set up with the game's parameters). */
export async function loadModule(config: GameConfig): Promise<GameModule> {
  const family = config.rules?.family ?? 'free';
  const load = FAMILIES[family];
  if (!load) throw new Error(`${config.id}: unknown rules family "${family}"`);
  return moduleFor(config, await load(config));
}

/** A game's rules engine from its family (per table size, for a game with `byPlayers`). */
export function moduleFor(config: GameConfig, make: Family): GameModule {
  return config.byPlayers ? bySize(config, make) : make(config);
}

/**
 * A game whose rules change with the number of players (`byPlayers` in game.json): the family
 * engine is built once per table size from the merged config, and every call goes to the one for
 * the table's size (setup by the players it's given, everything else by the game's own state).
 */
function bySize(config: GameConfig, make: Family): GameModule {
  const base = make(config);
  const built = new Map<number, GameModule>();
  const forSize = (n: number): GameModule => {
    const v = config.byPlayers?.[n];
    if (!v?.rules && !v?.deck) return base; // a size with only its own how-to-play lines
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
        : (s: { players: unknown[] }, ...rest: unknown[]) =>
            (forSize(s.players.length) as unknown as Record<string, (...a: unknown[]) => unknown>)[k](s, ...rest);
  }
  return out as unknown as GameModule;
}
