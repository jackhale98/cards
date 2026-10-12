import { parseCard, type Suit } from '../../cards';
import { passTarget } from '../../lib/passing';
import { dealUnseen, edge, fork, playOut, type SearchGame } from '../../bots/search';
import { hand, ids, zone } from '../../state';
import type { Action, CardRef, GameModule, GameState } from '../../types';
import { ALL_BIDS, bidOf, MISERE, NAMEABLE, OPEN_MISERE, STRAINS, type Contract } from './contracts';
import type { TrickData, TrickRules } from './index';

type S = GameState<TrickData>;

/**
 * The trick-taking bots: the quick rule-of-thumb bot (every decision, and the search's playouts)
 * and the search bot's view of a hand. They use the rules engine's helpers, passed in as `T`.
 */
export function trickBots(T: TrickCtx) {
  const { R, teamsFor, teamOf, target, lowWins, totalPoints, pointsOf, euchreBids, auction, trickBids, nilAllowed, suitFor, rankFor, suitOf, rankOf, legalCards, jokerLeadSuits, currentWinner, controller, higherBids, isMisere, auctionState, canDouble } = T;
  // ---- bots ---------------------------------------------------------------------------

  function botBid(s: S, seat: number): number {
    const d = s.data;
    let est = 0;
    const cards = ids(hand(s, seat)).map(parseCard);
    for (const c of cards) {
      const trump = c.suit === d.trump;
      if (c.rank === 14) est += 0.9;
      else if (c.rank === 13) est += 0.6;
      else if (c.rank === 12) est += trump ? 0.5 : 0.2;
      else if (trump && c.rank >= 9) est += 0.4;
    }
    let bid = Math.max(nilAllowed ? 1 : 0, Math.round(est));
    if (trickBids?.hook && seat === s.dealer) {
      const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
      if (others + bid === d.handSize) bid = bid > 0 ? bid - 1 : bid + 1;
    }
    return Math.min(bid, d.handSize);
  }

  /** Does this seat's side still want to win tricks? */
  function wantsTricks(s: S, seat: number): boolean {
    const d = s.data;
    if (R.scoring.type === 'penalty') return false;
    if (isMisere(s)) return false; // the contractor ducks; defenders keep low to make them win one
    if (R.scoring.type === 'tricks' || R.scoring.type === 'whist' || R.scoring.type === 'euchre' || R.scoring.type === 'auction' || R.scoring.type === 'bridge') return true;
    if (d.bids[seat] === 0 && nilAllowed) return false;
    if (R.scoring.type === 'exact') return d.tricks[seat] < (d.bids[seat] ?? 0);
    const team = teamsFor(s.players.length)[teamOf(s, seat)];
    const bid = team.reduce((n, i) => n + (d.bids[i] ?? 0), 0);
    return team.reduce((n, i) => n + d.tricks[i], 0) < bid;
  }

  /** Rough number of tricks a hand should take with `trump` (null = no trumps). */
  function strength(cards: string[], trump: Suit | null): number {
    let est = 0;
    const euchre = !!euchreBids;
    for (const c of cards) {
      const suit = suitFor(c, trump);
      const r = rankFor(c, trump);
      if (trump && suit === trump) est += r >= 24 ? 1 : r === 14 ? 0.8 : r === 13 ? 0.65 : r === 12 ? 0.5 : euchre ? 0.4 : 0.3;
      else if (r === 30) est += 1;
      else if (r === 14) est += trump ? 0.6 : 0.9;
      else if (r === 13) est += trump ? 0.25 : 0.5;
      else if (r === 12 && !trump) est += 0.2;
    }
    return est;
  }

  function botMakeTrumps(s: S, seat: number): Action | null {
    const d = s.data;
    const cards = ids(hand(s, seat));
    const team = (x: number) => teamOf(s, x);
    if (s.phase === 'order') {
      const suit = parseCard(d.upcard!).suit as Suit;
      let est = strength(seat === s.dealer ? [...cards, d.upcard!] : cards, suit);
      if (seat !== s.dealer) est += team(seat) === team(s.dealer) ? 0.4 : -0.3;
      if (est >= 4.6 && euchreBids?.alone) return { type: 'orderAlone' };
      return est >= 3 ? { type: 'order' } : { type: 'decline' };
    }
    const up = parseCard(d.upcard!).suit;
    const best = NAMEABLE.filter((x) => x !== up)
      .map((x) => ({ x, est: strength(cards, x) }))
      .sort((a, b) => b.est - a.est)[0];
    const stuck = euchreBids?.stickTheDealer && seat === s.dealer;
    if (best.est >= 4.6 && euchreBids?.alone) return { type: 'nameAlone', amount: NAMEABLE.indexOf(best.x) };
    if (best.est >= 3 || stuck) return { type: 'name', amount: NAMEABLE.indexOf(best.x) };
    return { type: 'decline' };
  }

  function botAuction(s: S, seat: number): Action {
    const cards = ids(hand(s, seat));
    // the kitty and a partner usually add a couple of tricks
    const help = (R.kitty ? 0.8 : 0) + (R.teams ? 1.6 : 0);
    const capacity = new Map<Suit | 'NT', number>(
      ([...NAMEABLE, 'NT'] as (Suit | 'NT')[]).map((x) => [x, Math.floor(strength(cards, x === 'NT' ? null : x) + help)]),
    );
    const open = higherBids(s);
    const options = open.filter((b) => !b.misere && b.tricks <= (capacity.get(b.suit) ?? 0));
    if (options.length) return { type: 'bid500', amount: ALL_BIDS.indexOf(options[0]) };
    // a hand of nothing but low cards (and no joker) can go misère
    const parsed = cards.map(parseCard);
    const low = parsed.every((c) => c.suit !== 'X' && c.rank <= 10) && parsed.filter((c) => c.rank >= 9).length <= 1;
    if (low && parsed.every((c) => c.rank <= 8) && open.includes(OPEN_MISERE)) return { type: 'bid500', amount: ALL_BIDS.indexOf(OPEN_MISERE) };
    if (low && open.includes(MISERE)) return { type: 'bid500', amount: ALL_BIDS.indexOf(MISERE) };
    return { type: 'decline' };
  }

  /**
   * A plain bridge bidder: count points (A4 K3 Q2 J1, +1 per card past four), guess partner's from
   * their calls, pick a strain (major fit, then no trumps, then minor fit, then a long suit) and bid
   * up to the level the combined points are worth, jumping straight to game when it's there.
   */
  function botCall(s: S, seat: number): Action {
    const calls = s.data.calls ?? [];
    const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
    const len = Object.fromEntries(SUITS.map((x) => [x, 0])) as Record<Suit, number>;
    let hcp = 0;
    for (const c of ids(hand(s, seat))) {
      const p = parseCard(c);
      len[p.suit as Suit]++;
      hcp += Math.max(0, p.rank - 10);
    }
    const shape = Object.values(len).sort((a, b) => a - b);
    const balanced = shape[0] >= 2 && shape[1] >= 3;
    const mine = hcp + SUITS.reduce((n, x) => n + Math.max(0, len[x] - 4), 0);

    // what partner has shown
    const partner = (seat + 2) % s.players.length;
    const pLen = Object.fromEntries(SUITS.map((x) => [x, 0])) as Record<Suit, number>;
    let pPts = 0;
    let pNT = false;
    let pBids = 0;
    calls.forEach((c, k) => {
      if (c.seat !== partner || typeof c.call !== 'number') return;
      const { level, strain } = bidOf(c.call);
      const before = calls.slice(0, k).some((x) => typeof x.call === 'number');
      const ours = calls.slice(0, k).some((x) => typeof x.call === 'number' && teamOf(s, x.seat) === teamOf(s, seat));
      // an opening 1NT shows 15–17; a no-trump response shows a modest balanced hand
      if (pBids === 0) pPts = !before ? (strain === 'NT' ? (level === 1 ? 16 : 21) : 13) : ours ? (strain === 'NT' ? 6 + level * 2 : 8) : strain === 'NT' ? 16 : 11;
      else pPts += 2;
      pBids++;
      if (strain === 'NT') pNT = true;
      else pLen[strain] = pLen[strain] ? 6 : strain === 'S' || strain === 'H' ? 5 : 4;
    });
    const weBid = calls.some((c) => typeof c.call === 'number' && teamOf(s, c.seat) === teamOf(s, seat));
    const a = auctionState(s);
    const pass: Action = { type: 'decline' };

    // nothing from our side yet: open (or overcall) on our own cards
    if (!weBid) {
      const longest = [...SUITS].sort((x, y) => len[y] - len[x] || (y === 'S' || y === 'H' ? 1 : 0) - (x === 'S' || x === 'H' ? 1 : 0))[0];
      if (a.lastBid < 0) {
        if (mine < 13) return pass;
        if (balanced && hcp >= 15 && hcp <= 17) return { type: 'call', amount: 4 }; // 1NT
        const major = (['S', 'H'] as Suit[]).find((x) => len[x] >= 5);
        const open = major ?? (len.D >= len.C ? 'D' : 'C');
        return { type: 'call', amount: STRAINS.indexOf(open) };
      }
      // overcall: a good five-card suit at the one or two level
      const cheapest = Array.from({ length: 35 }, (_, i) => i).find((i) => i > a.lastBid && bidOf(i).strain === longest);
      if (cheapest != null && len[longest] >= 5 && hcp >= 10 && bidOf(cheapest).level <= 2) return { type: 'call', amount: cheapest };
      return pass;
    }

    // our side has bid: choose a strain and a level
    const fit = (x: Suit) => len[x] + pLen[x];
    const shortness = (x: Suit) => SUITS.filter((y) => y !== x).reduce((n, y) => n + (len[y] === 0 ? 3 : len[y] === 1 ? 2 : 0), 0);
    const majorFit = (['S', 'H'] as Suit[]).filter((x) => fit(x) >= 8).sort((x, y) => fit(y) - fit(x))[0];
    const minorFit = (['D', 'C'] as Suit[]).filter((x) => fit(x) >= 8).sort((x, y) => fit(y) - fit(x))[0];
    const long = [...SUITS].sort((x, y) => len[y] - len[x])[0];
    let strain: Suit | 'NT';
    if (majorFit) strain = majorFit;
    else if (balanced || pNT) strain = 'NT';
    else if (minorFit) strain = minorFit;
    else if (len[long] >= 6 || !pBids) strain = long;
    else strain = 'NT';
    const total = (pBids ? pPts : 7) + mine + (strain !== 'NT' && fit(strain) >= 8 ? shortness(strain) : 0);
    const game = strain === 'NT' ? 3 : strain === 'S' || strain === 'H' ? 4 : 5;
    const level =
      total >= 37 ? 7 : total >= 33 ? 6 : total >= 29 && strain !== 'NT' ? 5 : total >= 26 ? game : total >= 23 ? (strain === 'NT' ? 2 : 3) : total >= 18 ? (strain === 'NT' ? 1 : 2) : total >= 13 ? 1 : 0;
    const cheapest = Array.from({ length: 35 }, (_, i) => i).find((i) => i > a.lastBid && bidOf(i).strain === strain);
    if (cheapest != null && bidOf(cheapest).level <= level) {
      // jump straight to game (or slam) rather than inching up
      const target = level >= game ? STRAINS.indexOf(strain) + (level - 1) * 5 : cheapest;
      return { type: 'call', amount: Math.max(cheapest, target) };
    }
    // opponents have overreached: double them
    if (canDouble(s, seat) && bidOf(a.lastBid).level >= 3 && total >= 23 + (bidOf(a.lastBid).level - 3) * 3) return { type: 'double' };
    return pass;
  }

  /** Discard the weakest cards (never trumps if avoidable), keeping short suits short. */
  function botBury(s: S, seat: number): Action {
    const d = s.data;
    const k = auction ? (R.kitty ?? 3) : 1;
    const cards = ids(hand(s, seat));
    const weight = (c: string) =>
      d.contract?.misere ? -rankOf(s, c) : (suitOf(s, c) === d.trump ? 100 : 0) + rankOf(s, c) + cards.filter((x) => suitOf(s, x) === suitOf(s, c)).length * 0.5;
    return { type: 'bury', cards: [...cards].sort((a, b) => weight(a) - weight(b)).slice(0, k) };
  }

  function botCard(s: S, seat: number): string {
    const d = s.data;
    const legal = legalCards(s, seat);
    const trick = zone(s, 'trick').cards;
    const val = (c: string) => rankOf(s, c) + (suitOf(s, c) === d.trump ? 40 : 0);
    const asc = [...legal].sort((a, b) => val(a) - val(b));
    const lowest = asc[0];
    const highest = asc[asc.length - 1];
    const want = wantsTricks(s, seat);
    if (!trick.length) {
      if (want) return asc.filter((c) => suitOf(s, c) !== d.trump).pop() ?? highest;
      const safe = asc.filter((c) => !pointsOf(c) && !(parseCard(c).suit === 'S' && parseCard(c).rank >= 12 && R.scoring.type === 'penalty'));
      return safe[0] ?? lowest;
    }
    const win = currentWinner(s)!;
    // (three-handed 500: the two players against the contractor play together, though they score apart)
    const teams = teamsFor(s.players.length);
    const againstMaker = !!d.contract && d.maker != null && teams.length === s.players.length;
    // (five-handed: the called card's holder knows they're the contractor's partner; the contractor
    // and the others only once it's been played)
    const partner = d.partner ?? null;
    const known = (i: number) => i === partner && (d.partnerShown || seat === partner);
    const ally = (other: number) => {
      if (teamOf(s, other) === teamOf(s, seat) && teams[teamOf(s, seat)].length > 1) return true;
      if (!againstMaker) return false;
      if (seat === d.maker) return known(other);
      if (seat === partner) return other === d.maker;
      return other !== d.maker && !(d.partnerShown && other === partner);
    };
    const partnerWinning = win.by !== seat && ally(win.by!);
    const beats = (c: string) => {
      const before = zone(s, 'trick').cards;
      zone(s, 'trick').cards = [...trick, { id: c, by: seat }];
      const w = currentWinner(s);
      zone(s, 'trick').cards = before;
      return w?.id === c;
    };
    const winners = asc.filter(beats);
    const losers = asc.filter((c) => !beats(c));
    if (want && !partnerWinning) return winners[0] ?? lowest;
    if (R.scoring.type === 'penalty') {
      const following = parseCard(legal[0]).suit === parseCard(trick[0].id).suit;
      if (!following) {
        const dump = [...legal].sort((a, b) => pointsOf(b) - pointsOf(a) || val(b) - val(a));
        return dump[0];
      }
      if (losers.length) return losers[losers.length - 1];
      const last = trick.length === s.players.length - 1;
      const pts = trick.some((c) => pointsOf(c.id));
      if (last && !pts) return asc.filter((c) => !pointsOf(c)).pop() ?? highest;
      return lowest;
    }
    // partner has it: keep out of the way with the cheapest card that doesn't take it over
    if (partnerWinning) return losers[0] ?? lowest;
    return losers.length ? losers[losers.length - 1] : lowest;
  }

  /** The quick rule-of-thumb bot: every decision, and the search's playouts. */
  function quickBot(s: S, seat: number): Action | null {
    const d = s.data;
    if (s.phase === 'pass' && !d.passes[seat]) {
      const danger = (c: string) => {
        const { rank, suit } = parseCard(c);
        return pointsOf(c) * 8 + rank + (suit === 'S' && rank > 11 && R.scoring.type === 'penalty' ? 40 : 0);
      };
      return { type: 'pass', cards: [...ids(hand(s, seat))].sort((a, b) => danger(b) - danger(a)).slice(0, R.passing!.count) };
    }
    if (s.phase === 'bid' && s.turn === seat) return { type: 'bid', amount: botBid(s, seat) };
    if ((s.phase === 'order' || s.phase === 'name') && s.turn === seat) return botMakeTrumps(s, seat);
    if (s.phase === 'auction' && s.turn === seat) return botAuction(s, seat);
    if (s.phase === 'discard' && s.turn === seat) return botBury(s, seat);
    if (s.phase === 'call' && s.turn === seat) return botCall(s, seat);
    if (s.phase === 'play' && controller(s) === seat) {
      if (!legalCards(s, s.turn!).length) return { type: 'leadJoker', amount: NAMEABLE.indexOf(jokerLeadSuits(s)[0]) };
      return { type: 'play', cards: [botCard(s, s.turn!)] };
    }
    if (s.phase === 'blind' && s.turn === seat) {
      // a long way behind: gamble on blind nil
      const best = Math.max(...d.scores);
      return { type: best - d.scores[teamOf(s, seat)] >= 200 ? 'blindNil' : 'look' };
    }
    if ((s.phase === 'blindPass' || s.phase === 'blindReturn') && s.turn === seat) {
      // partner passes low cards to the nil bidder, who passes high ones back
      const v = (c: string) => rankOf(s, c) + (suitOf(s, c) === d.trump ? 20 : 0);
      const sorted = [...ids(hand(s, seat))].sort((a, b) => v(a) - v(b));
      return { type: 'blindGive', cards: s.phase === 'blindPass' ? sorted.slice(0, 2) : sorted.slice(-2) };
    }
    if (s.phase === 'defend' && s.turn === seat) return { type: strength(ids(hand(s, seat)), d.trump) >= 4.8 ? 'defendAlone' : 'stayIn' };
    if (s.phase === 'joker' && s.turn === seat) {
      // make the joker the top card of the longest suit
      const cards = ids(hand(s, seat));
      const longest = [...NAMEABLE].sort((x, y) => cards.filter((c) => parseCard(c).suit === y).length - cards.filter((c) => parseCard(c).suit === x).length)[0];
      return { type: 'nominate', amount: NAMEABLE.indexOf(longest) };
    }
    if (s.phase === 'moon' && s.turn === seat) {
      // adding to everyone else only if that ends the game with the shooter on top
      const after = d.scores.map((x, ti) => (ti === teamOf(s, seat) ? x : x + totalPoints));
      const wins = Math.max(...after) >= target(s) && after[teamOf(s, seat)] < Math.min(...after.filter((_, ti) => ti !== teamOf(s, seat)));
      return { type: wins ? 'moonAdd' : 'moonSub' };
    }
    return null;
  }

  // ---- the search bot's view of a hand ---------------------------------------------------

  const search: SearchGame<TrickData> = {
    // deal the cards `viewer` can't see afresh, keeping each player's count and known voids
    determinize(s, viewer) {
      const c = fork(s);
      const d = c.data;
      // who buried the kitty knows it (the euchre dealer, the 500 maker); a turned-down upcard is public
      const kittyKnown = euchreBids ? viewer === c.dealer : d.maker === viewer;
      // Hearts: the cards passed are still with whoever got them, unless played since
      const passedTo = d.passDir && d.passDir !== 'hold' && d.passes[viewer]?.length ? passTarget(viewer, d.passDir, c.players.length) : -1;
      dealUnseen(c, [
        ...c.players
          .filter((p) => p.seat !== viewer)
          .map((p) => {
            const voids = d.voids?.[p.seat] ?? [];
            return {
              zone: `hand:${p.seat}`,
              fixed: p.seat === passedTo ? d.passes[viewer]! : [],
              forbid: voids.length ? (x: string) => voids.includes(suitOf(c, x)) : undefined,
            };
          }),
        { zone: 'deck' },
        ...(kittyKnown ? [] : [{ zone: 'kitty', fixed: d.upcard ? [d.upcard] : [] }]),
      ]);
      return c;
    },

    candidates(s) {
      const plays: Action[] = legalCards(s, s.turn!).map((c) => ({ type: 'play', cards: [c] }));
      if (!plays.length) return jokerLeadSuits(s).map((x) => ({ type: 'leadJoker', amount: NAMEABLE.indexOf(x) }));
      return plays;
    },

    apply: (s, seat, a) => T.module.apply(s, seat, a),
    rollout: (s) => playOut(T.module, quickBot, s, (x) => x.phase === 'roundOver' || x.phase === 'gameOver'),
    // the hand's points for our side against the others' (Hearts: fewer is better)
    score: (before, after, seat) => edge(before.data.scores, after.data.scores, teamOf(before, seat), lowWins),
  };

  return { quickBot, search, botBid };
}

