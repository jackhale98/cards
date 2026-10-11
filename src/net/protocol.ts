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

export interface Lobby {
  code: string;
  gameId: string;
  options: Record<string, number | boolean>;
  seats: LobbySeat[];
  spectators: number;
  started: boolean;
}

/** Everything a device needs to render: personalised and redacted by the host. */
export interface View {
  v: number;
  lobby: Lobby;
  /** Seat index in the game, or -1 for spectators / table display. */
  you: number;
  state: GameState | null;
  actions: ActionSpec[];
  status: GameStatus | null;
}

export type ClientMsg =
  | { t: 'hello'; cid: string; name: string; avatar?: Avatar; display?: boolean }
  | { t: 'act'; a: Action; seq: number };

export type HostMsg =
  | { t: 'view'; view: View }
  | { t: 'err'; msg: string; seq?: number };

export type Msg = ClientMsg | HostMsg;

/** Room codes avoid vowels (no accidental words) and look-alike characters. */
const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
export function makeRoomCode(): string {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
export const isValidCode = (c: string) => /^[A-Z]{4}$/.test(c);
