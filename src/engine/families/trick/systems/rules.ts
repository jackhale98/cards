import { handInfo, stopped, type Ctx, type HandInfo } from './auction';
import type { Hand, Picture } from './hands';

/**
 * A bidding system as a list of rules. Each says: at this point in the auction, this call, with
 * a hand like this, means this. A bot bids the first rule its hand fits; reading partner's calls
 * runs the same rules the other way (what hands would have made that call), so a bot always
 * knows what partner has shown, and the table's log can say what each call meant.
 */

export type System = 'sayc' | 'twoOverOne';

/** What a call needs: point ranges and suit lengths (the sampler uses these to deal partner hands fast). */
export interface Need {
  hcp?: [number, number];
  S?: [number, number];
  H?: [number, number];
  D?: [number, number];
  C?: [number, number];
  balanced?: boolean;
}

export interface Rule {
  /** Where it applies: our side's calls so far ("1S 2C"), uncontested; or a test of the whole auction. */
  at: string | ((c: Ctx) => boolean);
  /** The call ("2H"), or worked out from the auction (null: none here). */
  call: string | ((c: Ctx) => string | null);
  need: Need;
  /** Anything more the hand needs. */
  also?: (h: HandInfo, c: Ctx) => boolean;
  says: string | ((c: Ctx) => string);
  /** One system only (otherwise both). */
  only?: System;
  /** Partner may not pass: for one round, or until game. */
  forcing?: 'round' | 'game';
}

export const r = (at: Rule['at'], call: Rule['call'], need: Need, says: Rule['says'], more: Partial<Rule> = {}): Rule => ({ at, call, need, says, ...more });

const SUITS = ['S', 'H', 'D', 'C'] as const;

export function fitsNeed(h: HandInfo, n: Need): boolean {
  if (n.hcp && (h.hcp < n.hcp[0] || h.hcp > n.hcp[1])) return false;
  for (const x of SUITS) {
    const range = n[x];
    if (range && (h.L[x] < range[0] || h.L[x] > range[1])) return false;
  }
  return !n.balanced || h.balanced;
}

export const fits = (rule: Rule, h: HandInfo, c: Ctx) =>
  fitsNeed(h, rule.need) && (!rule.also || rule.also(h, c)) && (!overThem(rule, c) || noTrumpsHeld(rule, h, c));

export const appliesAt = (rule: Rule, c: Ctx, system: System) =>
  (!rule.only || rule.only === system) && (typeof rule.at === 'string' ? c.seq === rule.at && (!c.contested || overThem(rule, c)) : rule.at(c));

/** The suits the other side has bid. */
const theirSuits = (c: Ctx) => c.theirBids.map((b) => b[1]).filter((x) => x !== 'N');

/**
 * An uncontested rule kept over their interference: from the opener's rebid on, after our opening,
 * when all they've done is bid at the one or two level (no doubles), the same calls mean the same,
 * except a call in their suit (a cue bid means something else). Responder's first call over an
 * overcall has rules of its own.
 */
function overThem(rule: Rule, c: Ctx): boolean {
  if (typeof rule.at !== 'string' || !c.contested || c.opened !== 'us' || rule.at.split(' ').length < 2) return false;
  if (c.calls.some((x) => !x.ours && (x.call === 'X' || x.call === 'XX'))) return false;
  if (c.theirBids.some((b) => Number(b[0]) > 2)) return false;
  const call = callFor(rule, c);
  return !!call && !theirSuits(c).includes(call[1]);
}

/** No trumps over their bids needs their suits stopped. */
const noTrumpsHeld = (rule: Rule, h: HandInfo, c: Ctx) => callFor(rule, c)?.[1] !== 'N' || theirSuits(c).every((x) => stopped(h, x));

export const callFor = (rule: Rule, c: Ctx) => (typeof rule.call === 'string' ? rule.call : rule.call(c));
export const saysFor = (rule: Rule, c: Ctx) => (typeof rule.says === 'string' ? rule.says : rule.says(c));

/**
 * Narrow a picture of partner's hand by the rules that could have made their call (any of them):
 * the loosest of their ranges for the sampler, and the exact test, which also rules out the hands
 * that would have taken a rule further up the list (`before`, for each).
 */
export function narrow(p: Picture, rules: Rule[], c: Ctx, before: Rule[][] = rules.map(() => [])): Picture {
  if (!rules.length) return p;
  const lo = (get: (n: Need) => [number, number] | undefined, def: number) => Math.min(...rules.map((x) => get(x.need)?.[0] ?? def));
  const hi = (get: (n: Need) => [number, number] | undefined, def: number) => Math.max(...rules.map((x) => get(x.need)?.[1] ?? def));
  const minLen = [...p.minLen];
  const maxLen = [...p.maxLen];
  SUITS.forEach((x, k) => {
    minLen[k] = Math.max(
      minLen[k],
      lo((n) => n[x], 0),
    );
    maxLen[k] = Math.min(
      maxLen[k],
      hi((n) => n[x], 13),
    );
  });
  const earlier = p.test;
  // (the hand fits the rule, and none of the rules ahead of it: the bot bids the first that fits)
  const test = (hand: Hand) => {
    if (earlier && !earlier(hand)) return false;
    const h = handInfo(hand);
    return rules.some((x, i) => fits(x, h, c) && !before[i].some((y) => fits(y, h, c)));
  };
  return {
    ...p,
    hcp: [
      Math.max(
        p.hcp[0],
        lo((n) => n.hcp, 0),
      ),
      Math.min(
        p.hcp[1],
        hi((n) => n.hcp, 37),
      ),
    ],
    minLen,
    maxLen,
    test,
  };
}