/** What the bots need from the rules engine. */
export interface TrickCtx {
  R: TrickRules;
  /** (read when a playout runs, so it may be filled in after the bots are made) */
  module: GameModule<TrickData>;
  teamsFor: (n: number) => number[][];
  teamOf: (s: S, seat: number) => number;
  target: (s: S) => number;
  lowWins: boolean;
  /** Points in the whole deck (Hearts: 26). */
  totalPoints: number;
  pointsOf: (id: string) => number;
  euchreBids: { type: 'euchre'; stickTheDealer?: boolean; alone?: boolean } | null;
  auction: { type: 'auction'; schedule: 'avondale'; misere?: boolean } | null;
  trickBids: { nil?: boolean; hook?: boolean } | null;
  nilAllowed: boolean;
  suitFor: (id: string, trump: Suit | null) => string;
  rankFor: (id: string, trump: Suit | null) => number;
  suitOf: (s: S, id: string) => string;
  rankOf: (s: S, id: string) => number;
  legalCards: (s: S, seat: number) => string[];
  jokerLeadSuits: (s: S) => Suit[];
  currentWinner: (s: S) => CardRef | null;
  controller: (s: S) => number | null;
  higherBids: (s: S) => Contract[];
  isMisere: (s: S) => boolean;
  auctionState: (s: S) => { lastBid: number; bidder: number; dbl: 0 | 1 | 2 };
  canDouble: (s: S, seat: number) => boolean;
}
