import type { GameModule } from '../../engine/types';
import { GAMES, getGame } from '../../games';
import { AVATAR_COLORS, AVATAR_EMOJI, type Lobby, type LobbySeat, type NightGame } from '../protocol';
import { BOT_NAMES, TABLE_MAX } from './limits';
import { cleanNightGame } from './records';

/**
 * The lobby's rules: who plays when there are more people than the game seats, bots sitting down,
 * buttons pressed on the phone holding the controls, games coming back from a split-off table, a
 * game's default settings and a game carried over from another table.
 */

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

/** The most players a game seats. */
export const seatsIn = (g: { config: GameModule['config'] }) => (g.config.players.counts ? Math.max(...g.config.players.counts) : g.config.players.max);

/** Take the last bot off the table. */
export function dropBot(lobby: Lobby) {
  const i = lobby.seats.map((s) => !!s.bot).lastIndexOf(true);
  if (i >= 0) lobby.seats.splice(i, 1);
}

/**
 * Keep the players to what the game seats: bots go first, then whoever has sat out least
 * (latest to join among equals) sits out; when there's room, whoever has sat out most comes in.
 * A newcomer takes a bot's place, or sits out if the game is full of people.
 */
export function fitSeats(lobby: Lobby, opts: { newcomer?: string } = {}) {
  const max = seatsIn(getGame(lobby.gameId));
  const seats = lobby.seats;
  const playing = () => seats.filter((s) => !s.out);
  while (playing().length > max && seats.some((s) => s.bot)) dropBot(lobby);
  const order = (s: LobbySeat) => (s.sat ?? 0) * 100 - seats.indexOf(s) / 100;
  // the newcomer waits their turn rather than bumping someone already in
  if (opts.newcomer && playing().length > max) {
    const me = seats.find((s) => s.id === opts.newcomer);
    if (me) me.out = true;
  }
  while (playing().length > max) {
    const bump = playing()
      .filter((s) => !s.host || playing().length === 1)
      .sort((a, b) => order(a) - order(b))[0];
    if (!bump) break;
    bump.out = true;
  }
  while (playing().length < max) {
    const next = seats.filter((s) => s.out && s.connected && !s.screen).sort((a, b) => order(b) - order(a))[0];
    if (!next) break;
    next.out = false;
  }
}

/** A bot sits down, named and dressed by its place at the table (false: the game has no bots, or no room). */
export function addBot(lobby: Lobby, players: number): boolean {
  const g = getGame(lobby.gameId);
  if (!g.bot || players >= seatsIn(g) || lobby.seats.length >= TABLE_MAX) return false;
  const used = new Set(lobby.seats.map((s) => s.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${lobby.seats.length}`;
  const n = lobby.seats.length;
  const avatar = { emoji: AVATAR_EMOJI[(n * 7 + 3) % AVATAR_EMOJI.length], color: AVATAR_COLORS[(n * 3 + 1) % AVATAR_COLORS.length] };
  lobby.seats.push({ id: `bot:${Math.random().toString(36).slice(2, 7)}`, name, avatar, bot: true, connected: true });
  return true;
}

/** A lobby button pressed on the phone holding the table's controls, once checked. */
export type LobbyCommand =
  | { op: 'game'; id: string }
  | { op: 'option'; id: string; value: number | boolean }
  | { op: 'bot' }
  | { op: 'playing'; id: string; on: boolean }
  | { op: 'move'; id: string; dir: -1 | 1 }
  | { op: 'remove'; id: string }
  | { op: 'deal' }
  | { op: 'takeBacks'; on: boolean }
  | { op: 'end' }
  | { op: 'look'; look: { back: string; cloth: string } };

/**
 * What a lobby button from a phone asks for, checked as if it came from anyone (it travels over
 * the network): a game we have, an option that game has with a value it allows, bots only to
 * remove, dealing only before a game and ending only during one. Null: nothing to do.
 */
export function lobbyCommand(op: unknown, lobby: Lobby): LobbyCommand | null {
  if (!op || typeof op !== 'object') return null;
  const o = op as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null);
  switch (o.op) {
    case 'game': {
      const id = str(o.id);
      return id && GAMES[id] ? { op: 'game', id } : null;
    }
    case 'option': {
      const id = str(o.id);
      const opt = getGame(lobby.gameId).config.options?.find((x) => x.id === id);
      if (lobby.started || !opt || !id) return null;
      if (opt.type === 'boolean' && typeof o.value === 'boolean') return { op: 'option', id, value: o.value };
      const v = o.value;
      if (opt.type === 'number' && typeof v === 'number' && Number.isFinite(v)) {
        const min = opt.min ?? 0;
        const top = opt.choices ? opt.choices.length - 1 : (opt.max ?? Infinity);
        // (on the option's own steps: a choice's index, or min + a whole number of steps)
        const step = opt.choices ? 1 : (opt.step ?? 1);
        if (v >= min && v <= top && Number.isInteger(Math.round(((v - min) / step) * 1e6) / 1e6)) return { op: 'option', id, value: v };
      }
      return null;
    }
    case 'bot':
      return lobby.started ? null : { op: 'bot' };
    case 'playing': {
      const id = str(o.id);
      return id && typeof o.on === 'boolean' ? { op: 'playing', id, on: o.on } : null;
    }
    case 'move': {
      const id = str(o.id);
      return id && (o.dir === 1 || o.dir === -1) ? { op: 'move', id, dir: o.dir } : null;
    }
    case 'remove': {
      // (only bots: who is at the table is the host's call)
      const id = str(o.id);
      return id && lobby.seats.some((s) => s.id === id && s.bot) ? { op: 'remove', id } : null;
    }
    case 'deal':
      return lobby.started ? null : { op: 'deal' };
    case 'takeBacks':
      return typeof o.on === 'boolean' ? { op: 'takeBacks', on: o.on } : null;
    case 'end':
      return lobby.started ? { op: 'end' } : null;
    case 'look': {
      const back = str(o.back);
      const cloth = str(o.cloth);
      return back && cloth ? { op: 'look', look: { back, cloth } } : null;
    }
  }
  return null;
}

/** Players back from a split-off table: add the games they finished there to tonight's tally (once; only well-formed games). */
export function mergeNight(lobby: Lobby, from: string, games: unknown[]) {
  if (!lobby.splits?.some((x) => x.code === from)) return;
  const known = new Set((lobby.night?.games ?? []).map((g) => `${g.at}:${g.game}`));
  const fresh = games
    .slice(0, 100)
    .map(cleanNightGame)
    .filter((g): g is NightGame => !!g && !known.has(`${g.at}:${g.game}`));
  if (fresh.length) {
    lobby.night ??= { games: [] };
    lobby.night.games.push(...fresh);
    lobby.night.games.sort((a, b) => a.at - b.at);
  }
  lobby.splits = lobby.splits.filter((x) => x.code !== from);
}
