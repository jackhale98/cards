import type { RngState, Seed } from './rng';

// ---------------------------------------------------------------------------
// Game configuration: the `game.json` of each game. Its types are generated from
// schemas/game.schema.json (pnpm gen:types), the one place the format is defined.
// ---------------------------------------------------------------------------

import type { GameConfig, Rules, ZoneConfig } from './schema.gen';
export type { DealStep, DeckSpec, GameConfig, GameOption, Rules, ZoneConfig } from './schema.gen';

export type Visibility = ZoneConfig['visibility'];
export type Layout = ZoneConfig['layout'];
/** `strip`: a compact row along the bottom of the table that scrolls sideways (e.g. everyone's melds). */
export type Area = ZoneConfig['area'];

/** The settings of a rules family (both kinds, for rummy: narrow by `style`). */
export type FamilyRules<F extends Rules['family']> = Extract<Rules, { family: F }>;

/**
 * A game's rules settings, as the family it names: checked, so a family never runs on another's
 * settings. `style` picks one kind within a family (rummy: `gin` or `500`).
 */
export function familyRules<F extends Rules['family'], S extends string = never>(
  config: GameConfig,
  family: F,
  style?: S,
): [S] extends [never] ? FamilyRules<F> : Extract<FamilyRules<F>, { style: S }> {
  const r = config.rules;
  if (r?.family !== family) throw new Error(`${config.id}: the ${family} family can't run ${r?.family ?? 'free'} rules`);
  if (style !== undefined && (r as { style?: string }).style !== style) throw new Error(`${config.id}: expected ${family} rules in the ${style} style`);
  return r as never;
}

// ---------------------------------------------------------------------------
// Runtime state (owned by the host, serialisable)
// ---------------------------------------------------------------------------

export interface CardRef {
  id: string;
  /** Face up? Only meaningful in zones visible to everyone. */
  up?: boolean;
  /** Seat that placed this card (used by trick layouts). */
  by?: number;
  /** Visual grouping in spread layouts (e.g. separate melds); a gap is drawn between groups. */
  group?: number;
  /** Draw dimmed (e.g. deadwood). */
  dim?: boolean;
  /**
   * Opaque key, renewed every time the card moves. Lets a face-down card on the table keep a
   * stable placeholder (so it animates smoothly) without linking it to where it came from.
   */
  k?: number;
  /** Not yet looked at, even by the owner (a spades player deciding on blind nil). */
  blind?: boolean;
}

export interface ZoneState {
  id: string;
  base: string;
  owner?: number;
  label?: string;
  visibility: Visibility;
  layout: Layout;
  area: Area;
  hideEmpty?: boolean;
  scale?: number;
  peek?: number;
  cards: CardRef[];
}

export interface PlayerState {
  seat: number;
  name: string;
  bot?: boolean;
  chips: number;
}

export interface LogEntry {
  t: number;
  text: string;
  /** Who did it (shown as a speech bubble on their seat). */
  seat?: number;
  /** Bubble text, e.g. "Raise 60" or "7♥". */
  short?: string;
  /** Seat the cards went to, if any (cards are animated toward them). */
  to?: number;
  /** Pile the cards came from / went to (e.g. "deck"), so hidden cards fly from/to it. */
  fromZone?: string;
  toZone?: string;
}

