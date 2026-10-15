import { bidOf, type Call } from '../contracts';
import { controls, hcp, type Hand } from './hands';

/**
 * The bidding as one side sees it, for the rule-based systems (SAYC, two over one). Bids are
 * written as text the way bridge players write them: "1C" … "7N", and "P", "X", "XX".
 */

export const STRAIN_LETTERS = ['C', 'D', 'H', 'S', 'N'] as const;
/** Suit letter to its place in a hand (spades, hearts, diamonds, clubs). */
export const SUIT_AT: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
export const SUIT_LETTER = ['S', 'H', 'D', 'C'];
export const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs', N: 'no trumps' };
export const SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', N: 'NT' };

export const callName = (c: Call): string => (typeof c === 'number' ? `${bidOf(c).level}${STRAIN_LETTERS[c % 5]}` : c);
export function callOf(name: string): Call {
  if (name === 'P' || name === 'X' || name === 'XX') return name;
  return (Number(name[0]) - 1) * 5 + STRAIN_LETTERS.indexOf(name[1] as 'C');
}
/** A bid's number from its name ("2S"). */
export const bidNo = (name: string) => (Number(name[0]) - 1) * 5 + STRAIN_LETTERS.indexOf(name[1] as 'C');
/** The level and strain letter of a bid's name ("4H" → 4, "H"). */
export const levelOf = (name: string) => Number(name[0]);
export const strainOf = (name: string) => name[1];

// ---- the hand ---------------------------------------------------------------------------

export interface HandInfo {
  hand: Hand;
  hcp: number;
  /** Lengths: spades, hearts, diamonds, clubs; and by letter. */
  len: number[];
  L: Record<string, number>;
  /** "5332", longest first. */
  pattern: string;
  /** 4333, 4432 or 5332. */
  balanced: boolean;
  controls: number;
  aces: number;
}

export function handInfo(hand: Hand): HandInfo {
  const len = hand.map((x) => x.length);
  const pattern = [...len].sort((a, b) => b - a).join('');
  return {
    hand,
    hcp: hcp(hand),
    len,
    L: { S: len[0], H: len[1], D: len[2], C: len[3] },
    pattern,
    balanced: pattern === '4333' || pattern === '4432' || pattern === '5332',
    controls: controls(hand),
    aces: hand.reduce((n, x) => n + (x[0] === 14 ? 1 : 0), 0),
  };
}

/** Points as a raise counts them: high cards, plus short suits (void 3, singleton 2, doubleton 1) with trumps to ruff in. */
export function dummyPoints(h: HandInfo, trump: string): number {
  if (h.L[trump] < 3) return h.hcp;
  return h.hcp + SUIT_LETTER.reduce((n, x) => (x === trump ? n : n + ([3, 2, 1][h.L[x]] ?? 0)), 0);
}

/** High cards plus a point for each card past four in a suit (for opening, and rebids). */
export const lengthPoints = (h: HandInfo) => h.hcp + h.len.reduce((n, l) => n + Math.max(0, l - 4), 0);

/** A stopper in the suit for no trumps: A, Kx, Qxx or Jxxx. */
export function stopped(h: HandInfo, suit: string) {
  const x = h.hand[SUIT_AT[suit]];
  return x[0] === 14 || (x.includes(13) && x.length >= 2) || (x.includes(12) && x.length >= 3) || (x.includes(11) && x.length >= 4);
}

// ---- the auction --------------------------------------------------------------------------

export interface Ctx {
  me: number;
  partner: number;
  /** Our side's calls from our opening (or first action) on, both partners in turn: "1S 2C". */
  seq: string;
  /** Who made the first bid of the deal (not counting passes). */
  opened: 'us' | 'them' | null;
  /** The other side has bid or doubled since our side's first bid (or opened). */
  contested: boolean;
  /** Every call so far, in order, with whose side made it. */
  calls: { seat: number; call: Call; ours: boolean }[];
  /** The last bid on the table (-1: none), who made it, and whether it's doubled. */
  lastBid: number;
  lastByUs: boolean;
  doubled: 0 | 1 | 2;
  /** This seat passed before anyone on our side bid (a passed hand). */
  passedHand: boolean;
  /** The other side's bids, by name, in order. */
  theirBids: string[];
  vul: [boolean, boolean];
}

export function contextFor(calls: { seat: number; call: Call }[], me: number, vul: [boolean, boolean]): Ctx {
  const partner = (me + 2) % 4;
  const tagged = calls.map((c) => ({ ...c, ours: c.seat === me || c.seat === partner }));
  const firstBid = tagged.find((c) => typeof c.call === 'number');
  const opened = !firstBid ? null : firstBid.ours ? 'us' : 'them';
  // our side's calls from its first non-pass call on
  const start = tagged.findIndex((c) => c.ours && c.call !== 'P');
  const ours = start < 0 ? [] : tagged.slice(start).filter((c) => c.ours);
  const contested = start >= 0 ? tagged.slice(start).some((c) => !c.ours && c.call !== 'P') || opened === 'them' : opened === 'them';
  let lastBid = -1;
  let lastByUs = false;
  let doubled: 0 | 1 | 2 = 0;
  for (const c of tagged) {
    if (typeof c.call === 'number') {
      lastBid = c.call;
      lastByUs = c.ours;
      doubled = 0;
    } else if (c.call === 'X') doubled = 1;
    else if (c.call === 'XX') doubled = 2;
  }
  return {
    me,
    partner,
    seq: ours.map((c) => callName(c.call)).join(' '),
    opened,
    contested,
    calls: tagged,
    lastBid,
    lastByUs,
    doubled,
    passedHand: start < 0 ? tagged.some((c) => c.seat === me && c.call === 'P') : tagged.slice(0, start).some((c) => c.seat === me && c.call === 'P'),
    theirBids: tagged.filter((c) => !c.ours && typeof c.call === 'number').map((c) => callName(c.call)),
    vul,
  };
}
