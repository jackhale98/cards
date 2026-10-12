import { PASS_WORDS, passTarget } from '../../lib/passing';
import { hand, ids, log, moveCards, name, sortHand } from '../../state';
import { assertRule, type Action } from '../../types';
import { lookAtCards, startBidding } from './deal';
import { partnersOf } from './sides';
import type { S, TrickGame } from './types';

/** Cards changing hands before the bidding: Hearts' pass, and the spades blind nil swap. */

/** Choose cards to pass; once everyone has, they all move at once. */
export function applyPass(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'pass' && !d.passes[seat], 'Not passing now');
  const cards = a.cards ?? [];
  const own = ids(hand(s, seat));
  const count = g.R.passing!.count;
  assertRule(cards.length === count && new Set(cards).size === count && cards.every((c) => own.includes(c)), `Choose ${count} cards to pass`);
  d.passes[seat] = cards;
  log(s, `${name(s, seat)} passes ${count} cards`, seat, 'Passed');
  if (d.passes.every(Boolean)) {
    d.passes.forEach((cards, from) => {
      const to = passTarget(from, d.passDir!, s.players.length);
      moveCards(s, `hand:${from}`, `hand:${to}`, cards!);
      d.received[to] = cards!;
    });
    s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
    log(s, `Cards passed ${PASS_WORDS[d.passDir!]}`);
    startBidding(g, s);
  }
}

/** Blind nil before looking (`blindNil`), or `look` at your cards. */
export function applyBlind(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'blind' && s.turn === seat, 'Not your turn');
  if (a.type === 'look') return lookAtCards(g, s, seat);
  const partner = partnersOf(g, s, seat)[0];
  d.blind![seat] = true;
  d.bids[seat] = 0;
  log(s, `${name(s, seat)} bids blind nil!`, seat, 'Blind nil');
  // the partner looks at their cards and passes two across; then the blind bidder passes two back
  for (const c of hand(s, partner).cards) delete c.blind;
  d.blindToAsk = d.blindToAsk!.filter((x) => x !== seat && x !== partner);
  s.phase = 'blindPass';
  s.turn = partner;
}

/** Blind nil: two cards across to the bidder, then two back. */
export function applyBlindGive(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule((s.phase === 'blindPass' || s.phase === 'blindReturn') && s.turn === seat, 'Not your turn');
  const cards = a.cards ?? [];
  const own = ids(hand(s, seat));
  assertRule(cards.length === 2 && new Set(cards).size === 2 && cards.every((c) => own.includes(c)), 'Choose 2 cards');
  const to = (seat + 2) % s.players.length;
  moveCards(s, `hand:${seat}`, `hand:${to}`, cards);
  d.received[to] = cards;
  log(s, `${name(s, seat)} passes 2 cards to ${name(s, to)}`, seat, 'Passed 2');
  if (s.phase === 'blindPass') {
    // the blind bidder now picks up their cards
    for (const c of hand(s, to).cards) delete c.blind;
    sortHand(s, to, { trump: d.trump });
    s.phase = 'blindReturn';
    s.turn = to;
  } else {
    sortHand(s, to, { trump: d.trump });
    startBidding(g, s);
  }
}
