import { SUIT_SYMBOL, type Suit } from '../../cards';

/** Contracts and their scores: 500's bids (the Avondale schedule) and contract bridge. */

/** A 500 bid: tricks (6–10) in a suit or no trumps. */
export interface Contract {
  tricks: number;
  suit: Suit | 'NT';
  value: number;
  /** Misère: take no tricks, partner sits out (open: hand face up after the first trick). */
  misere?: 'closed' | 'open';
}

/** 500's Avondale schedule: 6♠ 40 … 10NT 520 (spades, clubs, diamonds, hearts, no trumps). */
export const AVONDALE_SUITS: (Suit | 'NT')[] = ['S', 'C', 'D', 'H', 'NT'];
export const avondale = (tricks: number, suit: Suit | 'NT') => 40 + (tricks - 6) * 100 + AVONDALE_SUITS.indexOf(suit) * 20;
export const SUIT_BIDS: Contract[] = [6, 7, 8, 9, 10]
  .flatMap((t) => AVONDALE_SUITS.map((suit) => ({ tricks: t, suit, value: avondale(t, suit) })))
  .sort((a, b) => a.value - b.value);
export const MISERE: Contract = { tricks: 0, suit: 'NT', value: 250, misere: 'closed' };
export const OPEN_MISERE: Contract = { tricks: 0, suit: 'NT', value: 500, misere: 'open' };
/** Every 500 bid from lowest to highest: misère ranks above the sevens, open misère between 10♦ and 10♥. */
export const ALL_BIDS: Contract[] = (() => {
  const out = [...SUIT_BIDS];
  out.splice(
    out.findIndex((b) => b.tricks === 8),
    0,
    MISERE,
  );
  out.splice(
    out.findIndex((b) => b.tricks === 10 && b.suit === 'H'),
    0,
    OPEN_MISERE,
  );
  return out;
})();
// a thin space keeps a bid ("6 ♦") from reading as a card ("6♦")
export const contractLabel = (c: Contract) =>
  c.misere ? (c.misere === 'open' ? 'Open misère' : 'Misère') : `${c.tricks}\u2009${c.suit === 'NT' ? 'NT' : SUIT_SYMBOL[c.suit]}`;
export const SAME_COLOUR: Record<Suit, Suit> = { S: 'C', C: 'S', H: 'D', D: 'H' };
/** Suits by index, for "name trumps" choices. */
export const NAMEABLE: Suit[] = ['S', 'H', 'D', 'C'];
/** Contract bridge: bids are numbered 0 (1♣) … 34 (7NT). */
export const STRAINS: (Suit | 'NT')[] = ['C', 'D', 'H', 'S', 'NT'];
export const bidOf = (i: number) => ({ level: Math.floor(i / 5) + 1, strain: STRAINS[i % 5] });
export const bidLabel = (i: number) => contractLabel({ tricks: bidOf(i).level, suit: bidOf(i).strain, value: 0 });
export type Call = number | 'P' | 'X' | 'XX';
export interface BridgeContract {
  level: number;
  strain: Suit | 'NT';
  /** 0 undoubled, 1 doubled, 2 redoubled. */
  dbl: 0 | 1 | 2;
}
export const bridgeLabel = (c: BridgeContract, short = false) =>
  `${contractLabel({ tricks: c.level, suit: c.strain, value: 0 })}${short ? ['', '×', '××'][c.dbl] : ['', ' doubled', ' redoubled'][c.dbl]}`;

/**
 * Duplicate bridge score for one deal: positive = the declaring side's score, negative = what the
 * defenders score.
 */
export function bridgeScore(c: BridgeContract, vul: boolean, won: number): number {
  const need = c.level + 6;
  if (won < need) {
    const down = need - won;
    if (!c.dbl) return -down * (vul ? 100 : 50);
    let pts = 0;
    for (let i = 1; i <= down; i++) pts += vul ? (i === 1 ? 200 : 300) : i === 1 ? 100 : i <= 3 ? 200 : 300;
    return -pts * c.dbl;
  }
  const per = c.strain === 'C' || c.strain === 'D' ? 20 : 30;
  const mult = [1, 2, 4][c.dbl];
  const trickPts = (c.level * per + (c.strain === 'NT' ? 10 : 0)) * mult;
  let score = trickPts + (trickPts >= 100 ? (vul ? 500 : 300) : 50);
  if (c.level === 6) score += vul ? 750 : 500;
  if (c.level === 7) score += vul ? 1500 : 1000;
  score += 50 * c.dbl;
  const over = won - need;
  score += c.dbl ? over * (vul ? 200 : 100) * c.dbl : over * per;
  return score;
}
