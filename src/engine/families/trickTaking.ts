import { buildDeck, cardName, parseCard, rankLabel, SUIT_SYMBOL, type Suit } from '../cards';
import { passTarget, type PassDirection } from '../lib/passing';
import { followSuit, trickWinner } from '../lib/trickTaking';
import { createState, deal, hand, ids, log, moveCards, moveTop, name, nextSeat, resetDeck, sortHand, zone } from '../state';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Trick-taking family: Hearts, Spades, Oh Hell, Whist… all configured from `game.json`:
 *
 * ```jsonc
 * "rules": {
 *   "family": "trick-taking",
 *   "handSizes": "all",                 // "all" | [10, 9, 8, …] | "ladder" (1 → max → 1)
 *   "maxHand": 7,                       // cap for "ladder"
 *   "passing": { "count": 3, "cycle": ["left", "right", "across", "hold"] },
 *   "lead": "twoOfClubs",               // "twoOfClubs" | "leftOfDealer"
 *   "trump": "none",                    // "none" | "S" | "H" | "D" | "C" | "turnUp"
 *   "breaks": "H",                      // suit that can't be led until it has been played
 *   "noPointsFirstTrick": true,
 *   "teams": [[0, 2], [1, 3]],          // partnerships (default: everyone plays alone)
 *   "bidding": { "nil": true, "hook": false },  // bid number of tricks before play
 *   "scoring": { "type": "penalty", "cardPoints": { "H": 1, "QS": 13 }, "moon": true },
 *              // or { "type": "contract", "bags": { "every": 10, "penalty": 100 }, "nil": 100 }
 *              // or { "type": "exact", "bonus": 10 }    (Oh Hell: 1/trick + bonus if exact)
 *              // or { "type": "tricks" }                (1 point per trick)
 *   "end": { "target": 100, "lowWins": true }           // or { "rounds": true } for handSizes
 * }
 * ```
 */
export interface TrickRules {
  family: 'trick-taking';
  handSizes?: 'all' | 'ladder' | number[];
  maxHand?: number;
  passing?: { count: number; cycle: PassDirection[] };
  lead?: 'twoOfClubs' | 'leftOfDealer';
  trump?: 'none' | Suit | 'turnUp';
  breaks?: Suit;
  noPointsFirstTrick?: boolean;
  teams?: number[][];
  bidding?: { nil?: boolean; hook?: boolean };
  scoring:
    | { type: 'penalty'; cardPoints: Record<string, number>; moon?: boolean }
    | { type: 'contract'; bags?: { every: number; penalty: number }; nil?: number }
    | { type: 'exact'; bonus: number }
    | { type: 'tricks' };
  end: { target?: number; lowWins?: boolean; rounds?: boolean };
}

export interface TrickData {
  round: number;
  handSize: number;
  passDir: PassDirection | null;
  /** Cards chosen to pass (redacted to their owner). */
  passes: (string[] | null)[];
  /** Cards just received in the pass (redacted to their owner). */
  received: string[][];
  trump: Suit | null;
  broken: boolean;
  bids: (number | null)[];
  tricks: number[];
  points: number[];
  /** Per team. */
  scores: number[];
  bags: number[];
  trickNo: number;
  result: { lines: string[] } | null;
}

type S = GameState<TrickData>;

