import type { Action, ActionSpec, GameState, GameStatus } from '../engine/types';

/** A player's chosen look: an emoji on a coloured disc. */
export interface Avatar {
  emoji: string;
  color: string;
}

export const AVATAR_EMOJI = ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🦉', '🐧', '🐙', '🦄', '🐲', '🦖', '🐳', '🦋', '🌵', '🍀', '🍄', '🌙', '⭐', '🔥', '💎', '🎩', '👑', '🎲', '🚀', '🎸'];
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
}

/** One finished game in tonight's tally. */
export interface NightGame {
  game: string;
  name: string;
  at: number;
  /** Everyone who played, by lobby seat id (so moving seats doesn't matter). */
  results: { id: string; name: string; place: number; points: number }[];
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
}

export type ClientMsg =
  | { t: 'hello'; cid: string; name: string; avatar?: Avatar; display?: boolean }
  | { t: 'act'; a: Action; seq: number }
  | { t: 'pong'; ts: number };

export type HostMsg =
  | { t: 'view'; view: View }
  | { t: 'err'; msg: string; seq?: number }
  /** Heartbeat; clients answer with a pong carrying the same timestamp. */
  | { t: 'ping'; ts: number }
  /** Round-trip time (ms) from the host to each seated player, by seat index. */
  | { t: 'pings'; pings: (number | null)[] }
  /** The whole game, sealed with a key only the relay holds (see backup.ts), for host handoff. */
  | { t: 'backup'; blob: string; v: number };

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
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
// (four-letter codes from before the switch still open)
export const isValidCode = (c: string) => /^[A-Z]{4,5}$/.test(c);
