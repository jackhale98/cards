import type { Action, ActionSpec, GameState, GameStatus } from '../engine/types';

export interface LobbySeat {
  /** Stable client id (survives reconnects). Bots use `bot:<n>`. */
  id: string;
  name: string;
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
  | { t: 'hello'; cid: string; name: string; display?: boolean }
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
