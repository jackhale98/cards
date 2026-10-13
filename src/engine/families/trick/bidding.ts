import { cardName, parseCard, SUIT_SYMBOL, type Suit } from '../../cards';
import { hand, ids, log, moveCards, name, nextSeat, sortHand, zone } from '../../state';
import { assertRule, type Action } from '../../types';
import { ALL_BIDS, bidLabel, bidOf, bridgeLabel, contractLabel, MISERE, NAMEABLE, OPEN_MISERE, type Call } from './contracts';
import { beforePlay, redeal, startPlay, startRound } from './deal';
import { partnersOf, teamOf } from './sides';
import type { S, TrickGame } from './types';

/**
 * The bidding styles: tricks (spades, Oh Hell), euchre's order up / name trumps, 500's auction and
 * contract bridge's. Each `apply…` function is one kind of move.
 */

// ---- bidding tricks (spades, Oh Hell) ----

export function applyBid(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'bid' && s.turn === seat, 'Not your turn to bid');
  const bid = Math.floor(a.amount ?? -1);
  assertRule(bid >= 0 && bid <= d.handSize, `Bid between 0 and ${d.handSize}`);
  if (g.trickBids?.hook && seat === s.dealer) {
    const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
    assertRule(others + bid !== d.handSize, `The dealer can’t bid ${bid}: total bids can’t equal ${d.handSize}`);
  }
  d.bids[seat] = bid;
  const bidText = bid === 0 && g.nilAllowed ? 'nil' : String(bid);
  log(s, `${name(s, seat)} bids ${bidText}`, seat, `Bid ${bidText}`);
  if (d.bids.every((b) => b != null)) startPlay(g, s);
  else s.turn = nextSeat(s, seat, (x) => d.bids[x] != null);
}

// ---- euchre ----

/** Euchre: trumps are made. The dealer picks up the turned card (unless their partner goes alone). */
function makeTrumps(g: TrickGame, s: S, seat: number, suit: Suit, alone: boolean, pickUp: boolean) {
  const d = s.data;
  d.trump = suit;
  d.maker = seat;
  if (alone) {
    // (with teams of three both partners sit out)
    d.outSeats = partnersOf(g, s, seat);
    d.sittingOut = d.outSeats[0] ?? null;
  }
  log(
    s,
    `${name(s, seat)} ${pickUp ? (seat === s.dealer ? 'picks it up' : 'orders it up') : `names ${SUIT_SYMBOL[suit]}`}${alone ? ' and goes alone' : ''}`,
    seat,
    `${SUIT_SYMBOL[suit]}${alone ? ' alone' : ''}`,
  );
  if (pickUp && !d.outSeats?.includes(s.dealer)) {
    moveCards(s, 'upcard', `hand:${s.dealer}`, ids(zone(s, 'upcard')));
    s.phase = 'discard';
    s.turn = s.dealer;
    return;
  }
  moveCards(s, 'upcard', 'kitty', ids(zone(s, 'upcard')));
  beforePlay(g, s);
}

/** Order up (or pick up) the turned card: `order` or `orderAlone`. */
export function applyOrder(g: TrickGame, s: S, seat: number, a: Action) {
  assertRule(s.phase === 'order' && s.turn === seat, 'Not your turn');
  makeTrumps(g, s, seat, parseCard(s.data.upcard!).suit as Suit, a.type === 'orderAlone', true);
}

/** Name another suit for trumps: `name` or `nameAlone`. */
export function applyName(g: TrickGame, s: S, seat: number, a: Action) {
  assertRule(s.phase === 'name' && s.turn === seat, 'Not your turn');
  const suit = NAMEABLE[a.amount ?? -1];
  assertRule(suit && suit !== parseCard(s.data.upcard!).suit, 'Choose a different suit from the turned-down card');
  makeTrumps(g, s, seat, suit, a.type === 'nameAlone', false);
}

// ---- 500 ----

/** Bids that may be made now: higher-ranked, with misère only once someone has bid seven. */
export const higherBids = (g: TrickGame, s: S) => {
  const cur = s.data.contract;
  const at = cur ? ALL_BIDS.indexOf(cur) : -1;
  return ALL_BIDS.filter((b, i) => i > at && (!b.misere || (g.auction?.misere && (b.misere === 'open' || cur?.tricks === 7))));
};

