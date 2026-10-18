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
   * In a zone of `piles`: squared up with the rest of its group into one pile, whatever its rank
   * (a finished canasta; the group's last card shows on top).
   */
  square?: boolean;
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
  /** A whole hand face up on the table (bridge's dummy): one layout as it shrinks, and its room kept until the middle is clear. */
  faceUpHand?: boolean;
  /** A stack laid out as a cascade (Kings Corners): its bottom card peeks out above the top. */
  cascade?: boolean;
  /** A pile spread card by card that keeps growing: room kept for this many cards on a table screen. */
  reserve?: number;
  /** Melds of one rank drawn as squared piles with a count (canasta's), cards of another rank fanned beside. */
  piles?: boolean;
  /** Where the pile sits on a big screen's table, [row, column] (Kings Corners' cross). */
  grid?: [number, number];
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
  /** Where it happened, if not at the seat of whoever did it: a card the declarer plays from dummy is the dummy's (its bubble shows there). */
  at?: number;
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
  /**
   * Ask before sending (a bid, a pass in an auction): one tap on the wrong thing can't be taken
   * back once the next player has called. An `amount` is already asked for on a sheet of its own.
   */
  confirm?: boolean;
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
  /**
   * Hands turned face up at a showdown, to show in the middle beside the board, each labelled
   * ("Ada wins · Flush"). Only hands everyone has seen: the cards come from the zones listed (the
   * seat's hand, and in stud its face-up cards too), which aren't shown elsewhere meanwhile.
   */
  showdown?: { seat: number; label: string; zones: string[] }[];
  /** Banner shown at end of a round / game. */
  banner?: { title: string; lines: string[] };
  /** Real-time games: what players are reacting to right now (changes when e.g. a card lands on the pile). */
  race?: number;
}

export interface SetupPlayer {
  name: string;
  bot?: boolean;
}

/**
 * A tournament table's private inputs (see src/engine/events): what the game itself needs that
 * the lobby's settings can't carry, since those are public numbers. Kept in the game's `data`,
 * and kept from players by `redactData`.
 */
export interface TableSetup {
  /** Duplicate: the boards to play, in order, each player's hand given (by seat: North, East, South, West). */
  boards?: Board[];
  /**
   * Duplicate: other tables play these boards too, and their results come in as they're known (see
   * `GameModule.compare`): the game is decided on the comparison (IMPs), waiting at the end for any
   * still to come.
   */
  compared?: boolean;
  /** Poker: each seat's chips, who has the button, and the blinds. */
  chips?: number[];
  button?: number;
  blinds?: Blinds;
}
export interface Board {
  /** The board's number: who deals and who is vulnerable follow from it. */
  n: number;
  hands: string[][];
}
export interface Blinds {
  sb: number;
  bb: number;
  ante?: number;
}
/** A change a tournament makes to a table between hands. */
export type TableChange = { blinds: Blinds };
/**
 * One board's result at a table: the contract (`4S`, `3NTX`, `6HXX`; null: passed out), who
 * declared (a seat: North 0, East 1, South 2, West 3), tricks they took, and North–South's score.
 */
export interface BoardResult {
  n: number;
  contract: string | null;
  declarer: number | null;
  tricks: number | null;
  ns: number;
}
/** Another table's result on a board (`at`: whose, for its column: "Bots", "Table 2", "Par"). */
export interface OtherResult extends BoardResult {
  at: string;
}
/** What a tournament table tells the director, all of it public: each board's result, everyone's chips. */
export interface TableReport {
  boards?: BoardResult[];
  stacks?: number[];
  /** Hands played so far. */
  hand?: number;
}

export interface GameModule<D = any> {
  config: GameConfig;
  /** `table`: a tournament table's private inputs (boards, chips), for games that play in tournaments. */
  setup(players: SetupPlayer[], seed: Seed, options: Record<string, number | boolean>, table?: TableSetup): GameState<D>;
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
  /**
   * The sides at a table of `players` (partners share a side): `[[0, 2], [1, 3]]` is two pairs
   * sitting opposite. Without it, everyone plays for themselves. A tournament pairs sides.
   */
  sides?(players: number): number[][];
  /** A tournament's change to the table (new blinds), made by the host between hands only. */
  adjust?(s: GameState<D>, change: TableChange): void;
  /** What a tournament table reports (public information only): board results, chips. */
  report?(s: GameState<D>): TableReport;
  /**
   * Duplicate: other tables' results on boards played here (each told only once this table has
   * played it), shown beside this table's own. Any time; a repeat is ignored.
   */
  compare?(s: GameState<D>, others: OtherResult[]): void;
  /**
   * Duplicate, in a room: what a game with these settings is compared with (`table`: another table
   * playing the same boards; `par`: the solver's par for each board; null: nothing).
   */
  compareWith?(options: Record<string, number | boolean>): 'table' | 'par' | null;
  /** Duplicate: the boards this game plays (for the other table to play too). */
  boards?(s: GameState<D>): Board[] | null;
  /**
   * The settings that play this game duplicate (each board compared with other tables'), for the
   * tournaments that play it so (pairs and teams: see engine/events/duplicate.ts).
   */
  duplicate?: Record<string, number>;
  /**
   * A finished game's own score for each player (by game seat), when it adds up from game to game
   * over a night (duplicate compared with another table or par: IMPs). Null: places only.
   */
  nightScore?(s: GameState<D>): { unit: string; scores: number[] } | null;
}

export class RuleError extends Error {}

export function assertRule(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new RuleError(msg);
}
