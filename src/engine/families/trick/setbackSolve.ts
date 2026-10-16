import { parseCard } from '../../cards';
import { GAME_POINTS, SMUDGE } from './pitch';

/**
 * Setback's hands solved exactly, every card known: six cards a player, so a whole hand can be
 * searched (alpha-beta, this side against the rest). The value is this side's score for the hand
 * against the others' (High, Low, Jack and Game; the bidders set back by their bid if short).
 *
 * Its rules are Setback's: follow suit or trump (a trump may always be played); with none of the
 * suit led, anything. The highest trump wins, else the highest card of the suit led.
 *
 * Cards are held as bits, a mask of ranks for each suit and seat, so that the legal plays, who
 * wins a trick and which cards are equivalent are a few bit operations each; and of each run of
 * equivalent cards (the same suit, nothing still in play between them, the same worth) only one is
 * searched. That's what keeps a whole hand quick to solve.
 */

export interface SetbackDeal {
  /** Each seat's cards (seat order is play order). */
  hands: string[][];
  trump: string;
  /** Cards already in the trick, in order, and who played them. */
  trick: { seat: number; card: string }[];
  /** Whose turn it is. */
  turn: number;
  /** Each seat's side (team index). */
  side: number[];
  /** The side whose score is maximised (everyone else minimises it: they're all against it). */
  me: number;
  /** The bidders' side and bid (5: smudge). */
  bidders: number;
  bid: number;
  /** Game points each side has taken so far, and the scoring cards already won (side index, or -1). */
  game: number[];
  lowTo: number;
  jackTo: number;
  /** Tricks each side has taken (for smudge). */
  tricks: number[];
  /** The scoring trumps in play (dealt): High's holder's side, the low and the jack (null: not dealt). */
  highSide: number | null;
  low: string | null;
  jack: string | null;
  handSize: number;
}

const SUITS = 'SHDC';
/** A card as a number: suit × 16 + rank (2–14). */
const code = (id: string) => {
  const p = parseCard(id);
  return SUITS.indexOf(p.suit) * 16 + p.rank;
};
const idOf = (c: number) => `${'  23456789TJQKA'[c & 15]}${SUITS[c >> 4]}`;
const POINTS = Array.from({ length: 16 }, (_, r) => GAME_POINTS[r] ?? 0);

