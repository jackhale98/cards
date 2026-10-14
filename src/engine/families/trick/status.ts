import { cardOrJokerLabel, SUIT_SYMBOL } from '../../cards';
import { name, zone } from '../../state';
import type { GameStatus } from '../../types';
import { dirLabel } from './actions';
import { auctionState, callLabel } from './bidding';
import { bidOf, bridgeLabel, contractLabel } from './contracts';
import { openerOf, suitless } from './play';
import { active, controller, partnersOf, teamName, teamOf, teamsFor } from './sides';
import type { S, TrickGame } from './types';

/** What each player sees of the game: the headline, seat badges, scoreboard and banner. */
export function trickStatus(g: TrickGame, s: S, viewer: number): GameStatus {
  const R = g.R;
  const d = s.data;
  const teams = teamsFor(g, s.players.length);
  const bidding = !!g.trickBids;
  const auction = g.auction;
  const totalPoints = g.totalPoints;
  let headline = '';
  if (s.phase === 'pass') {
    headline = d.passes[viewer] ? 'Waiting for everyone to pass…' : viewer >= 0 ? `Pass ${R.passing!.count} cards ${dirLabel(s, viewer)}` : 'Passing cards';
  } else if (s.phase === 'order') {
    const up = cardOrJokerLabel(d.upcard!);
    headline =
      s.turn === viewer
        ? viewer === s.dealer
          ? `Pick up the ${up}, or pass?`
          : `Order up the ${up}, or pass?`
        : `${name(s, s.turn!)} is deciding on the ${up}`;
  } else if (s.phase === 'name') {
    const stuck = g.euchreBids?.stickTheDealer && s.turn === s.dealer;
    headline = s.turn === viewer ? (stuck ? "You're stuck — name trumps" : 'Name a trump suit, or pass') : `${name(s, s.turn!)} to name trumps`;
  } else if (s.phase === 'auction') {
    const cur = d.contract ? `${contractLabel(d.contract)} (${d.contract.value}) by ${name(s, d.maker!)}` : 'no bids yet';
    headline = s.turn === viewer ? `Your bid · ${cur}` : `${name(s, s.turn!)} to bid · ${cur}`;
  } else if (s.phase === 'call') {
    const a = auctionState(s);
    const cur = a.lastBid >= 0 ? `${bridgeLabel({ ...bidOf(a.lastBid), dbl: a.dbl }, true)} by ${name(s, a.bidder)}` : 'no bids yet';
    const vul = d.vul ?? [];
    const vulText = vul.every(Boolean) ? 'all vulnerable' : !vul.some(Boolean) ? 'none vulnerable' : `${teamName(g, s, vul.indexOf(true))} vulnerable`;
    headline = `${s.turn === viewer ? 'Your call' : `${name(s, s.turn!)} to call`} · ${cur} · ${vulText}`;
  } else if (s.phase === 'discard') {
    const k = auction ? (R.kitty ?? 3) : 1;
    headline = s.turn === viewer ? `Discard ${k > 1 ? `${k} cards` : 'a card'}` : `${name(s, s.turn!)} is discarding`;
  } else if (s.phase === 'bid') {
    headline = s.turn === viewer ? `Your bid · ${d.handSize} tricks this hand` : `${name(s, s.turn!)} is bidding`;
  } else if (s.phase === 'play' || s.phase === 'trickEnd') {
    const leading = zone(s, 'trick').cards.length === 0;
    const ctl = controller(s);
    if (ctl === viewer && s.turn !== viewer) headline = leading ? 'Lead from dummy' : 'Play from dummy';
    else if (s.turn === viewer)
      headline = leading ? (d.trickNo === 0 && R.lead === 'twoOfClubs' ? `Lead the ${cardOrJokerLabel(openerOf(s))}` : 'Your lead') : 'Your turn';
    else if (ctl != null && ctl !== s.turn) headline = `${name(s, ctl)} to play from dummy`;
    else if (s.turn != null) headline = `${name(s, s.turn)} to play`;
  } else if (s.phase === 'blind') {
    headline = s.turn === viewer ? 'Bid blind nil before looking at your cards, or look?' : `${name(s, s.turn!)} is deciding on blind nil`;
  } else if (s.phase === 'blindPass' || s.phase === 'blindReturn') {
    headline = s.turn === viewer ? `Pass 2 cards to ${name(s, partnersOf(g, s, viewer)[0])}` : `${name(s, s.turn!)} is passing 2 cards`;
  } else if (s.phase === 'defend') {
    headline = s.turn === viewer ? 'Defend alone, or play with your partner?' : `${name(s, s.turn!)} may defend alone`;
  } else if (s.phase === 'callPartner') {
    headline = s.turn === viewer ? 'Call a card: whoever holds it is your partner — or play alone' : `${name(s, s.turn!)} is calling a partner`;
  } else if (s.phase === 'joker') {
    headline = s.turn === viewer ? 'Give the joker a suit' : `${name(s, s.turn!)} is choosing the joker’s suit`;
  } else if (s.phase === 'moon') {
    headline = s.turn === viewer ? `You shot the moon! Take ${totalPoints} off, or give everyone ${totalPoints}?` : `🌙 ${name(s, s.turn!)} shot the moon`;
  } else if (s.phase === 'roundOver') headline = 'Hand complete';
  else if (s.phase === 'gameOver') headline = 'Game over';
  // (a bridge contract names its trump suit, and the declarer's badge shows it)
  if (d.trump && s.phase !== 'gameOver' && !d.bridge) headline += ` · trumps ${SUIT_SYMBOL[d.trump]}`;
  // five-handed 500: the called card (its holder only once it's played, or to themselves)
  if (d.called && (s.phase === 'play' || s.phase === 'trickEnd'))
    headline += d.partnerShown
      ? ` · ${name(s, d.partner!)} is the partner`
      : viewer === d.partner
        ? ` · you hold the ${cardOrJokerLabel(d.called)}: you're the partner`
        : ` · partner card ${cardOrJokerLabel(d.called)}`;
  else if (auction && d.contract && d.maker != null && s.phase === 'play') {
    headline += d.contract.misere ? ` · ${contractLabel(d.contract)}` : ' · no trumps';
    if (d.jokerSuit) headline += ` · joker ${SUIT_SYMBOL[d.jokerSuit]}`;
    const lead = zone(s, 'trick').cards[0];
    if (lead && suitless(g, s, lead.id) && d.jokerLed) headline += ` · ${SUIT_SYMBOL[d.jokerLed]} called`;
  }

  const seatBadge = (i: number) => {
    if (s.phase === 'pass' && d.passes[i]) return 'Passed ✓';
    if (g.bridgeBids) {
      const last = [...(d.calls ?? [])].reverse().find((c) => c.seat === i);
      const playing = s.phase === 'play' || s.phase === 'trickEnd';
      const side = teamOf(g, s, i);
      if (playing && d.bridge) {
        // keep it short: the side's tricks once (on the declarer and the defenders), scores live in the scoreboard
        const won = teamsFor(g, s.players.length)[side].reduce((n, x) => n + d.tricks[x], 0);
        const tricks = `${won} trick${won === 1 ? '' : 's'}`;
        return i === d.maker ? `Declarer ${bridgeLabel(d.bridge, true)} · ${tricks}` : i === d.dummy ? 'Dummy' : tricks;
      }
      const call = s.phase === 'call' && last ? callLabel(last.call) : '';
      return [call, `${d.scores[side]} pts`, d.vul?.[side] && s.phase === 'call' ? 'vul' : ''].filter(Boolean).join(' · ');
    }
    if (g.euchreBids || auction) {
      const role = !active(g, s, i)
        ? 'Sitting out'
        : d.defAlone === i
          ? 'Defending alone'
          : d.partnerShown && d.partner === i
            ? 'Partner'
            : d.maker === i && (s.phase === 'play' || s.phase === 'trickEnd' || s.phase === 'discard')
              ? auction
                ? contractLabel(d.contract!)
                : d.sittingOut != null
                  ? 'Alone'
                  : 'Maker'
              : auction && d.passedOut?.[i] && s.phase === 'auction'
                ? 'Passed'
                : '';
      return [role, s.phase === 'play' || s.phase === 'trickEnd' ? `${d.tricks[i]} tricks` : '', `${d.scores[teamOf(g, s, i)]} pts`]
        .filter(Boolean)
        .join(' · ');
    }
    const parts: string[] = [];
    if (bidding) parts.push(d.bids[i] == null ? '' : `${d.tricks[i]}/${d.bids[i] === 0 && g.nilAllowed ? 'nil' : d.bids[i]}`);
    else if (R.scoring.type === 'penalty') parts.push(d.points[i] ? `+${d.points[i]}` : '');
    else parts.push(`${d.tricks[i]} tricks`);
    parts.push(`${d.scores[teamOf(g, s, i)]} pts`);
    return parts.filter(Boolean).join(' · ');
  };

  return {
    headline,
    actor: s.phase === 'play' ? controller(s) : undefined,
    seats: s.players.map((_, i) => ({ badge: seatBadge(i), tag: i === s.dealer ? 'D' : undefined })),
    scoreboard: {
      columns: [bidding ? 'Won / bid' : R.scoring.type === 'penalty' ? 'This hand' : 'Tricks', 'Total'],
      rows: teams.map((t, ti) => ({
        name: teamName(g, s, ti),
        values: [
          bidding
            ? t.map((i) => `${d.tricks[i]}/${d.bids[i] ?? '–'}`).join(' ')
            : R.scoring.type === 'penalty'
              ? t.reduce((n, i) => n + d.points[i], 0)
              : t.reduce((n, i) => n + d.tricks[i], 0),
          d.scores[ti],
        ],
        highlight: !!s.winner && t.some((i) => s.winner!.includes(i)),
      })),
    },
    banner:
      s.phase === 'gameOver'
        ? {
            title: `${[...new Set(s.winner!.map((w) => teamOf(g, s, w)))].map((ti) => teamName(g, s, ti)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`,
            lines: d.result?.lines ?? [],
          }
        : s.phase === 'roundOver'
          ? { title: 'Hand complete', lines: d.result?.lines ?? [] }
          : undefined,
  };
}
