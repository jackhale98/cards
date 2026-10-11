/**
 * Poker-style betting rounds: blinds, no-limit raises, all-ins and side pots.
 * Pure data + functions so any betting game (hold'em, omaha, stud, …) can reuse it.
 */
export interface BettingState {
  /** Chips each seat has put in during the current street. */
  bets: number[];
  /** Chips each seat has put in during the whole hand. */
  committed: number[];
  folded: boolean[];
  allIn: boolean[];
  /** Seats that have acted since the last bet/raise. */
  acted: boolean[];
  /** Seats not dealt into this hand (busted / sitting out). */
  out: boolean[];
  currentBet: number;
  minRaise: number;
}

export type BetAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export function newBetting(n: number, out: boolean[]): BettingState {
  return {
    bets: Array(n).fill(0),
    committed: Array(n).fill(0),
    folded: Array(n).fill(false),
    allIn: Array(n).fill(false),
    acted: Array(n).fill(false),
    out: [...out],
    currentBet: 0,
    minRaise: 0,
  };
}

/** Put chips in without counting as a voluntary action (blinds, antes). */
export function post(b: BettingState, chips: number[], seat: number, amount: number) {
  const amt = Math.min(amount, chips[seat]);
  chips[seat] -= amt;
  b.bets[seat] += amt;
  b.committed[seat] += amt;
  if (chips[seat] === 0) b.allIn[seat] = true;
  if (b.bets[seat] > b.currentBet) b.currentBet = b.bets[seat];
}

export function newStreet(b: BettingState, bigBlind: number) {
  b.bets.fill(0);
  b.acted.fill(false);
  b.currentBet = 0;
  b.minRaise = bigBlind;
}

export const inHand = (b: BettingState, seat: number) => !b.out[seat] && !b.folded[seat];
export const canAct = (b: BettingState, seat: number) => inHand(b, seat) && !b.allIn[seat];

export interface BetOptions {
  canCheck: boolean;
  toCall: number;
  /** Minimum and maximum "raise to" totals for this street. */
  minRaiseTo: number;
  maxRaiseTo: number;
  canRaise: boolean;
}

export function options(b: BettingState, chips: number[], seat: number): BetOptions {
  const toCall = Math.min(b.currentBet - b.bets[seat], chips[seat]);
  const maxRaiseTo = b.bets[seat] + chips[seat];
  const minRaiseTo = Math.min(b.currentBet + b.minRaise, maxRaiseTo);
  return {
    canCheck: toCall === 0,
    toCall,
    minRaiseTo,
    maxRaiseTo,
    canRaise: maxRaiseTo > b.currentBet,
  };
}

export function act(b: BettingState, chips: number[], seat: number, a: BetAction) {
  const o = options(b, chips, seat);
  switch (a.type) {
    case 'fold':
      b.folded[seat] = true;
      break;
    case 'check':
      if (!o.canCheck) throw new Error('Cannot check');
      break;
    case 'call':
      post(b, chips, seat, o.toCall);
      break;
    case 'allin':
    case 'raise': {
      const to = a.type === 'allin' ? o.maxRaiseTo : Math.min(a.to, o.maxRaiseTo);
      if (to <= b.currentBet) {
        // all-in for less than a call is just a call
        post(b, chips, seat, to - b.bets[seat]);
        break;
      }
      if (to < o.minRaiseTo && to !== o.maxRaiseTo) throw new Error(`Minimum raise is to ${o.minRaiseTo}`);
      const raiseBy = to - b.currentBet;
      post(b, chips, seat, to - b.bets[seat]);
      // a full raise re-opens action for everyone
      if (raiseBy >= b.minRaise) {
        b.minRaise = raiseBy;
        b.acted.fill(false);
      }
      break;
    }
  }
  b.acted[seat] = true;
}

export const live = (b: BettingState) => b.bets.map((_, i) => i).filter((i) => inHand(b, i));

/** The street is over once everyone who can still act has acted and matched the bet. */
export function streetComplete(b: BettingState): boolean {
  const players = live(b);
  if (players.length <= 1) return true;
  const actors = players.filter((i) => !b.allIn[i]);
  if (actors.length === 0) return true;
  // a lone player with chips has nobody to bet against once they've matched the bet
  if (actors.length === 1) return b.bets[actors[0]] >= b.currentBet;
  return actors.every((i) => b.acted[i] && b.bets[i] === b.currentBet);
}

/** Nobody left who could bet against anybody: deal remaining streets without betting. */
export function bettingClosed(b: BettingState): boolean {
  return live(b).filter((i) => !b.allIn[i]).length <= 1;
}

export interface Pot {
  amount: number;
  eligible: number[];
}

/** Split committed chips into a main pot and side pots. */
export function pots(b: BettingState): Pot[] {
  const levels = [...new Set(live(b).map((i) => b.committed[i]))].sort((x, y) => x - y);
  const result: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of b.committed) amount += Math.max(0, Math.min(c, level) - prev);
    const eligible = live(b).filter((i) => b.committed[i] >= level);
    if (amount > 0) result.push({ amount, eligible });
    prev = level;
  }
  // chips from folded players above the top live level go to the last pot
  const total = b.committed.reduce((x, y) => x + y, 0);
  const counted = result.reduce((x, p) => x + p.amount, 0);
  if (result.length && total > counted) result[result.length - 1].amount += total - counted;
  return result;
}

export const potTotal = (b: BettingState) => b.committed.reduce((x, y) => x + y, 0);
