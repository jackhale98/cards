import { parseCard } from '../cards';

/**
 * The cards of the canasta games (Canasta, Hand and Foot): what is wild, the threes that can't be
 * melded, and what each card is worth at the end of a hand.
 */

/** Jokers and 2s are wild. */
export const isWild = (id: string) => {
  const c = parseCard(id);
  return c.suit === 'X' || c.rank === 2;
};
export const isRedThree = (id: string) => {
  const c = parseCard(id);
  return c.rank === 3 && (c.suit === 'H' || c.suit === 'D');
};
export const isBlackThree = (id: string) => {
  const c = parseCard(id);
  return c.rank === 3 && (c.suit === 'S' || c.suit === 'C');
};

/** Card values: joker 50, 2 and A 20, K–8 10, 7–4 and black 3 5. */
export function cardPoints(id: string): number {
  const c = parseCard(id);
  if (c.suit === 'X') return 50;
  if (c.rank === 2 || c.rank === 14) return 20;
  if (c.rank >= 8) return 10;
  return 5;
}

/** Cards grouped by rank (in the order the ranks first appear). */
export function groupByRank(cards: string[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const c of cards) out.set(parseCard(c).rank, [...(out.get(parseCard(c).rank) ?? []), c]);
  return out;
}
