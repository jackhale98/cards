import { parseCard, rankLabel } from '../engine/cards';
import { isHidden } from '../engine/redact';

const NAMES: Record<string, string> = { J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
const SUITS: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/** What a screen reader says for a card: "queen of hearts", "10 of spades", "joker", "face-down card". */
export function cardName(id: string, down = false): string {
  if (down || isHidden(id)) return 'face-down card';
  const { suit, rank } = parseCard(id);
  if (suit === 'X') return 'joker';
  const r = rankLabel(rank);
  return `${NAMES[r] ?? r} of ${SUITS[suit]}`;
}
