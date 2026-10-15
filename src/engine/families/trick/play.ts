import { cardLabel, cardName, parseCard, SUIT_SYMBOL, type Suit } from '../../cards';
import { followSuit, trickWinner } from '../../lib/trickTaking';
import { hand, ids, log, moveCards, name, sortHand, zone } from '../../state';
import { assertRule, type Action } from '../../types';
import { NAMEABLE, SAME_COLOUR } from './contracts';
import { endRound } from './scoring';
import { pitchTrick, pitchTrumps } from './pitch';
import { controller, nextActive, playersThisHand, sourceZone } from './sides';
import { pointsOf, type S, type TrickGame } from './types';

/** The play of the cards: what each card counts as, what may be played, and who wins the trick. */

/** The suit a card belongs to this hand: the left bower is a trump, a joker is trump (or its own suit in no trumps). */
export function suitFor(g: TrickGame, id: string, trump: Suit | null): string {
  const c = parseCard(id);
  if (c.suit === 'X') return trump ?? 'X';
  if (g.R.bowers && trump && c.rank === 11 && c.suit === SAME_COLOUR[trump]) return trump;
  return c.suit;
}

export function rankFor(g: TrickGame, id: string, trump: Suit | null): number {
  const c = parseCard(id);
  if (c.suit === 'X') return 30;
  if (g.R.bowers && trump && c.rank === 11) {
    if (c.suit === trump) return 25; // right bower
    if (c.suit === SAME_COLOUR[trump]) return 24; // left bower
  }
  return c.rank;
}

export const suitOf = (g: TrickGame, s: S, id: string) =>
  !s.data.trump && s.data.jokerSuit && parseCard(id).suit === 'X' ? s.data.jokerSuit : suitFor(g, id, s.data.trump);
export const rankOf = (g: TrickGame, s: S, id: string) => rankFor(g, id, s.data.trump);
/** A joker with no suit (no trumps, not nominated): it wins any trick and is led by calling a suit. */
export const suitless = (g: TrickGame, s: S, id: string) => parseCard(id).suit === 'X' && suitOf(g, s, id) === 'X';
/** The suit everyone must follow: a led suitless joker calls one. */
export const ledSuit = (g: TrickGame, s: S) => {
  const first = zone(s, 'trick').cards[0];
  return first && suitless(g, s, first.id) ? (s.data.jokerLed ?? 'X') : first ? suitOf(g, s, first.id) : null;
};
/** 500: a suitless joker may be led (calling a suit not yet led) until all four suits have been led, and always to the last trick. */
export const jokerLeadSuits = (s: S): Suit[] => {
  const d = s.data;
  const last = d.trickNo === d.handSize - 1;
  const open = NAMEABLE.filter((x) => !d.ledSuits?.includes(x));
  return open.length ? open : last ? NAMEABLE : [];
};
export const isMisere = (s: S) => !!s.data.contract?.misere && s.data.maker != null;

/**
 * The card that leads the first trick with `lead: twoOfClubs`: the lowest club dealt (the 3♣ when
 * the 2♣ is out of the deck, or is the card left over in three-handed spades).
 */
export const openerOf = (s: S) =>
  s.players
    .flatMap((_, i) => ids(hand(s, i)))
    .filter((c) => parseCard(c).suit === 'C')
    .sort((a, b) => parseCard(a).rank - parseCard(b).rank)[0];

export function legalCards(g: TrickGame, s: S, seat: number): string[] {
  const R = g.R;
  let cards = ids(zone(s, sourceZone(s, seat)));
  const trick = zone(s, 'trick').cards;
  const d = s.data;
  if (trick.length === 0) {
    if (d.trickNo === 0 && R.lead === 'twoOfClubs' && cards.includes(openerOf(s))) return [openerOf(s)];
    // a suitless joker is led with its own action, which calls a suit
    cards = cards.filter((c) => !suitless(g, s, c));
    if (R.breaks && !d.broken) {
      const safe = cards.filter((c) => parseCard(c).suit !== R.breaks);
      if (safe.length) return safe;
    }
    return cards;
  }
  const led = ledSuit(g, s)!;
  let legal = followSuit(cards, led as Suit, (c) => suitOf(g, s, c) as Suit);
  // Pitch: follow suit or trump (a trump may always be played)
  if (R.trumpAnytime && d.trump && led !== d.trump && legal.length < cards.length)
    legal = cards.filter((c) => legal.includes(c) || suitOf(g, s, c) === d.trump);
  // misère: a player who can't follow suit must play a suitless joker
  const joker = cards.find((c) => suitless(g, s, c));
  if (isMisere(s) && joker && !cards.some((c) => suitOf(g, s, c) === led)) return [joker];
  if (d.trickNo === 0 && R.noPointsFirstTrick) {
    const clean = legal.filter((c) => !pointsOf(R, c));
    if (clean.length) return clean;
  }
  return legal;
}

export function currentWinner(g: TrickGame, s: S) {
  const trick = zone(s, 'trick').cards;
  if (!trick.length) return null;
  // the joker is the top trump; with no trumps and no suit it beats everything
  const joker = trick.find((c) => parseCard(c.id).suit === 'X');
  if (joker && (s.data.trump || suitless(g, s, joker.id))) return joker;
  // a led suitless joker has been handled above; otherwise the led card's suit is the one to beat
  return trick[
    trickWinner(trick, { trump: s.data.trump, suitOf: (c) => suitOf(g, s, c), rankOf: (c) => rankOf(g, s, c), laterWinsTies: g.R.duplicates === 'later' })
  ];
}