/** 500: the auction is over; the winner picks up the kitty and discards. */
function winAuction(g: TrickGame, s: S, seat: number) {
  const d = s.data;
  d.maker = seat;
  d.trump = d.contract!.suit === 'NT' ? null : d.contract!.suit;
  // misère is played alone: partner's cards stay face down
  if (d.contract!.misere) {
    d.outSeats = partnersOf(g, s, seat);
    d.sittingOut = d.outSeats[0] ?? null;
  }
  log(s, `${name(s, seat)} wins the bid: ${contractLabel(d.contract!)} (${d.contract!.value})`, seat, contractLabel(d.contract!));
  moveCards(s, 'deck', `hand:${seat}`, ids(zone(s, 'deck')));
  sortHand(s, seat, { trump: d.trump });
  s.phase = 'discard';
  s.turn = seat;
}

/** A 500 bid: `bid500` (a suit bid by its index), `misere` or `openMisere`. */
export function applyBid500(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'auction' && s.turn === seat, 'Not your turn to bid');
  const bid = a.type === 'misere' ? MISERE : a.type === 'openMisere' ? OPEN_MISERE : ALL_BIDS[a.amount ?? -1];
  assertRule(bid && higherBids(g, s).includes(bid), bid?.misere === 'closed' ? 'Misère can only be bid over a seven' : 'Bid higher than the current bid');
  d.contract = bid;
  d.maker = seat;
  log(s, `${name(s, seat)} bids ${contractLabel(bid)} (${bid.value})`, seat, contractLabel(bid));
  const still = s.players.map((_, i) => i).filter((i) => !d.passedOut![i]);
  if (still.length === 1) return winAuction(g, s, seat);
  s.turn = nextSeat(s, seat, (x) => d.passedOut![x]);
}

/** The bid winner (500) or the euchre dealer buries the cards they don't want. */
export function applyBury(g: TrickGame, s: S, seat: number, a: Action) {
  assertRule(s.phase === 'discard' && s.turn === seat, 'Not your turn');
  const k = g.auction ? (g.R.kitty ?? 3) : 1;
  const cards = a.cards ?? [];
  const own = ids(hand(s, seat));
  assertRule(cards.length === k && new Set(cards).size === k && cards.every((c) => own.includes(c)), `Choose ${k} card${k > 1 ? 's' : ''} to discard`);
  moveCards(s, `hand:${seat}`, 'kitty', cards);
  log(s, `${name(s, seat)} discards ${k > 1 ? `${k} cards` : 'a card'}`, seat, 'Discarded', undefined, { to: 'kitty' });
  beforePlay(g, s);
}

// ---- bridge ----

/** The last bid, who made it, and whether it has been doubled. */
export function auctionState(s: S) {
  let lastBid = -1;
  let bidder = -1;
  let dbl: 0 | 1 | 2 = 0;
  for (const c of s.data.calls ?? []) {
    if (typeof c.call === 'number') {
      lastBid = c.call;
      bidder = c.seat;
      dbl = 0;
    } else if (c.call === 'X') dbl = 1;
    else if (c.call === 'XX') dbl = 2;
  }
  return { lastBid, bidder, dbl };
}
export const canDouble = (g: TrickGame, s: S, seat: number) => {
  const a = auctionState(s);
  return a.lastBid >= 0 && a.dbl === 0 && teamOf(g, s, a.bidder) !== teamOf(g, s, seat);
};
export const canRedouble = (g: TrickGame, s: S, seat: number) => {
  const a = auctionState(s);
  return a.dbl === 1 && teamOf(g, s, a.bidder) === teamOf(g, s, seat);
};
export const callLabel = (c: Call) => (typeof c === 'number' ? bidLabel(c) : c === 'P' ? 'Pass' : c === 'X' ? 'Double' : 'Redouble');

