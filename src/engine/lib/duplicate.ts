/**
 * Duplicate bridge's arithmetic: who deals and who is vulnerable on each board (the standard
 * sixteen-board cycle), International Match Points for a difference in score (teams), and
 * matchpoints (pairs). Seats are North 0, East 1, South 2, West 3.
 */

/** Who deals board `n`: North, East, South, West in turn. */
export const boardDealer = (n: number) => (((n - 1) % 4) + 4) % 4;

export type Vulnerable = 'None' | 'NS' | 'EW' | 'All';
const VUL: Vulnerable[] = ['None', 'NS', 'EW', 'All'];
/** Who is vulnerable on board `n` (the cycle shifts by one every four boards, repeating every sixteen). */
export const boardVul = (n: number): Vulnerable => VUL[(((n - 1 + Math.floor((n - 1) / 4)) % 4) + 4) % 4];
/** Board `n`'s vulnerability by side: [North–South, East–West]. */
export const vulSides = (n: number): [boolean, boolean] => {
  const v = boardVul(n);
  return [v === 'NS' || v === 'All', v === 'EW' || v === 'All'];
};

/** International Match Points for a difference in score (the WBF scale). */
const IMP_STEPS = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
export function imps(diff: number): number {
  const a = Math.abs(diff);
  let n = 0;
  while (n < IMP_STEPS.length && a >= IMP_STEPS[n]) n++;
  return diff < 0 ? -n : n;
}

/**
 * Matchpoints for North–South's scores on one board, one per table: two for each other North–South
 * score beaten, one for each tied. East–West's are the top (`2 × (tables − 1)`) less North–South's.
 */
export function matchpoints(ns: number[]): number[] {
  return ns.map((x, i) => ns.reduce((m, y, j) => m + (i === j ? 0 : x > y ? 2 : x === y ? 1 : 0), 0));
}
/** The most matchpoints a pair can score on a board played at `tables` tables. */
export const matchpointTop = (tables: number) => 2 * Math.max(0, tables - 1);
