import type { Night } from '../net/protocol';

/**
 * Your record across game nights, kept on this device only (nothing leaves it): each finished game
 * you played, where you placed, and who else was at the table. Read from tonight's tally as games
 * end (see App: every view), so it builds up wherever you play, host or not.
 */
export interface PlayedGame {
  at: number;
  /** Game id and name. */
  game: string;
  name: string;
  /** Your place (0 = first; ties share a place) and how many played. */
  place: number;
  players: number;
  /** The other people (not bots) at the table; those who finished behind you, and ahead of you. */
  others: string[];
  beat: string[];
  lostTo: string[];
}

const KEY = 'cards.record';
const MOST = 1000;

export function loadRecord(): PlayedGame[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((g) => g && typeof g.at === 'number' && typeof g.game === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: PlayedGame[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MOST)));
  } catch {
    /* private mode, or full */
  }
}

export function forgetRecord() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/** Add any game in tonight's tally that you (`cid`) played and this device hasn't noted yet. */
export function noteGames(night: Night | undefined, cid: string) {
  if (!night?.games.length) return;
  const list = loadRecord();
  const known = new Set(list.map((g) => `${g.at}:${g.game}`));
  let added = false;
  for (const g of night.games) {
    const me = g.results.find((r) => r.id === cid);
    if (!me || known.has(`${g.at}:${g.game}`)) continue;
    const people = g.results.filter((r) => r.id !== cid && !r.id.startsWith('bot:'));
    list.push({
      at: g.at,
      game: g.game,
      name: g.name,
      place: me.place,
      players: g.results.length,
      others: people.map((r) => r.name),
      beat: people.filter((r) => r.place > me.place).map((r) => r.name),
      lostTo: people.filter((r) => r.place < me.place).map((r) => r.name),
    });
    added = true;
  }
  if (added) save(list.sort((a, b) => a.at - b.at));
}

export interface RecordSummary {
  played: number;
  won: number;
  /** By game, most played first. */
  games: { name: string; played: number; won: number }[];
  /** The people you've played most, with how often you finished ahead of them and behind. */
  rivals: { name: string; played: number; beat: number; lostTo: number }[];
  /** Nights (days) you played on. */
  nights: number;
}

export function summarise(list: PlayedGame[]): RecordSummary {
  const games = new Map<string, { name: string; played: number; won: number }>();
  const rivals = new Map<string, { name: string; played: number; beat: number; lostTo: number }>();
  for (const g of list) {
    const row = games.get(g.game) ?? { name: g.name, played: 0, won: 0 };
    row.played++;
    if (g.place === 0) row.won++;
    games.set(g.game, row);
    for (const name of new Set(g.others ?? [])) {
      const r = rivals.get(name) ?? { name, played: 0, beat: 0, lostTo: 0 };
      r.played++;
      if (g.beat.includes(name)) r.beat++;
      if (g.lostTo.includes(name)) r.lostTo++;
      rivals.set(name, r);
    }
  }
  return {
    played: list.length,
    won: list.filter((g) => g.place === 0).length,
    games: [...games.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
    rivals: [...rivals.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
    nights: new Set(list.map((g) => new Date(g.at).toDateString())).size,
  };
}
