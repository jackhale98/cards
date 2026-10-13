import { cardOrJokerLabel, parseCard, SUIT_NAME, SUIT_SYMBOL } from '../../cards';
import { PASS_WORDS, passTarget } from '../../lib/passing';
import { hand, ids, name, zone } from '../../state';
import type { ActionSpec } from '../../types';
import { auctionState, canDouble, canRedouble, higherBids } from './bidding';
import { botBid } from './bots';
import { ALL_BIDS, bidLabel, contractLabel, MISERE, NAMEABLE, OPEN_MISERE, SUIT_BIDS } from './contracts';
import { callable } from './deal';
import { jokerLeadSuits, legalCards, suitless } from './play';
import { controller, sourceZone } from './sides';
import type { S, TrickGame } from './types';

/** Which way this hand's pass goes, and to whom: "Left → Ann". */
export function dirLabel(s: S, seat: number) {
  const to = passTarget(seat, s.data.passDir!, s.players.length);
  return `${PASS_WORDS[s.data.passDir!]} → ${name(s, to)}`;
}

/** The moves on offer to `seat`. */
export function trickActions(g: TrickGame, s: S, seat: number): ActionSpec[] {
  const R = g.R;
  const d = s.data;
  const out: ActionSpec[] = [];
  if (s.phase === 'pass') {
    if (d.passes[seat]) out.push({ type: 'unpass', label: 'Take back', style: 'quiet' });
    else {
      const count = R.passing!.count;
      out.push({ type: 'pass', label: `Pass ${dirLabel(s, seat)}`, style: 'primary', select: { min: count, max: count, cards: ids(hand(s, seat)) } });
    }
  } else if (s.phase === 'bid' && s.turn === seat) {
    out.push({
      type: 'bid',
      label: 'Bid',
      style: 'primary',
      amount: { min: 0, max: d.handSize, step: 1, default: botBid(g, s, seat), label: g.nilAllowed ? 'tricks (0 = nil)' : 'tricks' },
    });
  } else if (s.phase === 'order' && s.turn === seat) {
    const up = cardOrJokerLabel(d.upcard!);
    out.push({ type: 'order', label: seat === s.dealer ? `Pick up ${up}` : `Order up ${up}`, style: 'primary' });
    if (g.euchreBids?.alone) out.push({ type: 'orderAlone', label: 'Go alone' });
    out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
  } else if (s.phase === 'name' && s.turn === seat) {
    const options = NAMEABLE.filter((x) => x !== parseCard(d.upcard!).suit).map((x) => ({
      value: NAMEABLE.indexOf(x),
      label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}`,
    }));
    out.push({ type: 'name', label: 'Name trumps', style: 'primary', choose: { label: 'Trumps', options } });
    if (g.euchreBids?.alone) out.push({ type: 'nameAlone', label: 'Name & go alone', choose: { label: 'Trumps — going alone', options } });
    if (!(g.euchreBids?.stickTheDealer && seat === s.dealer)) out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
  } else if (s.phase === 'auction' && s.turn === seat) {
    const open = higherBids(g, s);
    // suit bids in whole rows of five (bids already passed greyed out); misère gets its own buttons
    const first = open.find((b) => !b.misere);
    const options = first
      ? SUIT_BIDS.filter((b) => b.tricks >= first.tricks).map((b) => ({
          value: ALL_BIDS.indexOf(b),
          label: `${contractLabel(b)} · ${b.value}`,
          disabled: !open.includes(b),
        }))
      : [];
    if (first)
      out.push({
        type: 'bid500',
        label: 'Bid',
        style: 'primary',
        choose: { label: d.contract ? `Bid over ${contractLabel(d.contract)}` : 'Your bid', options },
      });
    if (open.includes(MISERE)) out.push({ type: 'misere', label: 'Misère · 250' });
    if (open.includes(OPEN_MISERE)) out.push({ type: 'openMisere', label: 'Open misère · 500' });
    out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
  } else if (s.phase === 'call' && s.turn === seat) {
    const a = auctionState(s);
    // whole levels, one per row (♣ ♦ ♥ ♠ NT), with bids already passed greyed out
    const options = Array.from({ length: 35 }, (_, i) => i)
      .filter((i) => i >= Math.floor((a.lastBid + 1) / 5) * 5)
      .map((i) => ({ value: i, label: bidLabel(i), disabled: i <= a.lastBid }));
    if (a.lastBid < 34)
      out.push({ type: 'call', label: 'Bid', style: 'primary', choose: { label: a.lastBid >= 0 ? `Bid over ${bidLabel(a.lastBid)}` : 'Your bid', options } });
    if (canDouble(g, s, seat)) out.push({ type: 'double', label: 'Double' });
    if (canRedouble(g, s, seat)) out.push({ type: 'redouble', label: 'Redouble' });
    out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
  } else if (s.phase === 'discard' && s.turn === seat) {
    const k = g.auction ? (R.kitty ?? 3) : 1;
    out.push({ type: 'bury', label: k > 1 ? `Discard ${k}` : 'Discard', style: 'primary', select: { min: k, max: k, cards: ids(hand(s, seat)) } });
  } else if (s.phase === 'play' && controller(s) === seat) {
    const fromDummy = s.turn !== seat;
    const legal = legalCards(g, s, s.turn!);
    if (legal.length)
      out.push({ type: 'play', label: fromDummy ? 'Play from dummy' : 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legal } });
    const joker = ids(zone(s, sourceZone(s, s.turn!))).find((c) => suitless(g, s, c));
    if (joker && !zone(s, 'trick').cards.length && jokerLeadSuits(s).length)
      out.push({
        type: 'leadJoker',
        label: 'Lead the joker',
        style: legal.length ? undefined : 'primary',
        choose: {
          label: 'Call a suit for the others to follow',
          options: jokerLeadSuits(s).map((x) => ({ value: NAMEABLE.indexOf(x), label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` })),
        },
      });
  } else if (s.phase === 'blind' && s.turn === seat) {
    out.push({ type: 'blindNil', label: `Bid blind nil · ${((R.scoring as { nil?: number }).nil ?? 100) * 2}`, style: 'danger' });
    out.push({ type: 'look', label: 'Look at my cards', style: 'primary' });
  } else if (s.phase === 'blindPass' && s.turn === seat) {
    out.push({
      type: 'blindGive',
      label: `Give 2 to ${name(s, (seat + 2) % s.players.length)}`,
      style: 'primary',
      select: { min: 2, max: 2, cards: ids(hand(s, seat)) },
    });
  } else if (s.phase === 'blindReturn' && s.turn === seat) {
    out.push({
      type: 'blindGive',
      label: `Give 2 back to ${name(s, (seat + 2) % s.players.length)}`,
      style: 'primary',
      select: { min: 2, max: 2, cards: ids(hand(s, seat)) },
    });
  } else if (s.phase === 'defend' && s.turn === seat) {
    out.push({ type: 'defendAlone', label: 'Defend alone' });
    out.push({ type: 'stayIn', label: 'Play with partner', style: 'primary' });
  } else if (s.phase === 'callPartner' && s.turn === seat) {
    out.push({
      type: 'callCard',
      label: 'Call a partner',
      style: 'primary',
      choose: {
        label: 'Whoever holds this card plays with you (secretly, until it’s played)',
        options: callable(g, s).map((c) => ({ value: g.deckCards.indexOf(c), label: cardOrJokerLabel(c) })),
      },
    });
    out.push({ type: 'callAlone', label: 'Play alone' });
  } else if (s.phase === 'joker' && s.turn === seat) {
    const options = NAMEABLE.map((x) => ({ value: NAMEABLE.indexOf(x), label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` }));
    // in misère an un-nominated joker would make the bid fail, so a suit must be chosen
    if (!d.contract?.misere) options.push({ value: 4, label: 'No suit (wins any trick; play it only when void)' });
    out.push({ type: 'nominate', label: 'Joker’s suit', style: 'primary', choose: { label: 'The joker counts as the top card of', options } });
  } else if (s.phase === 'moon' && s.turn === seat) {
    out.push({ type: 'moonSub', label: `Take ${g.totalPoints} off my score`, style: 'primary' });
    out.push({ type: 'moonAdd', label: `Give everyone else ${g.totalPoints}` });
  } else if (s.phase === 'roundOver') {
    out.push({ type: 'next', label: 'Next hand', style: 'primary' });
  } else if (s.phase === 'gameOver') {
    out.push({ type: 'rematch', label: 'New game', style: 'primary' });
  }
  return out;
}
