import { parseCard, type CardInfo } from '../cards';

/**
 * Rummy melds: sets (3–4 of a rank) and runs (3+ consecutive in a suit, ace low).
 * Finds the arrangement with the least deadwood, which is what every rummy game needs.
 */

/** Gin-style point value: ace 1, faces 10, others pip value. Jokers count 0 here. */
export function deadwoodValue(id: string): number {
  const { rank, suit } = parseCard(id);
  if (suit === 'X') return 0;
  if (rank === 14) return 1;
  return Math.min(rank, 10);
}

/** Rank with ace low (A = 1). */
const lowRank = (c: CardInfo) => (c.rank === 14 ? 1 : c.rank);

export interface MeldResult {
  melds: string[][];
  deadwood: string[];
  /** Sum of deadwood values. */
  points: number;
}

/** Every possible meld that can be made from these cards. */
export function candidateMelds(ids: string[]): string[][] {
  const cards = ids.map(parseCard).filter((c) => c.suit !== 'X');
  const out: string[][] = [];
  // sets: every 3- or 4-card group of one rank
  const byRank = new Map<number, string[]>();
  for (const c of cards) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c.id]);
  for (const group of byRank.values()) {
    if (group.length >= 3) {
      if (group.length === 4) {
        out.push(group);
        for (let skip = 0; skip < 4; skip++) out.push(group.filter((_, i) => i !== skip));
      } else out.push(group);
    }
  }
  // runs: every consecutive stretch of 3+ within a suit
  const bySuit = new Map<string, CardInfo[]>();
  for (const c of cards) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
  for (const suited of bySuit.values()) {
    const sorted = [...suited].sort((a, b) => lowRank(a) - lowRank(b));
    for (let i = 0; i < sorted.length; i++) {
      const run = [sorted[i]];
      for (let j = i + 1; j < sorted.length && lowRank(sorted[j]) === lowRank(run[run.length - 1]) + 1; j++) {
        run.push(sorted[j]);
        if (run.length >= 3) out.push(run.map((c) => c.id));
      }
    }
  }
  return out;
}

/** The meld arrangement that leaves the least deadwood (exhaustive search; hands are small). */
export function bestMelds(ids: string[]): MeldResult {
  const candidates = candidateMelds(ids);
  let best: MeldResult = { melds: [], deadwood: [...ids], points: total(ids) };

  function search(start: number, used: Set<string>, chosen: string[][]) {
    const deadwood = ids.filter((id) => !used.has(id));
    const points = total(deadwood);
    if (points < best.points) best = { melds: chosen.map((m) => [...m]), deadwood, points };
    for (let i = start; i < candidates.length; i++) {
      const m = candidates[i];
      if (m.some((id) => used.has(id))) continue;
      m.forEach((id) => used.add(id));
      chosen.push(m);
      search(i + 1, used, chosen);
      chosen.pop();
      m.forEach((id) => used.delete(id));
    }
  }
  search(0, new Set(), []);
  return best;
}

function total(ids: string[]) {
  return ids.reduce((n, id) => n + deadwoodValue(id), 0);
}

/** Can `card` be added to `meld`? */
export function fitsMeld(card: string, meld: string[]): boolean {
  const c = parseCard(card);
  const cards = meld.map(parseCard);
  const isSet = cards.every((m) => m.rank === cards[0].rank);
  if (isSet) return c.rank === cards[0].rank && meld.length < 4;
  if (cards.some((m) => m.suit !== c.suit)) return false;
  const ranks = cards.map(lowRank).sort((a, b) => a - b);
  return lowRank(c) === ranks[0] - 1 || lowRank(c) === ranks[ranks.length - 1] + 1;
}

/**
 * Lay off as many deadwood cards as possible onto another player's melds (repeating, since one
 * layoff can open another). Mutates `melds`; returns the cards laid off.
 */
export function layOff(deadwood: string[], melds: string[][]): string[] {
  const laid: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const card of deadwood) {
      if (laid.includes(card)) continue;
      const meld = melds.find((m) => fitsMeld(card, m));
      if (meld) {
        meld.push(card);
        laid.push(card);
        progress = true;
      }
    }
  }
  return laid;
}

/** Display order: melds first (runs in rank order), then deadwood low to high. */
export function meldOrder(ids: string[]): string[] {
  const { melds, deadwood } = bestMelds(ids);
  const byRank = (a: string, b: string) => lowRank(parseCard(a)) - lowRank(parseCard(b));
  return [...melds.flatMap((m) => [...m].sort(byRank)), ...[...deadwood].sort(byRank)];
}