/** Play a card (the declarer plays the dummy's cards on the dummy's turn). */
export function playCard(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  const R = g.R;
  assertRule(s.phase === 'play' && controller(s) === seat, 'Not your turn');
  const turn = s.turn!;
  const card = a.cards?.[0];
  assertRule(card && legalCards(g, s, turn).includes(card), 'You can’t play that card');
  if (!zone(s, 'trick').cards.length) d.ledSuits = [...(d.ledSuits ?? []), suitOf(g, s, card)];
  else {
    // not following suit shows the player is out of it
    const led = ledSuit(g, s);
    const voids = (d.voids ??= s.players.map(() => []));
    if (led && led !== 'X' && suitOf(g, s, card) !== led && !voids[turn].includes(led)) voids[turn] = [...voids[turn], led];
  }
  moveCards(s, sourceZone(s, turn), 'trick', [card], { by: turn, up: true });
  // Whist: the dealer takes the turned-up trump back into hand on playing to the first trick
  if (d.trumpCard && turn === s.dealer) {
    const shown = hand(s, s.dealer).cards.find((c) => c.id === d.trumpCard);
    if (shown) shown.up = false;
    d.trumpCard = null;
  }
  d.received[turn] = [];
  log(s, `${name(s, seat)} plays the ${cardName(card)}${turn !== seat ? ' from dummy' : ''}`, seat, cardLabel(card));
  // Pitch: the first card led names trumps
  if (R.trump === 'pitched' && !d.trump) pitchTrumps(s, card);
  // the called card shows who the contractor's partner is
  if (d.called && card === d.called) {
    d.partnerShown = true;
    log(s, `${name(s, turn)} is ${name(s, d.maker!)}’s partner`, turn, 'Partner!');
  }
  if (g.bridgeBids && !d.dummyUp) {
    // after the opening lead the dummy's hand goes face up on the table, grouped by suit
    const dummy = d.dummy!;
    sortHand(s, dummy, { trump: d.trump });
    moveCards(s, `hand:${dummy}`, 'dummy', ids(hand(s, dummy)), { up: true });
    for (const c of zone(s, 'dummy').cards) c.group = 'SHDC'.indexOf(parseCard(c.id).suit);
    d.dummyUp = true;
    log(s, `${name(s, dummy)} lays down the dummy`, dummy, 'Dummy');
  }
  if (R.breaks && parseCard(card).suit === R.breaks && !d.broken) {
    d.broken = true;
    log(s, `${SUIT_SYMBOL[R.breaks]} broken`);
  }
  if (zone(s, 'trick').cards.length === playersThisHand(g, s)) {
    s.phase = 'trickEnd';
    s.turn = null;
  } else s.turn = nextActive(g, s, turn);
}

/** 500: lead a suitless joker, calling the suit the others must follow. */
export function leadJoker(g: TrickGame, s: S, seat: number, a: Action) {
  const d = s.data;
  assertRule(s.phase === 'play' && controller(s) === seat && !zone(s, 'trick').cards.length, 'Not your lead');
  const turn = s.turn!;
  const joker = ids(zone(s, sourceZone(s, turn))).find((c) => suitless(g, s, c));
  const suit = NAMEABLE[a.amount ?? -1];
  assertRule(joker && suit && jokerLeadSuits(s).includes(suit), 'Call a suit that hasn’t been led yet');
  d.jokerLed = suit;
  d.ledSuits = [...(d.ledSuits ?? []), suit];
  moveCards(s, sourceZone(s, turn), 'trick', [joker], { by: turn, up: true });
  log(s, `${name(s, seat)} leads the joker and calls ${SUIT_SYMBOL[suit]}`, seat, `Joker → ${SUIT_SYMBOL[suit]}`);
  s.turn = nextActive(g, s, turn);
}

/** Everyone has played: the trick goes to its winner, and the hand may be over. */
export function collectTrick(g: TrickGame, s: S) {
  const d = s.data;
  const trick = zone(s, 'trick');
  const winner = currentWinner(g, s)!.by!;
  if (g.pitchBids) pitchTrick(s, winner);
  const cards = ids(trick);
  const pts = cards.reduce((n, c) => n + pointsOf(g.R, c), 0);
  d.points[winner] += pts;
  d.tricks[winner]++;
  moveCards(s, 'trick', `taken:${winner}`, cards);
  log(s, `${name(s, winner)} wins the trick${pts ? ` (+${pts})` : ''}`, winner, pts ? `Won trick +${pts}` : 'Won trick');
  d.trickNo++;
  d.jokerLed = null;
  if (d.trickNo === d.handSize) return endRound(g, s);
  if (isMisere(s) && winner === d.maker) {
    log(s, `${name(s, winner)} has taken a trick — the misère fails`);
    return endRound(g, s);
  }
  if (d.contract?.misere === 'open' && d.trickNo === 1 && d.exposed == null) {
    // open misère: after the first trick the contractor's hand goes face up
    const seat = d.maker!;
    moveCards(s, `hand:${seat}`, 'dummy', ids(hand(s, seat)), { up: true });
    for (const c of zone(s, 'dummy').cards) c.group = 'SHDCX'.indexOf(parseCard(c.id).suit);
    d.exposed = seat;
    log(s, `${name(s, seat)} lays their hand face up`, seat, 'Open hand');
  }
  s.phase = 'play';
  s.turn = winner;
}
