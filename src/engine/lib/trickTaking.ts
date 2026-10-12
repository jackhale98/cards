import { parseCard, type Suit } from '../cards';
import type { CardRef } from '../types';

/** Cards in `hand` that may legally be played to a trick led with `led` (follow suit if able). */
export function followSuit(hand: string[], led: Suit | null, suitOf = (id: string) => parseCard(id).suit): string[] {
  if (!led) return hand;
  const following = hand.filter((id) => suitOf(id) === led);
  return following.length ? following : hand;
}

export interface TrickRules {
  trump?: Suit | null;
  /** Override the effective suit (e.g. euchre's left bower). */
  suitOf?: (id: string) => string;
  /** Override the rank used to compare cards within a suit. */
  rankOf?: (id: string) => number;
  /** Two identical cards (from a double pack): the one played later wins (six-handed spades). Otherwise the first does. */
  laterWinsTies?: boolean;
}

/** Index (into `trick`) of the winning card. */
export function trickWinner(trick: CardRef[], rules: TrickRules = {}): number {
  const suitOf = rules.suitOf ?? ((id: string) => parseCard(id).suit);
  const rankOf = rules.rankOf ?? ((id: string) => parseCard(id).rank);
  const led = suitOf(trick[0].id);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const c = trick[i].id;
    const b = trick[best].id;
    const cTrump = !!rules.trump && suitOf(c) === rules.trump;
    const bTrump = !!rules.trump && suitOf(b) === rules.trump;
    if (cTrump && !bTrump) best = i;
    else if (cTrump === bTrump && suitOf(c) === suitOf(b) && (rankOf(c) > rankOf(b) || (!!rules.laterWinsTies && rankOf(c) === rankOf(b)))) best = i;
    else if (!cTrump && !bTrump && suitOf(c) === led && suitOf(b) !== led) best = i;
  }
  return best;
}
