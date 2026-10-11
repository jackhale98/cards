import { buildDeck, cardName, parseCard, sortCards } from './cards';
import { shuffle } from './rng';
import type { CardRef, DealStep, GameConfig, GameState, SetupPlayer, ZoneState } from './types';
import { assertRule } from './types';

/** Build the initial state for a game from its config: zones, players and a shuffled deck in `deck`. */
export function createState<D>(
  config: GameConfig,
  players: SetupPlayer[],
  seed: number,
  options: Record<string, number | boolean>,
  data: D,
): GameState<D> {
  const zones: Record<string, ZoneState> = {};
  for (const z of config.zones) {
    const make = (id: string, owner?: number): ZoneState => ({
      id,
      base: z.id,
      owner,
      label: z.label,
      visibility: z.visibility,
      layout: z.layout,
      area: z.area,
      hideEmpty: z.hideEmpty,
      scale: z.scale,
      cards: [],
    });
    if (z.perPlayer) players.forEach((_, i) => (zones[`${z.id}:${i}`] = make(`${z.id}:${i}`, i)));
    else zones[z.id] = make(z.id);
  }
  const s: GameState<D> = {
    game: config.id,
    v: 0,
    rng: seed >>> 0,
    players: players.map((p, seat) => ({ seat, name: p.name, bot: p.bot, chips: config.chips?.start ?? 0 })),
    zones,
    turn: null,
    phase: 'start',
    dealer: 0,
    data,
    log: [],
    options,
  };
  if (zones.deck) resetDeck(s, config);
  return s;
}

/**
 * Cut for the first deal: everyone cuts a card and the lowest deals (aces low; a tie cuts again).
 * Uses its own shuffled pack, so the real deck is untouched. Returns the dealer's seat.
 */
export function cutForDeal(s: GameState<any>): number {
  const pack = shuffle(buildDeck(), s);
  const low = (id: string) => (parseCard(id).rank === 14 ? 1 : parseCard(id).rank);
  let seats = s.players.map((p) => p.seat);
  while (seats.length > 1 && pack.length >= seats.length) {
    const cuts = seats.map((seat) => ({ seat, card: pack.pop()! }));
    log(s, `Cut for deal: ${cuts.map((c) => `${name(s, c.seat)} ${cardName(c.card)}`).join(', ')}`);
    const min = Math.min(...cuts.map((c) => low(c.card)));
    seats = cuts.filter((c) => low(c.card) === min).map((c) => c.seat);
  }
  return seats[0];
}

/** Put every card back in `deck`, shuffled. */
export function resetDeck(s: GameState<any>, config: GameConfig) {
  for (const z of Object.values(s.zones)) z.cards = [];
  s.zones.deck.cards = shuffle(buildDeck(config.deck), s).map((id) => ({ id }));
}

export function zone(s: GameState<any>, id: string): ZoneState {
  const z = s.zones[id];
  assertRule(z, `No zone ${id}`);
  return z;
}

export const hand = (s: GameState<any>, seat: number) => zone(s, `hand:${seat}`);
export const ids = (z: ZoneState) => z.cards.map((c) => c.id);

/** Move specific cards (by id) between zones. */
export function moveCards(
  s: GameState<any>,
  from: string,
  to: string,
  cardIds: string[],
  extra: Partial<CardRef> = {},
) {
  const src = zone(s, from);
  const dst = zone(s, to);
  for (const id of cardIds) {
    const i = src.cards.findIndex((c) => c.id === id);
    assertRule(i >= 0, `Card not in ${from}`);
    const [c] = src.cards.splice(i, 1);
    s.seq = (s.seq ?? 0) + 1;
    dst.cards.push({ id: c.id, ...extra, k: s.seq });
  }
}

/** Move the top `n` cards (end of array) of a zone. */
export function moveTop(s: GameState<any>, from: string, to: string, n: number, extra: Partial<CardRef> = {}) {
  if (n <= 0) return; // (slice(-0) would be the whole zone)
  const src = zone(s, from);
  const top = src.cards.slice(-n).reverse();
  moveCards(s, from, to, top.map((c) => c.id), extra);
}