/** Each card the player to move may play, and the score it leads to with best play by everyone. */
export function solveSetback(d: SetbackDeal, budget = { nodes: 400_000 }): { card: string; value: number }[] | null {
  const n = d.hands.length;
  const nSides = Math.max(...d.side) + 1;
  const T = SUITS.indexOf(d.trump);
  const low = d.low ? code(d.low) : -1;
  const jack = d.jack ? code(d.jack) : -1;
  // hands[seat][suit]: a mask of ranks
  const hands = d.hands.map((h) => {
    const m = [0, 0, 0, 0];
    for (const id of h) {
      const c = code(id);
      m[c >> 4] |= 1 << (c & 15);
    }
    return m;
  });
  let left = d.hands.reduce((t, h) => t + h.length, 0);
  let nodes = 0;
  const trick: number[] = d.trick.map((t) => code(t.card));
  const trickBy: number[] = d.trick.map((t) => t.seat);

  function finalValue(game: number[], lowTo: number, jackTo: number, tricks: number[]): number {
    const pts = Array(nSides).fill(0);
    if (d.highSide != null) pts[d.highSide]++;
    if (low >= 0 && lowTo >= 0) pts[lowTo]++;
    if (jack >= 0 && jackTo >= 0) pts[jackTo]++;
    let most = -1;
    let at = -1;
    let ties = 0;
    for (let k = 0; k < nSides; k++)
      if (game[k] > most) {
        most = game[k];
        at = k;
        ties = 1;
      } else if (game[k] === most) ties++;
    if (ties === 1) pts[at]++;
    const made = d.bid === SMUDGE ? tricks[d.bidders] === d.handSize && jack >= 0 : pts[d.bidders] >= d.bid;
    let mine = 0;
    let others = 0;
    for (let k = 0; k < nSides; k++) {
      const v = k !== d.bidders ? pts[k] : d.bid === SMUDGE ? (made ? SMUDGE : -SMUDGE) : made ? pts[k] : -d.bid;
      if (k === d.me) mine = v;
      else others += v;
    }
    return mine - others / Math.max(1, nSides - 1);
  }

  /** The plays to search for `seat`: legal, and one of each run of equivalent cards. */
  function plays(seat: number): number[] {
    const h = hands[seat];
    let suits = [0, 1, 2, 3];
    if (trick.length) {
      const led = trick[0] >> 4;
      if (h[led]) suits = led === T ? [led] : [led, T];
    }
    // every card still in play (hands and the trick), to tell which are equivalent
    const live = [0, 0, 0, 0];
    for (const m of hands) for (let s = 0; s < 4; s++) live[s] |= m[s];
    for (const c of trick) live[c >> 4] |= 1 << (c & 15);
    const out: number[] = [];
    for (const s of suits) {
      const m = h[s];
      if (!m) continue;
      let prev = -1;
      for (let r = 14; r >= 2; r--) {
        if (!(m & (1 << r))) {
          // another card still in play breaks the run
          if (live[s] & (1 << r)) prev = -1;
          continue;
        }
        const c = s * 16 + r;
        const special = c === low || c === jack || POINTS[r] > 0;
        if (prev >= 0 && !special && !(prev === low || prev === jack || POINTS[prev & 15] > 0)) {
          prev = c;
          continue;
        }
        out.push(c);
        prev = c;
      }
    }
    return out;
  }

  function winner(): number {
    const led = trick[0] >> 4;
    let best = 0;
    for (let i = 1; i < trick.length; i++) {
      const a = trick[i];
      const b = trick[best];
      const as = a >> 4;
      const bs = b >> 4;
      if (as === bs ? (a & 15) > (b & 15) : as === T || (as === led && bs !== T && bs !== led)) best = i;
    }
    return trickBy[best];
  }

  function search(turn: number, game: number[], lowTo: number, jackTo: number, tricks: number[], alpha: number, beta: number): number {
    if (++nodes > budget.nodes) throw new Error('budget');
    if (trick.length === n) {
      const w = winner();
      const ws = d.side[w];
      const g2 = [...game];
      let lt = lowTo;
      let jt = jackTo;
      for (const c of trick) {
        g2[ws] += POINTS[c & 15];
        if (c === low) lt = ws;
        if (c === jack) jt = ws;
      }
      const tr = [...tricks];
      tr[ws]++;
      if (!left) return finalValue(g2, lt, jt, tr);
      const saved = trick.splice(0);
      const savedBy = trickBy.splice(0);
      const v = search(w, g2, lt, jt, tr, alpha, beta);
      trick.push(...saved);
      trickBy.push(...savedBy);
      return v;
    }
    const list = plays(turn);
    // (trumps and high cards first: they settle tricks, so the cut-offs come sooner)
    list.sort((a, b) => (b >> 4 === T ? 20 : 0) + (b & 15) - ((a >> 4 === T ? 20 : 0) + (a & 15)));
    const maxing = d.side[turn] === d.me;
    let best = maxing ? -Infinity : Infinity;
    for (const c of list) {
      hands[turn][c >> 4] &= ~(1 << (c & 15));
      trick.push(c);
      trickBy.push(turn);
      left--;
      const v = search((turn + 1) % n, game, lowTo, jackTo, tricks, alpha, beta);
      left++;
      trick.pop();
      trickBy.pop();
      hands[turn][c >> 4] |= 1 << (c & 15);
      if (maxing) {
        if (v > best) best = v;
        if (v > alpha) alpha = v;
      } else {
        if (v < best) best = v;
        if (v < beta) beta = v;
      }
      if (alpha >= beta) break;
    }
    return best;
  }

  try {
    // every legal card at the root (not just one of each run: the caller wants them all)
    const h = d.hands[d.turn];
    const first = plays(d.turn);
    const legal = h.filter((id) => {
      const c = code(id);
      if (!trick.length) return true;
      const led = trick[0] >> 4;
      return !hands[d.turn][led] || c >> 4 === led || c >> 4 === T;
    });
    const value = new Map<number, number>();
    for (const c of first) {
      hands[d.turn][c >> 4] &= ~(1 << (c & 15));
      trick.push(c);
      trickBy.push(d.turn);
      left--;
      value.set(c, search((d.turn + 1) % n, d.game, d.lowTo, d.jackTo, d.tricks, -Infinity, Infinity));
      left++;
      trick.pop();
      trickBy.pop();
      hands[d.turn][c >> 4] |= 1 << (c & 15);
    }
    // an equivalent card is worth the same as the one searched for its run (the next higher searched in its suit)
    return legal.map((id) => {
      const c = code(id);
      if (value.has(c)) return { card: id, value: value.get(c)! };
      const above = first.filter((x) => x >> 4 === c >> 4 && x > c).sort((a, b) => a - b)[0];
      return { card: id, value: value.get(above ?? first[0])! };
    });
  } catch {
    return null;
  }
}

export { idOf as setbackCardId };

/** The cards `seat` may play: follow suit or trump; anything when out of the suit led. */
export function legalPlays(hand: string[], trick: { card: string }[], trump: string): string[] {
  if (!trick.length) return hand;
  const led = parseCard(trick[0].card).suit;
  const follow = hand.filter((c) => parseCard(c).suit === led);
  if (!follow.length) return hand;
  return hand.filter((c) => parseCard(c).suit === led || parseCard(c).suit === trump);
}
