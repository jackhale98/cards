/**
 * Card identity. A card id is `<rank><suit>` (e.g. `AS`, `TD`, `2C`), a joker is
 * `X1`/`X2`, and copies from extra decks get a `#n` suffix (`AS#2`).
 */
export type Suit = 'S' | 'H' | 'D' | 'C';
export type SuitOrJoker = Suit | 'X';

export interface CardInfo {
  id: string;
  /** 2–14, ace = 14. Jokers are 15. */
  rank: number;
  suit: SuitOrJoker;
}

export const SUITS: Suit[] = ['S', 'H', 'C', 'D'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_CHARS = '23456789TJQKA';

export const SUIT_SYMBOL: Record<SuitOrJoker, string> = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
export const SUIT_NAME: Record<SuitOrJoker, string> = {
  S: 'spades',
  H: 'hearts',
  D: 'diamonds',
  C: 'clubs',
  X: 'joker',
};

export function rankChar(rank: number): string {
  return RANK_CHARS[rank - 2] ?? '?';
}

/** Rank as printed on a card face. */
export function rankLabel(rank: number): string {
  if (rank === 10) return '10';
  if (rank === 15) return 'JK';
  return rankChar(rank);
}

/** A card as printed in its corner: "10♥", "Q♠" (a joker: "JK★"). */
export function cardLabel(id: string): string {
  const c = parseCard(id);
  return `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
}

/** As `cardLabel`, but a joker reads "Joker" (for games where it's a card with a part to play: 500, Rummy 500). */
export const cardOrJokerLabel = (id: string) => (parseCard(id).suit === 'X' ? 'Joker' : cardLabel(id));

/** Ranks as words, for talking about them ("a seven", "two jacks"). */
export const RANK_WORDS: Record<number, string> = {
  14: 'ace',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'jack',
  12: 'queen',
  13: 'king',
};
/** A rank as a plural word: "sevens", "sixes". */
export const rankPlural = (r: number) => (r === 6 ? 'sixes' : `${RANK_WORDS[r]}s`);

export function cardId(rank: number, suit: Suit): string {
  return rankChar(rank) + suit;
}

const cache = new Map<string, CardInfo>();

export function parseCard(id: string): CardInfo {
  let info = cache.get(id);
  if (info) return info;
  const base = id.split('#')[0];
  if (base[0] === 'X') {
    info = { id, rank: 15, suit: 'X' };
  } else {
    const rank = RANK_CHARS.indexOf(base[0]) + 2;
    const suit = base[1] as Suit;
    if (rank < 2 || !SUITS.includes(suit)) throw new Error(`Bad card id: ${id}`);
    info = { id, rank, suit };
  }
  cache.set(id, info);
  return info;
}

export const isRed = (id: string) => {
  const s = parseCard(id).suit;
  return s === 'H' || s === 'D';
};

export type { DeckSpec } from './schema.gen';
import type { DeckSpec } from './schema.gen';

export function buildDeck(spec: DeckSpec = {}): string[] {
  const out: string[] = [];
  const decks = spec.decks ?? 1;
  const ranks = spec.ranks ?? RANKS;
  for (let d = 1; d <= decks; d++) {
    const suffix = decks > 1 ? `#${d}` : '';
    for (const s of SUITS) for (const r of ranks) if (!spec.exclude?.includes(cardId(r, s))) out.push(cardId(r, s) + suffix);
    for (let j = 1; j <= (spec.jokers ?? 0); j++) out.push(`X${j}${suffix}`);
  }
  out.push(...(spec.extra ?? []));
  return out;
}

export interface SortOptions {
  suitOrder?: SuitOrJoker[];
  /** Sort aces low (rank 1). */
  aceLow?: boolean;
  /** Put this suit first. */
  trump?: Suit | null;
}

/** Sort for display: grouped by alternating-colour suits, rank ascending. */
export function sortCards(ids: string[], opts: SortOptions = {}): string[] {
  let order = opts.suitOrder ?? (['S', 'H', 'C', 'D', 'X'] as SuitOrJoker[]);
  if (opts.trump) order = [opts.trump, ...order.filter((s) => s !== opts.trump)];
  const key = (id: string) => {
    const c = parseCard(id);
    const r = opts.aceLow && c.rank === 14 ? 1 : c.rank;
    return order.indexOf(c.suit) * 100 + r;
  };
  return [...ids].sort((a, b) => key(a) - key(b));
}

export function cardName(id: string): string {
  const c = parseCard(id);
  if (c.suit === 'X') return 'Joker';
  const names: Record<number, string> = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  return `${names[c.rank] ?? c.rank} of ${SUIT_NAME[c.suit]}`;
}
