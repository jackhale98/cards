import { bidLabel, type Call } from '../contracts';
import { callName, callOf, handInfo, SUIT_NAME, type HandInfo } from './auction';
import { legal, rulesHere, systemCall } from './bidder';
import type { Hand } from './hands';
import { callFor, fits, saysFor, type Rule, type System } from './rules';

/**
 * Grading a person's call against the system's rules, which are the answer key: the same rules the
 * bots bid by, read in their order. Five verdicts:
 *
 * - `book`: the call the rules give this hand (the first rule it fits);
 * - `allowed`: a rule gives this call for this hand, but one ahead of it gives another, which the book prefers;
 * - `breaks`: the call's rules don't fit this hand: what each asks for that the hand hasn't got;
 * - `judgment`: no rule covers this point (the bots judge it): their call, a suggestion, not the answer;
 * - `uncovered`: rules cover this point, but none gives this call (a convention we don't play, perhaps): not called wrong.
 */

export type Verdict = 'book' | 'allowed' | 'breaks' | 'judgment' | 'uncovered';

export interface Grade {
  verdict: Verdict;
  /** The call made, and what it means here (when a rule gives it). */
  call: string;
  says: string;
  /** The book's call, and what it means. */
  book: string;
  bookSays: string;
  /** What the call asks for that this hand hasn't got (`breaks`). */
  reasons: string[];
}

/** A call as a player reads it: "1♠", "1NT", "Pass", "Double". */
export const callText = (call: Call | string): string => {
  const c = typeof call === 'string' ? callOf(call) : call;
  return typeof c === 'number' ? bidLabel(c) : c === 'P' ? 'Pass' : c === 'X' ? 'Double' : 'Redouble';
};

const SUITS = ['S', 'H', 'D', 'C'] as const;
const range = ([a, b]: [number, number], top: number) => (b >= top ? `${a}+` : a === b ? `${a}` : `${a}–${b}`);

/** What `rule` asks for that the hand hasn't got, in a player's words. */
export function shortfalls(rule: Rule, h: HandInfo, c: Parameters<typeof fits>[2]): string[] {
  const out: string[] = [];
  const n = rule.need;
  if (n.hcp && (h.hcp < n.hcp[0] || h.hcp > n.hcp[1])) out.push(`${range(n.hcp, 37)} points (you have ${h.hcp})`);
  for (const x of SUITS) {
    const r = n[x];
    if (!r) continue;
    const len = h.L[x];
    if (len < r[0]) out.push(`${r[0]} or more ${SUIT_NAME[x]} (you have ${len})`);
    else if (len > r[1]) out.push(`${r[1] === 0 ? 'no' : `at most ${r[1]}`} ${SUIT_NAME[x]} (you have ${len})`);
  }
  if (n.balanced && !h.balanced) out.push(`a balanced hand: 4-3-3-3, 4-4-3-2 or 5-3-3-2 (yours is ${h.pattern.split('').join('-')})`);
  if (!out.length && rule.also && !rule.also(h, c)) out.push('more than your hand has: see what the call means');
  return out;
}

export function gradeCall(system: System, calls: { seat: number; call: Call }[], seat: number, vul: [boolean, boolean], hand: Hand, call: Call): Grade {
  const { c, rules } = rulesHere(system, calls, seat, vul);
  const h = handInfo(hand);
  const name = callName(call);
  // the book: the first rule this hand fits that gives a legal call (as the bots bid); none, the bots' judgment
  const bookRule = rules.find((r) => fits(r, h, c) && !!callFor(r, c) && legal(c, callOf(callFor(r, c)!)));
  const book = bookRule ? callFor(bookRule, c)! : callName(systemCall(system, calls, seat, vul, hand));
  const bookSays = bookRule ? saysFor(bookRule, c) : '';
  const mine = rules.filter((r) => callFor(r, c) === name);
  const fitting = mine.find((r) => fits(r, h, c));
  const grade = (verdict: Verdict, says: string, reasons: string[] = []): Grade => ({ verdict, call: name, says, book, bookSays, reasons });
  if (name === book) return grade(bookRule ? 'book' : 'judgment', bookRule ? bookSays : fitting ? saysFor(fitting, c) : '');
  // (a pass the rules allow is only for hands nothing else fits: with this one, something does)
  if (fitting && name !== 'P') return grade('allowed', saysFor(fitting, c));
  if (mine.length) {
    const closest = mine
      .map((r) => ({ r, why: shortfalls(r, h, c) }))
      .filter((x) => x.why.length)
      .sort((a, b) => a.why.length - b.why.length)[0];
    return grade('breaks', closest ? saysFor(closest.r, c) : '', closest?.why ?? []);
  }
  return grade(bookRule ? 'uncovered' : 'judgment', '');
}
