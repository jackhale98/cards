import { parseCard } from '../engine/cards';
import type { CardRef } from '../engine/types';

/** How this device lays out your hand: as the game sorts it, by suit, or by rank. */
export type HandSort = 'game' | 'suit' | 'rank';
export const HAND_SORTS: HandSort[] = ['game', 'suit', 'rank'];
export const HAND_SORT_LABEL: Record<HandSort, string> = { game: 'as the game sorts it', suit: 'by suit', rank: 'by rank' };

const KEY = 'cards.handSort';

export function handSortOn(): HandSort {
  try {
    const v = localStorage.getItem(KEY);
    return HAND_SORTS.includes(v as HandSort) ? (v as HandSort) : 'game';
  } catch {
    return 'game';
  }
}

export function setHandSort(sort: HandSort) {
  try {
    if (sort === 'game') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, sort);
  } catch {
    /* private mode */
  }
}

/** Suits alternate colours (♠ ♥ ♣ ♦), jokers last. */
const SUIT_ORDER = 'SHCDX';

/**
 * Your hand as you see it: sorted the way you chose, then any cards you've dragged into place kept
 * where you put them (`mine`: card ids in the order you left them). A card new to the hand goes
 * where the sort would put it, beside the card it follows. Only how it looks: moves still name
 * the cards themselves.
 */
export function arrangeHand(cards: CardRef[], sort: HandSort, mine: string[]): CardRef[] {
  // (cards you can't see, or a deck of its own: as the game has them)
  let known = true;
  const info = cards.map((c) => {
    try {
      return parseCard(c.id);
    } catch {
      known = false;
      return null;
    }
  });
  let base = cards;
  if (sort !== 'game' && known) {
    const order = cards.map((c, i) => ({ c, i, card: info[i]! }));
    const suit = (x: (typeof order)[number]) => SUIT_ORDER.indexOf(x.card.suit);
    order.sort((a, b) => (sort === 'suit' ? suit(a) - suit(b) || a.card.rank - b.card.rank : a.card.rank - b.card.rank || suit(a) - suit(b)) || a.i - b.i);
    base = order.map((x) => x.c);
  }
  if (!mine.length) return base;
  const byId = new Map(base.map((c) => [c.id, c]));
  const out = mine.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const placed = new Set(out.map((c) => c.id));
  for (let i = 0; i < base.length; i++) {
    const c = base[i];
    if (placed.has(c.id)) continue;
    // after the nearest card before it (in the sorted hand) that's already placed
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === base[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, c);
    placed.add(c.id);
  }
  return out;
}
