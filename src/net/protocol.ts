import type { Action, ActionSpec, GameState, GameStatus } from '../engine/types';
import type { Op } from './patch';

/** A player's chosen look: an emoji on a coloured disc. */
export interface Avatar {
  emoji: string;
  color: string;
}

export const AVATAR_EMOJI = [
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐸',
  '🐵',
  '🦉',
  '🐧',
  '🐙',
  '🦄',
  '🐲',
  '🦖',
  '🐳',
  '🦋',
  '🌵',
  '🍀',
  '🍄',
  '🌙',
  '⭐',
  '🔥',
  '💎',
  '🎩',
  '👑',
  '🎲',
  '🚀',
  '🎸',
];
export const AVATAR_COLORS = ['#e9c46a', '#5fb3d9', '#e76f51', '#9b8cf2', '#7bd389', '#f28cbf', '#f4a261', '#4fd1c5', '#c9d36a', '#d98ae0'];

/** Accept only a short emoji and a hex colour from the network. */
export function cleanAvatar(a: unknown): Avatar | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const { emoji, color } = a as Record<string, unknown>;
  if (typeof emoji !== 'string' || typeof color !== 'string') return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(color) || [...emoji].length > 4 || /[<>&"']/.test(emoji)) return undefined;
  return { emoji, color };
}

export interface LobbySeat {
  /** Stable client id (survives reconnects). Bots use `bot:<n>`. */
  id: string;
  name: string;
  avatar?: Avatar;
  bot?: boolean;
  host?: boolean;
  connected: boolean;
  /** Sitting out the next game (more people at the table than it seats); they watch instead. */
  out?: boolean;
  /** The host's device is the table screen (a laptop or tablet in the middle): it never plays. */
  screen?: boolean;
  /** Games this person has sat out tonight: whoever has sat out most plays next. */
  sat?: number;
  /** They dropped mid-game and a bot is playing their seat until they're back. */
  standIn?: boolean;
}

/** Another table that split off from this one tonight. */
export interface SplitTable {
  code: string;
  names: string[];
}

/** One finished game in tonight's tally. */
export interface NightGame {
  game: string;
  name: string;
  at: number;
  /** Everyone who played, by lobby seat id (so moving seats doesn't matter). */
  results: { id: string; name: string; place: number; points: number }[];
  /** The game's own final scores, as anyone watching saw them (its scoreboard, and the result). */
  final?: NightFinal;
}

export interface NightFinal {
  columns: string[];
  rows: { name: string; values: string[]; highlight?: boolean }[];
  lines: string[];
}

/** Game night: finished games at this table, for a running scoreboard. */
export interface Night {
  games: NightGame[];
}

export interface Lobby {
  code: string;
  gameId: string;
  options: Record<string, number | boolean>;
  seats: LobbySeat[];
  spectators: number;
  /** Table screens (big-screen displays) watching; phones then show mostly their own hand. */
  displays?: number;
  started: boolean;
  night?: Night;
  /** Seat ids in the game being played, in game-seat order (people sitting out aren't in it). */
  playing?: string[];
  /** The table this one split off from (its players can head back there). */
  parent?: string;
  /** Tables that split off from this one and haven't come back yet. */
  splits?: SplitTable[];
  /** Sound on the table screens (TV, Chromecast): off when someone at the table mutes it. */
  screenSound?: boolean;
  /** While the host's device is the table screen: the player whose phone runs the table (lobby and menu). */
  captain?: string;
  /** The table's card back and cloth, chosen by the host (ids from ui/looks.ts). */
  look?: { back: string; cloth: string };
  /**
   * The table's own id: kept through a host's reloads and takeovers (unlike View.hid). On networks
   * that can't vouch for the host, a player shows their seat's key only to a host of this table.
   */
  tid?: string;
  /** Take-backs (the host's choice): a player may undo their last move until anyone else moves. */
  takeBacks?: boolean;
  /**
   * The game being played, hand by hand: each player's (or team's) total as it was dealt, then
   * after each hand (chips, in chip games). For the score chart and the end-of-hand recap.
   */
  scores?: ScoreHistory;
}

export interface ScoreHistory {
  names: string[];
  /** totals[0]: at the deal; then one row per finished hand (the latest few hundred). */
  totals: number[][];
}

