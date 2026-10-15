import { describe, expect, it } from 'vitest';
import { arrangeHand } from '../src/ui/handOrder';

const hand = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe('arranging your hand', () => {
  it('keeps the game’s order, or sorts by suit (colours alternating) or by rank', () => {
    const cards = hand('KD', '2S', 'AH', '9C', '2H');
    expect(ids(arrangeHand(cards, 'game', []))).toEqual(['KD', '2S', 'AH', '9C', '2H']);
    expect(ids(arrangeHand(cards, 'suit', []))).toEqual(['2S', '2H', 'AH', '9C', 'KD']);
    expect(ids(arrangeHand(cards, 'rank', []))).toEqual(['2S', '2H', '9C', 'KD', 'AH']);
  });

  it('keeps cards where you dragged them, and puts a new card where the sort would', () => {
    const mine = ['AH', '2S', 'KD'];
    expect(ids(arrangeHand(hand('2S', 'AH', 'KD'), 'suit', mine))).toEqual(mine);
    // (a 3♠ is drawn: it goes after the 2♠, the card before it when sorted)
    expect(ids(arrangeHand(hand('2S', 'AH', 'KD', '3S'), 'suit', mine))).toEqual(['AH', '2S', '3S', 'KD']);
    // a card played is simply gone
    expect(ids(arrangeHand(hand('AH', 'KD'), 'suit', mine))).toEqual(['AH', 'KD']);
  });

  it('leaves face-down cards as the game has them', () => {
    expect(ids(arrangeHand(hand('?1', 'KD', '?2'), 'rank', []))).toEqual(['?1', 'KD', '?2']);
  });
});