export function trickTakingFamily(config: GameConfig): GameModule<TrickData> {
  const R = config.rules as unknown as TrickRules;
  const deckSize = buildDeck(config.deck).length;
  const pointsOf = (id: string) => {
    if (R.scoring.type !== 'penalty') return 0;
    const pts = R.scoring.cardPoints;
    return pts[id.split('#')[0]] ?? pts[parseCard(id).suit] ?? 0;
  };
  const totalPoints = buildDeck(config.deck).reduce((n, c) => n + pointsOf(c), 0);
  const teamsFor = (n: number) => R.teams?.filter((t) => t.every((s) => s < n)).length ? R.teams! : Array.from({ length: n }, (_, i) => [i]);
  const teamOf = (s: S, seat: number) => teamsFor(s.players.length).findIndex((t) => t.includes(seat));
  const teamName = (s: S, team: number) => teamsFor(s.players.length)[team].map((i) => name(s, i)).join(' & ');
  const lowWins = !!R.end.lowWins;
  const target = (s: S) => Number(s.options.target ?? R.end.target ?? 100);

  function sizeForRound(n: number, round: number): number {
    const all = Math.floor((deckSize - (R.trump === 'turnUp' ? 1 : 0)) / n);
    if (!R.handSizes || R.handSizes === 'all') return Math.floor(deckSize / n);
    const seq = sequence(n);
    return Math.min(all, seq[round % seq.length]);
  }
  function sequence(n: number): number[] {
    if (Array.isArray(R.handSizes)) return R.handSizes;
    const max = Math.min(R.maxHand ?? 99, Math.floor((deckSize - 1) / n));
    const up = Array.from({ length: max }, (_, i) => i + 1);
    return [...up, ...up.slice(0, -1).reverse()];
  }
  const totalRounds = (n: number) => (R.end.rounds ? sequence(n).length : Infinity);

  function startRound(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, config);
    d.handSize = sizeForRound(n, d.round);
    deal(s, [{ to: 'hand', count: d.handSize }]);
    d.trump = R.trump && R.trump !== 'none' && R.trump !== 'turnUp' ? R.trump : null;
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
    if (d.passDir && d.passDir !== 'hold') {
      s.phase = 'pass';
      s.turn = null;
    } else startBidding(s);
  }

  function startBidding(s: S) {
    if (!R.bidding) return startPlay(s);
    s.phase = 'bid';
    s.turn = nextSeat(s, s.dealer);
  }

  function startPlay(s: S) {
    s.phase = 'play';
    const twoClubs = s.players.findIndex((_, i) => ids(hand(s, i)).includes('2C'));
    s.turn = R.lead === 'twoOfClubs' && twoClubs >= 0 ? twoClubs : nextSeat(s, s.dealer);
  }

  function legalCards(s: S, seat: number): string[] {
    const cards = ids(hand(s, seat));
    const trick = zone(s, 'trick').cards;
    const d = s.data;
    if (trick.length === 0) {
      if (d.trickNo === 0 && R.lead === 'twoOfClubs' && cards.includes('2C')) return ['2C'];
      if (R.breaks && !d.broken) {
        const safe = cards.filter((c) => parseCard(c).suit !== R.breaks);
        if (safe.length) return safe;
      }
      return cards;
    }
    const legal = followSuit(cards, parseCard(trick[0].id).suit as Suit);
    if (d.trickNo === 0 && R.noPointsFirstTrick) {
      const clean = legal.filter((c) => !pointsOf(c));
      if (clean.length) return clean;
    }
    return legal;
  }

  function currentWinner(s: S) {
    const trick = zone(s, 'trick').cards;
    return trick.length ? trick[trickWinner(trick, { trump: s.data.trump })] : null;
  }

  function collectTrick(s: S) {
    const d = s.data;
    const trick = zone(s, 'trick');
    const winner = currentWinner(s)!.by!;
    const cards = ids(trick);
    const pts = cards.reduce((n, c) => n + pointsOf(c), 0);
    d.points[winner] += pts;
    d.tricks[winner]++;
    moveCards(s, 'trick', `taken:${winner}`, cards);
    log(s, `${name(s, winner)} wins the trick${pts ? ` (+${pts})` : ''}`, winner, pts ? `Won trick +${pts}` : 'Won trick');
    d.trickNo++;
    if (d.trickNo === d.handSize) return endRound(s);
    s.phase = 'play';
    s.turn = winner;
  }

  /** Points each team earns this round. */
  function roundScores(s: S): { deltas: number[]; lines: string[] } {
    const d = s.data;
    const teams = teamsFor(s.players.length);
    const lines: string[] = [];
    const sc = R.scoring;
    const deltas = teams.map(() => 0);
    if (sc.type === 'penalty') {
      const shooter = sc.moon ? d.points.findIndex((p) => p === totalPoints && p > 0) : -1;
      if (shooter >= 0) lines.push(`🌙 ${name(s, shooter)} shot the moon!`);
      teams.forEach((t, ti) => {
        deltas[ti] = shooter >= 0 ? (t.includes(shooter) ? 0 : totalPoints) : t.reduce((n, i) => n + d.points[i], 0);
      });
    } else if (sc.type === 'tricks') {
      teams.forEach((t, ti) => (deltas[ti] = t.reduce((n, i) => n + d.tricks[i], 0)));
    } else if (sc.type === 'exact') {
      teams.forEach((t, ti) => {
        for (const i of t) deltas[ti] += d.tricks[i] === d.bids[i] ? d.tricks[i] + sc.bonus : 0;
      });
    } else {
      // contract (spades-style): team bid vs team tricks, nil bids scored separately
      const nilBonus = sc.nil ?? 100;
      teams.forEach((t, ti) => {
        let bid = 0;
        let won = 0;
        for (const i of t) {
          if (d.bids[i] === 0 && R.bidding?.nil) {
            const ok = d.tricks[i] === 0;
            deltas[ti] += ok ? nilBonus : -nilBonus;
            lines.push(`${name(s, i)} ${ok ? 'made' : 'failed'} nil`);
          } else {
            bid += d.bids[i] ?? 0;
            won += d.tricks[i];
          }
        }
        if (bid > 0 || won > 0) {
          if (won >= bid) {
            const over = won - bid;
            deltas[ti] += bid * 10 + over;
            d.bags[ti] += over;
            if (sc.bags && d.bags[ti] >= sc.bags.every) {
              d.bags[ti] -= sc.bags.every;
              deltas[ti] -= sc.bags.penalty;
              lines.push(`${teamName(s, ti)}: ${sc.bags.every} bags, −${sc.bags.penalty}`);
            }
          } else deltas[ti] -= bid * 10;
        }
      });
    }
    return { deltas, lines };
  }

  function endRound(s: S) {
    const d = s.data;
    const { deltas, lines } = roundScores(s);
    deltas.forEach((v, ti) => (d.scores[ti] += v));
    teamsFor(s.players.length).forEach((_, ti) =>
      lines.push(`${teamName(s, ti)}: ${deltas[ti] >= 0 ? '+' : ''}${deltas[ti]} → ${d.scores[ti]}`),
    );
    d.result = { lines };
    s.turn = null;
    const best = lowWins ? Math.min(...d.scores) : Math.max(...d.scores);
    const reached = R.end.rounds
      ? d.round + 1 >= totalRounds(s.players.length)
      : lowWins
        ? Math.max(...d.scores) >= target(s)
        : best >= target(s);
    if (reached) {
      const teams = teamsFor(s.players.length);
      s.winner = teams.flatMap((t, ti) => (d.scores[ti] === best ? t : []));
      s.phase = 'gameOver';
    } else s.phase = 'roundOver';
  }

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
    let bid = Math.max(R.bidding?.nil ? 1 : 0, Math.round(est));
    if (R.bidding?.hook && seat === s.dealer) {
      const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
      if (others + bid === d.handSize) bid = bid > 0 ? bid - 1 : bid + 1;
    }
    return Math.min(bid, d.handSize);
  }

  /** Does this seat's side still want to win tricks? */
  function wantsTricks(s: S, seat: number): boolean {
    const d = s.data;
    if (R.scoring.type === 'penalty') return false;
    if (R.scoring.type === 'tricks') return true;
    if (d.bids[seat] === 0 && R.bidding?.nil) return false;
    if (R.scoring.type === 'exact') return d.tricks[seat] < (d.bids[seat] ?? 0);
    const team = teamsFor(s.players.length)[teamOf(s, seat)];
    const bid = team.reduce((n, i) => n + (d.bids[i] ?? 0), 0);
    return team.reduce((n, i) => n + d.tricks[i], 0) < bid;
  }

  function botCard(s: S, seat: number): string {
    const d = s.data;
    const legal = legalCards(s, seat);
    const trick = zone(s, 'trick').cards;
    const val = (c: string) => parseCard(c).rank + (parseCard(c).suit === d.trump ? 20 : 0);
    const asc = [...legal].sort((a, b) => val(a) - val(b));
    const lowest = asc[0];
    const highest = asc[asc.length - 1];
    const want = wantsTricks(s, seat);
    if (!trick.length) {
      if (want) return asc.filter((c) => parseCard(c).suit !== d.trump).pop() ?? highest;
      const safe = asc.filter((c) => !pointsOf(c) && !(parseCard(c).suit === 'S' && parseCard(c).rank >= 12 && R.scoring.type === 'penalty'));
      return safe[0] ?? lowest;
    }
    const win = currentWinner(s)!;
    const partnerWinning = teamOf(s, win.by!) === teamOf(s, seat) && R.teams;
    const beats = (c: string) => {
      const test = [...trick, { id: c, by: seat }];
      return trickWinner(test, { trump: d.trump }) === test.length - 1;
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
    return losers.length ? losers[losers.length - 1] : lowest;
  }

  function dirLabel(s: S, seat: number) {
    const to = passTarget(seat, s.data.passDir!, s.players.length);
    return `${s.data.passDir} → ${name(s, to)}`;
  }

  return {
    config,

    setup(players, seed, options) {
      const s = createState<TrickData>(config, players, seed, options, {
        round: 0,
        handSize: 0,
        passDir: null,
        passes: [],
        received: [],
        trump: null,
        broken: false,
        bids: [],
        tricks: [],
        points: [],
        scores: teamsFor(players.length).map(() => 0),
        bags: teamsFor(players.length).map(() => 0),
        trickNo: 0,
        result: null,
      });
      s.dealer = players.length - 1;
      startRound(s);
      return s;
    },

    actions(s, seat) {
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
          amount: { min: 0, max: d.handSize, step: 1, default: botBid(s, seat), label: R.bidding?.nil ? 'tricks (0 = nil)' : 'tricks' },
        });
      } else if (s.phase === 'play' && s.turn === seat) {
        out.push({ type: 'play', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legalCards(s, seat) } });
      } else if (s.phase === 'roundOver') {
        out.push({ type: 'next', label: 'Next hand', style: 'primary' });
      } else if (s.phase === 'gameOver') {
        out.push({ type: 'rematch', label: 'New game', style: 'primary' });
      }
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      switch (a.type) {
        case 'pass': {
          assertRule(s.phase === 'pass' && !d.passes[seat], 'Not passing now');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          const count = R.passing!.count;
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
            log(s, `Cards passed ${d.passDir}`);
            startBidding(s);
          }
          return;
        }
        case 'unpass':
          assertRule(s.phase === 'pass', 'Too late');
          d.passes[seat] = null;
          return;
        case 'bid': {
          assertRule(s.phase === 'bid' && s.turn === seat, 'Not your turn to bid');
          const bid = Math.floor(a.amount ?? -1);
          assertRule(bid >= 0 && bid <= d.handSize, `Bid between 0 and ${d.handSize}`);
          if (R.bidding?.hook && seat === s.dealer) {
            const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
            assertRule(others + bid !== d.handSize, `The dealer can’t bid ${bid}: total bids can’t equal ${d.handSize}`);
          }
          d.bids[seat] = bid;
          const bidText = bid === 0 && R.bidding?.nil ? 'nil' : String(bid);
          log(s, `${name(s, seat)} bids ${bidText}`, seat, `Bid ${bidText}`);
          if (d.bids.every((b) => b != null)) startPlay(s);
          else s.turn = nextSeat(s, seat);
          return;
        }
        case 'play': {
          assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
          const card = a.cards?.[0];
          assertRule(card && legalCards(s, seat).includes(card), 'You can’t play that card');
          moveCards(s, `hand:${seat}`, 'trick', [card], { by: seat, up: true });
          d.received[seat] = [];
          log(s, `${name(s, seat)} plays the ${cardName(card)}`, seat, `${rankLabel(parseCard(card).rank)}${SUIT_SYMBOL[parseCard(card).suit]}`);
          if (R.breaks && parseCard(card).suit === R.breaks && !d.broken) {
            d.broken = true;
            log(s, `${SUIT_SYMBOL[R.breaks]} broken`);
          }
          if (zone(s, 'trick').cards.length === s.players.length) {
            s.phase = 'trickEnd';
            s.turn = null;
          } else s.turn = nextSeat(s, seat);
          return;
        }
        case 'next':
          assertRule(s.phase === 'roundOver', 'Round not over');
          d.round++;
          s.dealer = nextSeat(s, s.dealer);
          startRound(s);
          return;
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.round = 0;
          d.scores = d.scores.map(() => 0);
          d.bags = d.bags.map(() => 0);
          s.winner = undefined;
          startRound(s);
          return;
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    system(s) {
      if (s.phase !== 'trickEnd') return null;
      return { delay: 1200, run: collectTrick };
    },

    bot(s, seat) {
      const d = s.data;
      if (s.phase === 'pass' && !d.passes[seat]) {
        const danger = (c: string) => {
          const { rank, suit } = parseCard(c);
          return pointsOf(c) * 8 + rank + (suit === 'S' && rank > 11 && R.scoring.type === 'penalty' ? 40 : 0);
        };
        return { type: 'pass', cards: [...ids(hand(s, seat))].sort((a, b) => danger(b) - danger(a)).slice(0, R.passing!.count) };
      }
      if (s.phase === 'bid' && s.turn === seat) return { type: 'bid', amount: botBid(s, seat) };
      if (s.phase === 'play' && s.turn === seat) return { type: 'play', cards: [botCard(s, seat)] };
      return null;
    },

    redactData(s, viewer) {
      const d = s.data;
      return {
        ...d,
        passes: d.passes.map((p, i) => (p && i !== viewer ? [] : p)),
        received: d.received.map((r, i) => (i === viewer ? r : [])),
      };
    },

    status(s, viewer) {
      const d = s.data;
      const teams = teamsFor(s.players.length);
      const bidding = !!R.bidding;
      let headline = '';
      if (s.phase === 'pass') {
        headline = d.passes[viewer] ? 'Waiting for everyone to pass…' : viewer >= 0 ? `Pass ${R.passing!.count} cards ${dirLabel(s, viewer)}` : 'Passing cards';
      } else if (s.phase === 'bid') {
        headline = s.turn === viewer ? `Your bid · ${d.handSize} tricks this hand` : `${name(s, s.turn!)} is bidding`;
      } else if (s.phase === 'play' || s.phase === 'trickEnd') {
        const leading = zone(s, 'trick').cards.length === 0;
        if (s.turn === viewer) headline = leading ? (d.trickNo === 0 && R.lead === 'twoOfClubs' ? 'Lead the 2♣' : 'Your lead') : 'Your turn';
        else if (s.turn != null) headline = `${name(s, s.turn)} to play`;
      } else if (s.phase === 'roundOver') headline = 'Hand complete';
      else if (s.phase === 'gameOver') headline = 'Game over';
      if (d.trump && s.phase !== 'gameOver') headline += ` · trumps ${SUIT_SYMBOL[d.trump]}`;

      const seatBadge = (i: number) => {
        if (s.phase === 'pass' && d.passes[i]) return 'Passed ✓';
        const parts: string[] = [];
        if (bidding) parts.push(d.bids[i] == null ? '' : `${d.tricks[i]}/${d.bids[i] === 0 && R.bidding?.nil ? 'nil' : d.bids[i]}`);
        else if (R.scoring.type === 'penalty') parts.push(d.points[i] ? `+${d.points[i]}` : '');
        else parts.push(`${d.tricks[i]} tricks`);
        parts.push(`${d.scores[teamOf(s, i)]} pts`);
        return parts.filter(Boolean).join(' · ');
      };

      return {
        headline,
        seats: s.players.map((_, i) => ({ badge: seatBadge(i), tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: {
          columns: [bidding ? 'Won / bid' : R.scoring.type === 'penalty' ? 'This hand' : 'Tricks', 'Total'],
          rows: teams.map((t, ti) => ({
            name: teamName(s, ti),
            values: [
              bidding ? t.map((i) => `${d.tricks[i]}/${d.bids[i] ?? '–'}`).join(' ') : R.scoring.type === 'penalty' ? t.reduce((n, i) => n + d.points[i], 0) : t.reduce((n, i) => n + d.tricks[i], 0),
              d.scores[ti],
            ],
            highlight: !!s.winner && t.some((i) => s.winner!.includes(i)),
          })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${[...new Set(s.winner!.map((w) => teamOf(s, w)))].map((ti) => teamName(s, ti)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'roundOver'
              ? { title: 'Hand complete', lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
}

