import { cardName, cardOrJokerLabel, parseCard, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../../cards';
import { deal, hand, ids, log, moveTop, name, nextSeat, resetDeck, sortHand, zone } from '../../state';
import { assertRule, type Action } from '../../types';
import { NAMEABLE, SAME_COLOUR } from './contracts';
import { openerOf, suitOf } from './play';
import { active, nextActive, partnersOf, teamOf, teamsFor } from './sides';
import { rubberBridge, sequence, type S, type TrickGame } from './types';

/** A hand from the deal to the first lead: dealing, turning up trumps, and who bids and leads. */

function sizeForRound(g: TrickGame, s: S, round: number): number {
  const R = g.R;
  const n = s.players.length;
  const all = Math.floor((g.deckSize - (R.trump === 'turnUp' ? 1 : 0) - (R.kitty ?? 0)) / n);
  if (!R.handSizes || R.handSizes === 'all') return Math.floor((g.deckSize - (R.kitty ?? 0)) / n);
  const seq = sequence(g, s);
  return Math.min(all, seq[round % seq.length]);
}

export function startRound(g: TrickGame, s: S) {
  const R = g.R;
  const d = s.data;
  const n = s.players.length;
  resetDeck(s, g.config);
  d.handSize = sizeForRound(g, s, d.round);
  deal(s, [{ to: 'hand', count: d.handSize }]);
  d.trump = R.trump && R.trump !== 'none' && R.trump !== 'turnUp' && R.trump !== 'chosen' && R.trump !== 'lastCard' ? R.trump : null;
  d.maker = null;
  d.sittingOut = null;
  d.outSeats = [];
  d.called = undefined;
  d.partner = null;
  d.partnerShown = false;
  d.callAsked = false;
  d.contract = null;
  d.exposed = null;
  d.passedOut = s.players.map(() => false);
  d.declines = 0;
  d.bidRound = 1;
  d.upcard = null;
  d.moon = null;
  d.defAlone = null;
  d.defendAsked = false;
  d.jokerSuit = null;
  d.jokerAsked = false;
  d.jokerLed = null;
  d.ledSuits = [];
  d.voids = s.players.map(() => []);
  d.blind = s.players.map(() => false);
  d.blindToAsk = [];
  if (g.bridgeBids) {
    d.calls = [];
    d.bridge = null;
    d.dummy = null;
    d.dummyUp = false;
    d.below ??= teamsFor(g, n).map(() => 0);
    d.games ??= teamsFor(g, n).map(() => 0);
    const k = d.round % 4;
    d.vul = rubberBridge(s)
      ? // rubber: a side that has won a game is vulnerable
        d.games.map((x) => x > 0)
      : // Chicago as pagat plays it now: nobody, then the side not dealing on deals 2 and 3 (as on
        // duplicate boards 2 and 3), then everybody. The original game had the dealer's side instead.
        teamsFor(g, n).map((t) => k === 3 || ((k === 1 || k === 2) && !t.includes(s.dealer)));
  }
  if (g.euchreBids && zone(s, 'deck').cards.length) {
    moveTop(s, 'deck', 'upcard', 1, { up: true });
    d.upcard = zone(s, 'upcard').cards[0].id;
  }
  d.trumpCard = null;
  d.honours = null;
  if (R.trump === 'lastCard') {
    // the last card dealt (the dealer's) is turned up for trumps; it stays in the dealer's hand
    const last = hand(s, s.dealer).cards.at(-1)!;
    last.up = true;
    d.trumpCard = last.id;
    d.trump = parseCard(last.id).suit as Suit;
    log(s, `${name(s, s.dealer)} turns up the ${cardName(last.id)}: ${SUIT_NAME[d.trump].toLowerCase()} are trumps`, s.dealer, SUIT_SYMBOL[d.trump]);
    // honours: who was dealt the top four trumps
    const top = [14, 13, 12, 11];
    teamsFor(g, n).forEach((t, ti) => {
      const count = t.flatMap((i) => ids(hand(s, i))).filter((c) => parseCard(c).suit === d.trump && top.includes(parseCard(c).rank)).length;
      if (count >= 3) d.honours = { team: ti, count };
    });
  }
  if (R.trump === 'turnUp' && zone(s, 'deck').cards.length) {
    moveTop(s, 'deck', 'trump', 1, { up: true });
    d.trump = parseCard(zone(s, 'trump').cards[0].id).suit as Suit;
    log(s, `Trumps are ${SUIT_SYMBOL[d.trump]}`);
  }
  s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
  const cycle = R.passing?.cycle.filter((p) => p !== 'across' || n === 4) ?? [];
  d.passDir = cycle.length ? cycle[d.round % cycle.length] : null;
  d.passes = s.players.map(() => null);
  d.received = s.players.map(() => []);
  d.bids = s.players.map(() => null);
  d.tricks = s.players.map(() => 0);
  d.points = s.players.map(() => 0);
  d.broken = false;
  d.trickNo = 0;
  d.result = null;
  if (g.nilAllowed && s.options.blindNil) {
    // blind nil: players whose side is 100 or more behind decide before looking at their cards
    const best = Math.max(...d.scores);
    // (the blind bidder swaps cards with their partner: only with partners)
    const behind = (i: number) => d.scores[teamOf(g, s, i)] <= best - 100 && partnersOf(g, s, i).length === 1;
    d.blindToAsk = Array.from({ length: n }, (_, k) => (s.dealer + 1 + k) % n).filter(behind);
    for (const i of d.blindToAsk) for (const c of hand(s, i).cards) c.blind = true;
  }
  if (d.passDir && d.passDir !== 'hold') {
    s.phase = 'pass';
    s.turn = null;
  } else startBidding(g, s);
}

export function startBidding(g: TrickGame, s: S) {
  if (!g.R.bidding) return startPlay(g, s);
  if (s.data.blindToAsk?.length) {
    s.phase = 'blind';
    s.turn = s.data.blindToAsk[0];
    return;
  }
  s.phase = g.euchreBids ? 'order' : g.auction ? 'auction' : g.bridgeBids ? 'call' : 'bid';
  // in bridge the dealer calls first
  s.turn = g.bridgeBids ? s.dealer : nextSeat(s, s.dealer);
  // a blind nil bid is already in
  if (s.phase === 'bid' && s.data.bids[s.turn] != null) s.turn = nextSeat(s, s.turn, (x) => s.data.bids[x] != null);
}

/** Look at your cards (passing on blind nil); then the next player behind decides, or bidding starts. */
export function lookAtCards(g: TrickGame, s: S, seat: number) {
  const d = s.data;
  for (const c of hand(s, seat).cards) delete c.blind;
  d.blindToAsk = d.blindToAsk!.filter((x) => x !== seat);
  if (d.blindToAsk.length) s.turn = d.blindToAsk[0];
  else startBidding(g, s);
}

export function startPlay(g: TrickGame, s: S) {
  const d = s.data;
  s.phase = 'play';
  s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
  const opener = openerOf(s);
  const twoClubs = s.players.findIndex((_, i) => ids(hand(s, i)).includes(opener));
  if (g.R.lead === 'twoOfClubs' && twoClubs >= 0) s.turn = twoClubs;
  else if (g.R.lead === 'maker' && d.maker != null) s.turn = d.maker;
  else if (g.bridgeBids && d.maker != null)
    s.turn = nextSeat(s, d.maker); // left of the declarer leads
  else if (g.euchreBids && d.defAlone != null)
    s.turn = d.defAlone; // a lone defender leads
  else if (g.euchreBids && d.sittingOut != null)
    s.turn = nextActive(g, s, d.maker!); // left of a lone maker
  else s.turn = active(g, s, nextSeat(s, s.dealer)) ? nextSeat(s, s.dealer) : nextActive(g, s, nextSeat(s, s.dealer));
}

/**
 * Cards the contractor may call: not the joker or a bower, nor one they hold or put in the kitty
 * (those would make them alone anyway). Trumps first, high to low.
 */
export function callable(g: TrickGame, s: S): string[] {
  const d = s.data;
  const mine = new Set([...ids(hand(s, d.maker!)), ...ids(zone(s, 'kitty'))]);
  const bowers = d.trump ? [`J${d.trump}`, `J${SAME_COLOUR[d.trump]}`] : [];
  const order = (c: string) => (suitOf(g, s, c) === d.trump ? 0 : 1) * 100 - parseCard(c).rank;
  return g.deckCards.filter((c) => parseCard(c).suit !== 'X' && !bowers.includes(c) && !mine.has(c)).sort((a, b) => order(a) - order(b));
}

/**
 * Last questions before the first lead: in five-handed 500 the contractor calls a partner; in
 * euchre a defender may go alone (when that option is on); in 500 a contractor holding the joker
 * in no trumps or misère may give it a suit.
 */
export function beforePlay(g: TrickGame, s: S) {
  const d = s.data;
  // five-handed 500: call a partner (misère is always played alone)
  if (g.R.callPartner && d.contract && !d.contract.misere && !d.callAsked) {
    d.callAsked = true;
    s.phase = 'callPartner';
    s.turn = d.maker!;
    return;
  }
  if (g.euchreBids?.alone && s.options.defendAlone && !d.defendAsked) {
    d.defendAsked = true;
    const defenders = s.players.map((_, k) => (s.dealer + 1 + k) % s.players.length).filter((i) => teamOf(g, s, i) !== teamOf(g, s, d.maker!));
    d.defToAsk = defenders;
    s.phase = 'defend';
    s.turn = defenders[0];
    return;
  }
  if (g.R.joker && !d.trump && !d.jokerAsked && d.maker != null && ids(hand(s, d.maker)).some((c) => parseCard(c).suit === 'X')) {
    d.jokerAsked = true;
    s.phase = 'joker';
    s.turn = d.maker;
    return;
  }
  startPlay(g, s);
}

/** Five-handed 500: `callCard` (a card by its index in the pack) or `callAlone`. */
export function applyCallPartner(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  const who = name(s, seat);
  assertRule(s.phase === 'callPartner' && s.turn === seat, 'Not your turn');
  if (a.type === 'callCard') {
    const card = g.deckCards[a.amount ?? -1];
    assertRule(card && callable(g, s).includes(card), 'Call another card');
    d.called = card;
    d.partner = s.players.map((p) => p.seat).find((i) => ids(hand(s, i)).includes(card)) ?? null;
    log(s, `${who} calls the ${cardName(card)}: whoever holds it is their partner`, seat, `Calls ${cardOrJokerLabel(card)}`);
  } else {
    d.called = null;
    d.partner = null;
    log(s, `${who} plays alone`, seat, 'Alone');
  }
  beforePlay(g, s);
}

/** 500: the contractor gives their joker a suit (4 = none). */
export function applyNominate(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  const who = name(s, seat);
  assertRule(s.phase === 'joker' && s.turn === seat, 'Not your turn');
  const suit = a.amount === 4 && !d.contract?.misere ? null : NAMEABLE[a.amount ?? -1];
  assertRule(suit !== undefined, 'Choose a suit');
  d.jokerSuit = suit;
  log(
    s,
    suit ? `${who}’s joker is the top ${SUIT_NAME[suit].toLowerCase().replace(/s$/, '')}` : `${who}’s joker has no suit`,
    seat,
    suit ? `Joker ${SUIT_SYMBOL[suit]}` : 'Joker',
  );
  s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
  startPlay(g, s);
}

/** Euchre: `defendAlone` or `stayIn`. */
export function applyDefend(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'defend' && s.turn === seat, 'Not your turn');
  d.defToAsk = (d.defToAsk ?? []).filter((x) => x !== seat);
  if (a.type === 'defendAlone') {
    d.defAlone = seat;
    d.defToAsk = [];
    log(s, `${name(s, seat)} defends alone`, seat, 'Alone');
  }
  if (d.defToAsk.length) s.turn = d.defToAsk[0];
  else beforePlay(g, s);
}

/** Nobody wanted trumps / nobody bid: throw the hand in and deal again. */
export function redeal(g: TrickGame, s: S, why: string) {
  log(s, why);
  s.dealer = nextSeat(s, s.dealer);
  startRound(g, s);
}