export interface GameState<D = unknown> {
  game: string;
  /** Monotonic version, bumped by the host on every change. */
  v: number;
  /** The dice: four 32-bit words of RNG state (see rng.ts; a plain number in games saved before). */
  rng: RngState | number;
  players: PlayerState[];
  zones: Record<string, ZoneState>;
  /** Seat whose turn it is, or null when nobody/everybody may act. */
  turn: number | null;
  phase: string;
  dealer: number;
  data: D;
  log: LogEntry[];
  options: Record<string, number | boolean>;
  /** Counter for card keys (`CardRef.k`). */
  seq?: number;
  /**
   * How many times the cards have been dealt (bumped by `resetDeck`). A record of the game uses
   * it to tell a fresh deal from more play: some deals are thrown in and dealt again straight
   * away, without the hand ever ending (bridge when everyone passes, euchre when nobody orders).
   */
  deals?: number;
  /** Set when the game is finished. */
  winner?: number[];
  /** Host bookkeeping: this finished game has been added to the game night tally. */
  tallied?: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface Action {
  type: string;
  cards?: string[];
  amount?: number;
  zone?: string;
  seat?: number;
  /**
   * Real-time games: what the player was reacting to (`GameStatus.race` when they acted) and how
   * long after it appeared on their own screen they acted, in ms. Measured on each device, so a
   * slower connection doesn't make anyone slower; the quickest reaction wins a race.
   */
  race?: number;
  rt?: number;
  /** Set by the host: when it received the action (ms since the epoch). */
  at?: number;
}

/** Describes a button the player may press. Clients render these without knowing the rules. */
export interface ActionSpec {
  type: string;
  label: string;
  style?: 'primary' | 'danger' | 'quiet';
  /** Requires a card selection. `cards` lists the ids that may be selected. */
  select?: { min: number; max: number; cards: string[] };
  /** Requires an amount (bets, deal counts). */
  amount?: { min: number; max: number; step: number; default: number; label?: string };
  /** Show under the overflow menu instead of the main action bar. */
  menu?: boolean;
  /** Tapping this zone (e.g. "deck", "discard") triggers the action. */
  zone?: string;
  /** A reaction (a slap): the device adds how fast the player responded to `GameStatus.race`. */
  react?: boolean;
  /** Requires choosing another player; the choice is sent as `Action.seat`. */
  target?: { seats: number[]; label?: string };
  /** Requires picking one option (a trump suit, a bid…); the choice is sent as `Action.amount`. */
  /** Pick one option; `disabled` ones are shown (to keep a grid aligned) but can't be chosen. */
  choose?: { label?: string; options: { value: number; label: string; disabled?: boolean }[] };
  /**
   * Shortcut for card actions: `true` = swipe a card up, or tap a selected card again, to do it;
   * `'swipe'` = swipe only (tapping a selected card deselects it). Use `'swipe'` where an
   * accidental play would be costly, e.g. the free table.
   */
  quick?: boolean | 'swipe';
}

// ---------------------------------------------------------------------------
// The interface every game implements
// ---------------------------------------------------------------------------

export interface SeatInfo {
  /** Short status text, e.g. "Bet 40", "Passed", "12 pts". */
  badge?: string;
  /** Highlight (e.g. dealer button). */
  tag?: string;
  out?: boolean;
}

export interface Scoreboard {
  columns: string[];
  rows: { name: string; values: (string | number)[]; highlight?: boolean }[];
}

export interface GameStatus {
  headline: string;
  /** Seat that moves now when it isn't `state.turn` (bridge: the declarer plays for the dummy). */
  actor?: number | null;
  seats: SeatInfo[];
  /** Chips in the middle of the table. */
  pot?: number;
  /** Private hint for the viewer, e.g. "Two pair". */
  hint?: string;
  scoreboard?: Scoreboard;
  /** A race-to-N score track (e.g. a cribbage board): one lane per player or team. */
  track?: { target: number; lanes: { label: string; seat: number; score: number; prev: number }[] };
  /** Banner shown at end of a round / game. */
  banner?: { title: string; lines: string[] };
  /** Real-time games: what players are reacting to right now (changes when e.g. a card lands on the pile). */
  race?: number;
}

export interface SetupPlayer {
  name: string;
  bot?: boolean;
}

export interface GameModule<D = any> {
  config: GameConfig;
  setup(players: SetupPlayer[], seed: Seed, options: Record<string, number | boolean>): GameState<D>;
  /** Actions available to `seat` right now. */
  actions(s: GameState<D>, seat: number): ActionSpec[];
  /** Apply an action to a (cloned) state. Throw `RuleError` if illegal. */
  apply(s: GameState<D>, seat: number, a: Action): void;
  /** Automatic step the host should run after a short pause (e.g. collect a finished trick). */
  system?(s: GameState<D>): { delay: number; run: (s: GameState<D>) => void } | null;
  /** Pick an action for a bot seat, or null if it has nothing to do. */
  bot?(s: GameState<D>, seat: number): Action | null;
  /**
   * Real-time: anyone may act at any moment. Every bot gets its own timer (`botDelay`: its reaction
   * time for that move), and the host stamps each action with when it arrived.
   */
  realtime?: boolean;
  botDelay?(s: GameState<D>, seat: number, a: Action): number;
  /** The bot searches when the `botLevel` option is above Easy (the lobby offers the setting). */
  botLevels?: boolean;
  /** Remove private information from `data` for `viewer` (-1 = spectator). */
  redactData?(s: GameState<D>, viewer: number): D;
  status(s: GameState<D>, viewer: number): GameStatus;
  /**
   * Finishing place of each seat once the game is over (0 = first; ties share a place), for the
   * game night tally. Without it, the winners are first and everyone else shares second.
   */
  standings?(s: GameState<D>): number[];
}

export class RuleError extends Error {}

export function assertRule(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new RuleError(msg);
}