/** Everything a device needs to render: personalised and redacted by the host. */
export interface View {
  v: number;
  /** Host instance id: a restarted host starts a new one (its versions may start again). */
  hid?: string;
  lobby: Lobby;
  /** Seat index in the game, or -1 for spectators / table display. */
  you: number;
  state: GameState | null;
  actions: ActionSpec[];
  status: GameStatus | null;
  /** Finished hands this game the host can replay (see Frame). */
  replays?: number;
  /** The hand on the table has just finished (it's the latest of the replays). */
  handDone?: true;
  /**
   * "Who's there?": the host sent this to a connection that hasn't yet shown the key to the seat
   * it asked for. Not to be shown: the client answers with a hello carrying its key.
   */
  who?: true;
}

/**
 * One moment of a finished hand, as one player saw it then (the host keeps the hands; players ask
 * for a moment at a time). `hand` counts back from the latest (0), `step` from the deal.
 */
export interface Frame {
  hand: number;
  hands: number;
  step: number;
  steps: number;
  state: GameState;
  status: GameStatus;
}

export type ClientMsg =
  | {
      t: 'hello';
      cid: string;
      name: string;
      avatar?: Avatar;
      display?: boolean;
      /**
       * The secret that holds this seat (only sent to the host, never broadcast): client ids are
       * public, so anyone could ask for someone else's seat with one.
       */
      key?: string;
      /** Coming back from a table that split off (its code): its finished games, for tonight's tally. */
      from?: string;
      merge?: NightGame[];
    }
  /** A patch didn't fit the view this player has: send the whole view again. */
  | { t: 'sync' }
  | { t: 'act'; a: Action; seq: number }
  /** A reaction (an index into REACTIONS), shown on the sender's seat for everyone. */
  | { t: 'react'; e: number }
  /** Replay: the host answers with that moment of that hand (see Frame). */
  | { t: 'replay'; hand: number; step: number }
  /** The game so far as a file (a spreadsheet, or its game's standard record), as this player saw it. */
  | { t: 'export'; format?: 'csv' | 'pbn' | 'ohh' }
  | { t: 'pong'; ts: number }
  /** From the player holding the controls while the host's device is the table screen (see Lobby.captain). */
  | { t: 'lobby'; op: LobbyOp };

/** What the player holding the controls may do: the host's lobby buttons, and back to the lobby. */
/** The reactions anyone at the table can send (a fixed few: no free text to keep an eye on). */
export const REACTIONS = ['👍', '👏', '😂', '😮', '😬', '🔥'];

export type LobbyOp =
  | { op: 'game'; id: string }
  | { op: 'option'; id: string; value: number | boolean }
  | { op: 'bot' }
  | { op: 'playing'; id: string; on: boolean }
  | { op: 'move'; id: string; dir: -1 | 1 }
  | { op: 'remove'; id: string }
  | { op: 'deal' }
  | { op: 'takeBacks'; on: boolean }
  | { op: 'end' }
  | { op: 'look'; back: string; cloth: string };

export type HostMsg =
  | { t: 'view'; view: View }
  /** What changed since the view this player last had (`base`, from the host `hid`), when that's smaller than the whole view. */
  | { t: 'patch'; hid?: string; base: number; v: number; ops: Op[] }
  /** Someone at the table reacted (`id`: their lobby seat; `e`: an index into REACTIONS). */
  | { t: 'react'; id: string; e: number }
  | { t: 'frame'; frame: Frame | null }
  | { t: 'export'; format: 'csv' | 'pbn' | 'ohh'; text: string | null }
  | { t: 'err'; msg: string; seq?: number }
  /** Heartbeat; clients answer with a pong carrying the same timestamp. */
  | { t: 'ping'; ts: number }
  /** Round-trip time (ms) from the host to each seated player, by seat index. */
  | { t: 'pings'; pings: (number | null)[] }
  /** The whole game, sealed with a key only the relay holds (see backup.ts), for host handoff. */
  | { t: 'backup'; blob: string; v: number; token?: string }
  /**
   * Split the table: go to table `code` — as its host (`host`), taking tonight's tally along — or
   * head back to the table this one split off from (`back`).
   */
  | {
      t: 'move';
      code: string;
      host?: boolean;
      night?: Night;
      parent?: string;
      back?: boolean;
      /** For the new host of a split-off table: the game (and settings) this table was on, to start from. */
      game?: { id: string; options: Record<string, number | boolean> };
    };

export type Msg = ClientMsg | HostMsg;

/**
 * Room codes: five letters (3.2 million codes) without vowels (no accidental words) or look-alike
 * characters. The relay refuses a second host on a code that's in use, and the app picks another.
 */
const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 5;
export function makeRoomCode(): string {
  const a = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}
export const normaliseCode = (c: string) =>
  c
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, CODE_LENGTH);
// (four-letter codes from before the switch still open)
export const isValidCode = (c: string) => /^[A-Z]{4,5}$/.test(c);