/** After each call: four passes throws the deal in; three passes after a bid ends the auction. */
function afterCall(g: TrickGame, s: S, seat: number) {
  const d = s.data;
  const calls = d.calls!;
  if (calls.length === 4 && calls.every((c) => c.call === 'P')) {
    log(s, 'All pass — new deal');
    return startRound(g, s); // same dealer, same vulnerability
  }
  const a = auctionState(s);
  if (a.lastBid >= 0 && calls.length >= 4 && calls.slice(-3).every((c) => c.call === 'P')) {
    const { level, strain } = bidOf(a.lastBid);
    const side = teamOf(g, s, a.bidder);
    // the declarer is whoever on that side named the strain first
    const declarer = calls.find((c) => typeof c.call === 'number' && bidOf(c.call).strain === strain && teamOf(g, s, c.seat) === side)!.seat;
    d.bridge = { level, strain, dbl: a.dbl };
    d.maker = declarer;
    d.dummy = (declarer + 2) % s.players.length;
    d.trump = strain === 'NT' ? null : strain;
    log(s, `${name(s, declarer)} declares ${bridgeLabel(d.bridge)}`, declarer, bridgeLabel(d.bridge, true));
    return startPlay(g, s);
  }
  s.turn = nextSeat(s, seat);
}

/** A bridge bid (0 = 1♣ … 34 = 7NT). */
export function applyCall(g: TrickGame, s: S, seat: number, a: Action) {
  assertRule(s.phase === 'call' && s.turn === seat, 'Not your turn to bid');
  const bid = Math.floor(a.amount ?? -1);
  assertRule(bid >= 0 && bid < 35 && bid > auctionState(s).lastBid, 'Bid higher than the last bid');
  s.data.calls!.push({ seat, call: bid });
  log(s, `${name(s, seat)} bids ${bidLabel(bid)}`, seat, bidLabel(bid));
  afterCall(g, s, seat);
}

/** `double` or `redouble`. */
export function applyDouble(g: TrickGame, s: S, seat: number, a: Action) {
  const x = a.type === 'double';
  assertRule(s.phase === 'call' && s.turn === seat, 'Not your turn');
  assertRule(
    x ? canDouble(g, s, seat) : canRedouble(g, s, seat),
    x ? 'You can only double an opponent’s bid' : 'You can only redouble a double of your side’s bid',
  );
  s.data.calls!.push({ seat, call: x ? 'X' : 'XX' });
  log(s, `${name(s, seat)} ${x ? 'doubles' : 'redoubles'}`, seat, x ? 'Double' : 'Redouble');
  afterCall(g, s, seat);
}

// ---- passing, in any of the styles ----

export function applyDecline(g: TrickGame, s: S, seat: number) {
  const d = s.data;
  const who = name(s, seat);
  if (s.phase === 'call') {
    assertRule(s.turn === seat, 'Not your turn');
    d.calls!.push({ seat, call: 'P' });
    log(s, `${who} passes`, seat, 'Pass');
    return afterCall(g, s, seat);
  }
  assertRule(s.turn === seat && (s.phase === 'order' || s.phase === 'name' || s.phase === 'auction'), 'Not your turn');
  log(s, `${who} passes`, seat, 'Pass');
  if (s.phase === 'auction') {
    d.passedOut![seat] = true;
    const still = s.players.map((_, i) => i).filter((i) => !d.passedOut![i]);
    if (d.contract && still.length === 1 && still[0] === d.maker) return winAuction(g, s, d.maker!);
    if (!still.length) return redeal(g, s, 'Nobody bid — new deal');
    s.turn = nextSeat(s, seat, (x) => d.passedOut![x]);
    return;
  }
  assertRule(!(s.phase === 'name' && g.euchreBids?.stickTheDealer && seat === s.dealer), 'The dealer is stuck: name trumps');
  d.declines = (d.declines ?? 0) + 1;
  if (d.declines < s.players.length) {
    s.turn = nextSeat(s, seat);
    return;
  }
  if (s.phase === 'name') return redeal(g, s, 'Everyone passed — new deal');
  // round two: the card is turned down and any other suit may be named
  d.declines = 0;
  d.bidRound = 2;
  for (const c of zone(s, 'upcard').cards) c.up = false;
  log(s, `The ${cardName(d.upcard!)} is turned down`);
  s.phase = 'name';
  s.turn = nextSeat(s, s.dealer);
}
