import { bidOf, bridgeScore, contractCode } from '../families/trick/contracts';
import type { BoardResult } from '../types';

/**
 * Par: a deal's score when both sides bid perfectly, every card known (double dummy). Each side
 * may bid higher while that does better for it; a contract that makes scores what it makes (its
 * overtricks too), and one that fails is doubled. So the side that can score more gets there,
 * unless the other side's sacrifice, doubled going down, costs them less than letting them make it.
 * Worked out from the tricks each side takes in each strain (DDS's table) as the auction would go,
 * the dealer's side bidding first.
 */

/** DDS's table's strains in order (spades, hearts, diamonds, clubs, no trumps), by our strain codes. */
const DDS_STRAIN: Record<string, number> = { S: 0, H: 1, D: 2, C: 3, NT: 4 };

/**
 * Par for a deal: `table[strain][seat]` the tricks for each declarer (DDS's order: strains ♠ ♥ ♦ ♣
 * NT, seats North East South West), `dealer` a seat, `vul` [North–South, East–West]. The par
 * contract (the lowest that scores it), who declares (the better of the two), the tricks, and
 * North–South's score.
 */
export function par(table: number[][], dealer: number, vul: readonly boolean[]): BoardResult & { n: 0 } {
  // the side's declarer in a bid's strain (the partner who takes more), and the board's score for it, North–South's way
  const declarer = (side: number, bid: number) => {
    const s = DDS_STRAIN[bidOf(bid).strain];
    return table[s][side] >= table[s][side + 2] ? side : side + 2;
  };
  const tricks = (side: number, bid: number) => table[DDS_STRAIN[bidOf(bid).strain]][declarer(side, bid)];
  const score = (side: number, bid: number) => {
    const { level, strain } = bidOf(bid);
    const won = tricks(side, bid);
    const x = bridgeScore({ level, strain: strain as 'NT', dbl: won >= level + 6 ? 0 : 1 }, vul[side], won);
    return side === 0 ? x : -x;
  };
  // North–South want the most, East–West the least
  const better = (side: number, a: number, b: number) => (side === 0 ? a > b : a < b);

  type End = { ns: number; bid: number; side: number } | { ns: 0; bid: -1; side: -1 };
  // the auction's end with `side` just having bid `bid`, the other side to answer: pass, or bid higher
  const memo = new Map<number, End>();
  const answer = (bid: number, side: number): End => {
    const key = bid * 2 + side;
    const known = memo.get(key);
    if (known) return known;
    const other = 1 - side;
    let best: End = { ns: score(side, bid), bid, side };
    for (let higher = bid + 1; higher < 35; higher++) {
      const e = answer(higher, other);
      if (better(other, e.ns, best.ns)) best = e;
    }
    memo.set(key, best);
    return best;
  };
  // the opening: a side's best first bid (or none), the dealer's side first; all four passing scores nothing
  const open = (side: number): End | null => {
    let best: End | null = null;
    for (let bid = 0; bid < 35; bid++) {
      const e = answer(bid, side);
      if (!best || better(side, e.ns, best.ns)) best = e;
    }
    return best;
  };
  const first = dealer % 2;
  const second = 1 - first;
  const passOut: End = { ns: 0, bid: -1, side: -1 };
  const theirs = open(second)!;
  const ifPassed = better(second, theirs.ns, 0) ? theirs : passOut;
  const ours = open(first)!;
  const end = better(first, ours.ns, ifPassed.ns) ? ours : ifPassed;
  if (end.bid < 0) return { n: 0, contract: null, declarer: null, tricks: null, ns: 0 };
  const { level, strain } = bidOf(end.bid);
  const won = tricks(end.side, end.bid);
  return {
    n: 0,
    contract: contractCode({ level, strain: strain as 'NT', dbl: won >= level + 6 ? 0 : 1 }),
    declarer: declarer(end.side, end.bid),
    tricks: won,
    ns: end.ns,
  };
}