/** Find which zone currently holds a card. */
export function findCard(s: GameState<any>, id: string): ZoneState | undefined {
  return Object.values(s.zones).find((z) => z.cards.some((c) => c.id === id));
}

/** Deal from `deck` round-robin starting left of the dealer. */
export function deal(s: GameState<any>, steps: DealStep[], seats?: number[]) {
  const order = seats ?? seatOrderFrom(s, s.dealer + 1);
  for (const step of steps) {
    if (s.zones[step.to]) {
      moveTop(s, 'deck', step.to, step.count, { up: step.faceUp });
      continue;
    }
    for (let i = 0; i < step.count; i++) {
      for (const seat of order) {
        if (zone(s, 'deck').cards.length === 0) return;
        moveTop(s, 'deck', `${step.to}:${seat}`, 1, { up: step.faceUp });
      }
    }
  }
}

/** All seats starting from `start`, wrapping around. */
export function seatOrderFrom(s: GameState<any>, start: number): number[] {
  const n = s.players.length;
  return Array.from({ length: n }, (_, i) => (((start + i) % n) + n) % n);
}

export function nextSeat(s: GameState<any>, seat: number, skip: (seat: number) => boolean = () => false) {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (seat + i) % n;
    if (!skip(next)) return next;
  }
  return seat;
}

export function sortHand(s: GameState<any>, seat: number, opts: Parameters<typeof sortCards>[1] = {}) {
  const z = hand(s, seat);
  const order = sortCards(ids(z), opts);
  z.cards.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Record what happened. Pass `seat` (and a `short` bubble label) for player actions. */
export function log(
  s: GameState<any>,
  text: string,
  seat?: number,
  short?: string,
  to?: number,
  zones?: { from?: string; to?: string },
) {
  s.log.push({ t: Date.now(), text, seat, short, to, fromZone: zones?.from, toZone: zones?.to });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

export const name = (s: GameState<any>, seat: number) => s.players[seat]?.name ?? `Seat ${seat + 1}`;

export type Relation = 'left' | 'right' | 'across';

/**
 * Where `other` sits relative to `you`. Play passes to the left, so the next seat in turn
 * order is on your left and the previous one is on your right.
 */
export function seatRelation(you: number, other: number, n: number): Relation | null {
  if (you < 0 || other === you) return null;
  const rel = (other - you + n) % n;
  if (n === 2) return 'across';
  if (rel === 1) return 'left';
  if (rel === n - 1) return 'right';
  if (n % 2 === 0 && rel === n / 2) return 'across';
  return null;
}

/**
 * Places from a score per seat (0 = first; equal scores share a place, like 1st, 1st, 3rd).
 * `lowWins` for games where the lowest score is best (Hearts).
 */
export function placesFromScores(scores: number[], lowWins = false): number[] {
  return scores.map((x) => scores.filter((y) => (lowWins ? y < x : y > x)).length);
}

/**
 * Each seat's finishing place: the declared winners first (they won, even if, as in 500, a side
 * has more points without having won), then everyone else by the game's own standings.
 */
export function standingsOf(module: { standings?: (s: GameState<any>) => number[] }, s: GameState<any>): number[] {
  const raw = module.standings?.(s) ?? s.players.map(() => 0);
  const won = new Set(s.winner ?? []);
  if (!won.size) return raw;
  const rest = s.players.map((p) => p.seat).filter((i) => !won.has(i));
  return s.players.map((p) => (won.has(p.seat) ? 0 : 1 + rest.filter((j) => raw[j] < raw[p.seat]).length));
}

/** Game night points for a place: 3 / 2 / 1 for the podium, and nothing for last. */
export function nightPoints(place: number, places: number[]): number {
  if (place === Math.max(...places)) return 0;
  return Math.max(1, 3 - place);
}
