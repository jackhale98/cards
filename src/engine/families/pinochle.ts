import { parseCard, rankLabel, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../cards';
import { createState, deal, hand, ids, log, moveCards, name, nextSeat, placesFromScores, resetDeck, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Partnership auction Pinochle, single deck (pagat.com/marriage/pinmain.html). Configured from
 * `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "pinochle", "end": { "target": 1500 } }
 * ```
 * 48 cards (two each of 9 10 J Q K A per suit), ranked A 10 K Q J 9; 12 each to four players,
 * partners across. Bidding starts at 250 and rises in tens; a pass is final, and if the other three
 * pass the dealer takes it at 250. The declarer names trumps, takes four cards from their partner
 * and passes four back. Everyone's meld goes on the table (worked out automatically):
 * - trumps: run (A 10 K Q J) 150, with an extra K or Q 190, both 230, double run 1500; royal
 *   marriage (K Q) 40; dix (9) 10 each;
 * - common marriage (K Q of another suit) 20; pinochle (Q♠ J♦) 40, double pinochle 300;
 * - arounds (one of each suit): aces 100, kings 80, queens 60, jacks 40; both of each ×10.
 * A declarer whose meld is more than 250 short of the bid is set at once (or may throw in).
 * Play: follow suit and beat the winning card if you can (unless the trick's been trumped); void,
 * you must trump, overtrumping if you can. Aces, 10s and kings taken are 10 each, the last trick 10
 * more. The declaring side making its bid scores its meld and points, otherwise loses the bid; the
 * other side scores too if it takes at least one point (saving its meld). First to 1500.
 */
export interface PinochleRules {
  family: 'pinochle';
  end: { target: number };
}

export interface PinochleData {
  handNo: number;
  /** Per side: seats 0 & 2, and 1 & 3. */
  scores: number[];
  bid: number | null;
  bidder: number | null;
  passed: boolean[];
  trump: Suit | null;
  /** Meld per seat (shown on the table), with what it's made of. */
  meld: { points: number; lines: string[] }[];
  /** Counter points taken per side this hand. */
  taken: number[];
  /** Did each side take any trick points (needed to save its meld)? */
  tookPoints: boolean[];
  trickNo: number;
  result: { lines: string[] } | null;
}

type S = GameState<PinochleData>;

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
/** Card strength within a suit: A 10 K Q J 9. */
const POWER: Record<number, number> = { 14: 6, 10: 5, 13: 4, 12: 3, 11: 2, 9: 1 };
const power = (id: string) => POWER[parseCard(id).rank];
const suitOf = (id: string) => parseCard(id).suit as Suit;
const isCounter = (id: string) => [14, 10, 13].includes(parseCard(id).rank);
const label = (id: string) => `${rankLabel(parseCard(id).rank)}${SUIT_SYMBOL[suitOf(id)]}`;
const MIN_BID = 250;
const teamOf = (seat: number) => seat % 2;

/** Points in meld for `cards` with `trump`, and the melds shown (the class rules of pagat's table). */
export function meldOf(cards: string[], trump: Suit): { points: number; lines: string[] } {
  const count = (r: number, s: Suit) => cards.filter((c) => parseCard(c).rank === r && suitOf(c) === s).length;
  const lines: string[] = [];
  let points = 0;
  const add = (pts: number, what: string) => {
    points += pts;
    lines.push(`${what} ${pts}`);
  };
  // class I: runs and marriages in trumps, dix, common marriages
  const [a, t, k, q, j] = [14, 10, 13, 12, 11].map((r) => count(r, trump));
  if (Math.min(a, t, k, q, j) >= 2) add(1500, 'Double run');
  else if (Math.min(a, t, k, q, j) >= 1) {
    const extra = k - 1 + (q - 1); // an extra king or queen marries the run's
    add(150 + 40 * extra, extra ? `Run with ${extra === 2 ? 'a marriage' : `an extra ${k > 1 ? 'king' : 'queen'}`}` : 'Run');
  } else if (Math.min(k, q)) add(40 * Math.min(k, q), Math.min(k, q) > 1 ? 'Two royal marriages' : 'Royal marriage');
  if (count(9, trump)) add(10 * count(9, trump), count(9, trump) > 1 ? 'Two dix' : 'Dix');
  for (const s of SUITS) {
    if (s === trump) continue;
    const m = Math.min(count(13, s), count(12, s));
    if (m) add(20 * m, `${m > 1 ? 'Two marriages' : 'Marriage'} in ${SUIT_NAME[s].toLowerCase()}`);
  }
  // class II: pinochles
  const pin = Math.min(count(12, 'S'), count(11, 'D'));
  if (pin >= 2) add(300, 'Double pinochle');
  else if (pin === 1) add(40, 'Pinochle');
  // class III: arounds
  for (const [r, v, what] of [
    [14, 100, 'aces'],
    [13, 80, 'kings'],
    [12, 60, 'queens'],
    [11, 40, 'jacks'],
  ] as const) {
    const n = Math.min(...SUITS.map((s) => count(r, s)));
    if (n >= 2) add(v * 10, `Double ${what} around`);
    else if (n === 1) add(v, `${what[0].toUpperCase()}${what.slice(1)} around`);
  }
  return { points, lines };
}

/** The cards that make up a hand's meld (shown on the table while melds are counted). */
function meldCards(cards: string[], trump: Suit): string[] {
  const has = new Set<string>();
  const take = (r: number, s: Suit, n: number) =>
    cards.filter((c) => parseCard(c).rank === r && suitOf(c) === s).slice(0, n).forEach((c) => has.add(c));
  const count = (r: number, s: Suit) => cards.filter((c) => parseCard(c).rank === r && suitOf(c) === s).length;
  const [a, t, k, q, j] = [14, 10, 13, 12, 11].map((r) => count(r, trump));
  if (Math.min(a, t, k, q, j) >= 1) for (const r of [14, 10, 13, 12, 11]) take(r, trump, 2);
  for (const s of SUITS) {
    const m = Math.min(count(13, s), count(12, s));
    if (m) {
      take(13, s, m);
      take(12, s, m);
    }
  }
  take(9, trump, 2);
  const pin = Math.min(count(12, 'S'), count(11, 'D'));
  take(12, 'S', pin);
  take(11, 'D', pin);
  for (const r of [14, 13, 12, 11]) {
    const n = Math.min(...SUITS.map((s) => count(r, s)));
    for (const s of SUITS) take(r, s, n);
  }
  return cards.filter((c) => has.has(c));
}

export function pinochleFamily(config: GameConfig): GameModule<PinochleData> {
  const R = config.rules as unknown as PinochleRules;
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const partner = (seat: number) => (seat + 2) % 4;
  const teamName = (s: S, t: number) => `${name(s, t)} & ${name(s, t + 2)}`;

  function sortHand(s: S, seat: number) {
    const trump = s.data.trump;
    const order = trump ? [trump, ...SUITS.filter((x) => x !== trump)] : SUITS;
    hand(s, seat).cards.sort((a, b) => order.indexOf(suitOf(a.id)) - order.indexOf(suitOf(b.id)) || power(b.id) - power(a.id) || a.id.localeCompare(b.id));
  }

  function startHand(s: S) {
    const d = s.data;
    resetDeck(s, config);
    for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
    deal(s, [{ to: 'hand', count: 12 }]);
    s.players.forEach((_, i) => sortHand(s, i));
    d.handNo++;
    d.bid = null;
    d.bidder = null;
    d.passed = [false, false, false, false];
    d.trump = null;
    d.meld = s.players.map(() => ({ points: 0, lines: [] }));
    d.taken = [0, 0];
    d.tookPoints = [false, false];
    d.trickNo = 0;
    d.result = null;
    s.phase = 'bid';
    s.turn = nextSeat(s, s.dealer);
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals — bidding starts at ${MIN_BID}`);
  }

  /** After a bid or pass: on to the next bidder, or the auction is won. */
  function afterBid(s: S, seat: number) {
    const d = s.data;
    const left = [0, 1, 2, 3].filter((i) => !d.passed[i]);
    if (left.length === 1 && (d.bidder != null || left[0] === s.dealer)) {
      // (the dealer is stuck at 250 if everyone else passes)
      if (d.bidder == null) {
        d.bid = MIN_BID;
        d.bidder = s.dealer;
        log(s, `Everyone passes — ${name(s, s.dealer)} takes it at ${MIN_BID}`, s.dealer, `${MIN_BID}`);
      }
      s.phase = 'trump';
      s.turn = d.bidder!;
      return;
    }
    s.turn = nextSeat(s, seat, (i) => d.passed[i]);
  }

  /** Melds go on the table; a declarer who can't make the bid even with every point is set at once. */
  function showMelds(s: S) {
    const d = s.data;
    s.players.forEach((_, i) => {
      d.meld[i] = meldOf(ids(hand(s, i)), d.trump!);
      moveCards(s, `hand:${i}`, `meld:${i}`, meldCards(ids(hand(s, i)), d.trump!), { up: true });
      zone(s, `meld:${i}`).label = `${name(s, i)} · meld ${d.meld[i].points}`;
    });
    s.phase = 'meld';
    s.turn = d.bidder;
    const side = teamOf(d.bidder!);
    const meld = sideMeld(s, side);
    log(s, `Meld: ${teamName(s, 0)} ${sideMeld(s, 0)}, ${teamName(s, 1)} ${sideMeld(s, 1)}`);
    if (meld + 250 < d.bid!) {
      log(s, `${teamName(s, side)} can't reach ${d.bid} even taking every point`);
      endHand(s, 'short');
    }
  }
  const sideMeld = (s: S, side: number) => s.data.meld[side].points + s.data.meld[side + 2].points;

  function startPlay(s: S) {
    // meld goes back into the hands
    s.players.forEach((_, i) => {
      moveCards(s, `meld:${i}`, `hand:${i}`, ids(zone(s, `meld:${i}`)));
      sortHand(s, i);
    });
    s.phase = 'play';
    s.turn = s.data.bidder;
  }

  /** The card winning the trick so far (on equal cards the first played wins). */
  function winning(s: S): { id: string; by: number } | null {
    const trick = zone(s, 'trick').cards;
    if (!trick.length) return null;
    const trump = s.data.trump!;
    let best = trick[0];
    for (const c of trick.slice(1)) {
      const a = suitOf(c.id);
      const b = suitOf(best.id);
      if ((a === trump && b !== trump) || (a === b && power(c.id) > power(best.id))) best = c;
    }
    return { id: best.id, by: best.by! };
  }

  /** What `seat` may play: follow (and beat the winner if possible, unless trumped); void, trump (over if possible). */
  function legal(s: S, seat: number): string[] {
    const own = ids(hand(s, seat));
    const trick = zone(s, 'trick').cards;
    if (!trick.length) return own;
    const trump = s.data.trump!;
    const led = suitOf(trick[0].id);
    const best = winning(s)!;
    const follow = own.filter((c) => suitOf(c) === led);
    if (follow.length) {
      if (suitOf(best.id) !== led) return follow; // trumped already: any card of the suit
      const beat = follow.filter((c) => power(c) > power(best.id));
      return beat.length ? beat : follow;
    }
    const trumps = own.filter((c) => suitOf(c) === trump);
    if (trumps.length) {
      if (suitOf(best.id) !== trump) return trumps;
      const over = trumps.filter((c) => power(c) > power(best.id));
      return over.length ? over : trumps;
    }
    return own;
  }

  function collect(s: S) {
    const d = s.data;
    const w = winning(s)!;
    const cards = ids(zone(s, 'trick'));
    const pts = cards.filter(isCounter).length * 10 + (d.trickNo === 11 ? 10 : 0);
    const side = teamOf(w.by);
    d.taken[side] += pts;
    if (pts) d.tookPoints[side] = true;
    moveCards(s, 'trick', `won:${w.by}`, cards, { up: false });
    d.trickNo++;
    log(s, `${name(s, w.by)} takes the trick${pts ? ` (${pts})` : ''}${d.trickNo === 12 ? ' — and the last trick' : ''}`, w.by);
    if (d.trickNo === 12) return endHand(s, 'played');
    s.phase = 'play';
    s.turn = w.by;
  }

  /** Score the hand: played out, set short (meld can't reach the bid), or thrown in. */
  function endHand(s: S, how: 'played' | 'short' | 'thrown') {
    const d = s.data;
    const dec = teamOf(d.bidder!);
    const lines: string[] = [];
    for (const side of [dec, 1 - dec]) {
      const meld = sideMeld(s, side);
      const pts = d.taken[side];
      let delta: number;
      if (side === dec) {
        const made = how === 'played' && meld + pts >= d.bid!;
        delta = made ? meld + pts : -d.bid!;
        lines.push(`${teamName(s, side)} bid ${d.bid}: ${made ? `made it — meld ${meld} + ${pts}` : how === 'played' ? `set (${meld + pts})` : 'set'} → ${delta >= 0 ? '+' : ''}${delta}`);
      } else {
        // the other side saves its meld by taking a point (a meld of only dix always counts)
        const onlyDix = [side, side + 2].every((i) => d.meld[i].lines.every((l) => l.startsWith('Dix') || l.startsWith('Two dix')));
        const saved = how !== 'played' || d.tookPoints[side] || onlyDix;
        delta = saved ? meld + pts : 0;
        lines.push(`${teamName(s, side)}: ${saved ? `meld ${meld}${how === 'played' ? ` + ${pts}` : ''}` : 'took no points — meld lost'} → +${delta}`);
      }
      d.scores[side] += delta;
    }
    lines.push(`${teamName(s, 0)} ${d.scores[0]} · ${teamName(s, 1)} ${d.scores[1]}`);
    d.result = { lines };
    s.turn = null;
    log(s, lines[0]);
    // past the target: highest wins (both past it: the declaring side wins)
    const over = [0, 1].filter((t) => d.scores[t] >= target(s));
    if (over.length) {
      const win = over.length === 2 ? dec : over[0];
      s.winner = [win, win + 2];
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
  }

  // ---- bots ------------------------------------------------------------------------------

  /** Best trump for a hand, and what the hand is worth with it (meld plus a guess at its tricks). */
  function bestTrump(cards: string[]): { suit: Suit; value: number } {
    return SUITS.map((suit) => {
      const trumps = cards.filter((c) => suitOf(c) === suit).length;
      const aces = cards.filter((c) => parseCard(c).rank === 14).length;
      return { suit, value: meldOf(cards, suit).points + trumps * 12 + aces * 10 + 40 };
    }).sort((a, b) => b.value - a.value)[0];
  }

  function botBid(s: S, seat: number): Action {
    const d = s.data;
    const next = d.bid == null ? MIN_BID : d.bid + 10;
    // a partner's help is worth about 60 more; never outbid our own side
    const limit = bestTrump(ids(hand(s, seat))).value + 60;
    if (d.bidder != null && teamOf(d.bidder) === teamOf(seat) && next > MIN_BID + 50) return { type: 'pass' };
    return next <= limit ? { type: 'bid', amount: next } : { type: 'pass' };
  }

  function botPlay(s: S, seat: number): string {
    const options = legal(s, seat);
    const trump = s.data.trump!;
    const trick = zone(s, 'trick').cards;
    const cheapest = (cs: string[]) => [...cs].sort((a, b) => Number(isCounter(a)) - Number(isCounter(b)) || power(a) - power(b))[0];
    if (!trick.length) {
      // lead an ace of a side suit, else a low card
      const ace = options.find((c) => parseCard(c).rank === 14 && suitOf(c) !== trump);
      return ace ?? cheapest(options);
    }
    const best = winning(s)!;
    const ours = teamOf(best.by) === teamOf(seat);
    const beats = (c: string) => (suitOf(c) === suitOf(best.id) ? power(c) > power(best.id) : suitOf(c) === trump && suitOf(best.id) !== trump);
    // partner winning: give a counter; otherwise win as cheaply as possible, or throw the least
    if (ours) return [...options].sort((a, b) => Number(isCounter(b)) - Number(isCounter(a)) || power(a) - power(b))[0];
    const winners = options.filter(beats).sort((a, b) => power(a) - power(b));
    return winners[0] ?? cheapest(options);
  }

  const module: GameModule<PinochleData> = {
    config,

    setup(players, seed, options) {
      assertRule(players.length === 4, 'Partnership Pinochle is for 4 players');
      const s = createState<PinochleData>(config, players, seed, options, {
        handNo: 0,
        scores: [0, 0],
        bid: null,
        bidder: null,
        passed: [],
        trump: null,
        meld: [],
        taken: [0, 0],
        tookPoints: [false, false],
        trickNo: 0,
        result: null,
      });
      s.dealer = 3;
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.turn !== seat) return [];
      const own = ids(hand(s, seat));
      switch (s.phase) {
        case 'bid': {
          const min = d.bid == null ? MIN_BID : d.bid + 10;
          return [
            { type: 'bid', label: 'Bid', style: 'primary', amount: { min, max: 2000, step: 10, default: min } },
            { type: 'pass', label: 'Pass' },
          ];
        }
        case 'trump':
          return [{ type: 'trump', label: 'Name trumps', style: 'primary', choose: { label: 'Trumps', options: SUITS.map((x, i) => ({ value: i, label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` })) } }];
        case 'pass':
          return [{ type: 'give', label: `Pass 4 to ${name(s, d.bidder!)}`, style: 'primary', select: { min: 4, max: 4, cards: own } }];
        case 'return':
          return [{ type: 'give', label: `Pass 4 back to ${name(s, partner(seat))}`, style: 'primary', select: { min: 4, max: 4, cards: own } }];
        case 'meld':
          return [
            { type: 'play', label: 'Play the hand', style: 'primary' },
            { type: 'throwIn', label: 'Throw it in', style: 'quiet' },
          ];
        case 'play':
          return [{ type: 'card', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legal(s, seat) } }];
      }
      return [];
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Hand in progress');
          s.dealer = nextSeat(s, s.dealer);
          return startHand(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.scores = [0, 0];
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'bid': {
          assertRule(s.phase === 'bid', 'Not bidding now');
          const min = d.bid == null ? MIN_BID : d.bid + 10;
          const amount = a.amount ?? 0;
          assertRule(amount >= min && amount % 10 === 0, `Bid ${min} or more, in tens`);
          d.bid = amount;
          d.bidder = seat;
          log(s, `${who} bids ${amount}`, seat, `${amount}`);
          return afterBid(s, seat);
        }
        case 'pass': {
          assertRule(s.phase === 'bid', 'Not bidding now');
          d.passed[seat] = true;
          log(s, `${who} passes`, seat, 'Pass');
          return afterBid(s, seat);
        }
        case 'trump': {
          assertRule(s.phase === 'trump', 'Not now');
          const suit = SUITS[a.amount ?? -1];
          assertRule(suit, 'Choose a suit');
          d.trump = suit;
          s.players.forEach((_, i) => sortHand(s, i));
          log(s, `${who} names ${SUIT_NAME[suit].toLowerCase()} trumps`, seat, SUIT_SYMBOL[suit]);
          s.phase = 'pass';
          s.turn = partner(seat);
          return;
        }
        case 'give': {
          assertRule(s.phase === 'pass' || s.phase === 'return', 'Not now');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length === 4 && new Set(cards).size === 4 && cards.every((c) => own.includes(c)), 'Choose four cards');
          const to = partner(seat);
          moveCards(s, `hand:${seat}`, `hand:${to}`, cards);
          sortHand(s, to);
          log(s, `${who} passes four cards to ${name(s, to)}`, seat, 'Passed 4', to);
          if (s.phase === 'pass') {
            s.phase = 'return';
            s.turn = to;
            return;
          }
          return showMelds(s);
        }
        case 'play':
          assertRule(s.phase === 'meld', 'Not now');
          return startPlay(s);
        case 'throwIn':
          assertRule(s.phase === 'meld', 'Not now');
          log(s, `${who} throws the hand in`, seat, 'Throws in');
          return endHand(s, 'thrown');
        case 'card': {
          assertRule(s.phase === 'play', 'Not now');
          const card = a.cards?.[0];
          assertRule(card && legal(s, seat).includes(card), 'Follow suit and beat the trick if you can; trump (higher) if you can’t follow');
          moveCards(s, `hand:${seat}`, 'trick', [card], { up: true, by: seat });
          log(s, `${who} plays the ${label(card)}`, seat, label(card), undefined, { to: 'trick' });
          if (zone(s, 'trick').cards.length === 4) {
            s.phase = 'trickEnd';
            s.turn = null;
          } else s.turn = nextSeat(s, seat);
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    system(s) {
      if (s.phase === 'trickEnd') return { delay: 1200, run: collect };
      // a bot declarer leaves the meld on the table a few seconds for everyone to see
      if (s.phase === 'meld' && s.players[s.data.bidder!].bot) return { delay: 4000, run: startPlay };
      return null;
    },

    bot(s, seat) {
      const d = s.data;
      if (s.turn !== seat) return null;
      const own = ids(hand(s, seat));
      switch (s.phase) {
        case 'bid':
          return botBid(s, seat);
        case 'trump':
          return { type: 'trump', amount: SUITS.indexOf(bestTrump(own).suit) };
        case 'pass': {
          // give the declarer trumps and aces
          const trump = d.trump!;
          const give = [...own].sort((a, b) => Number(suitOf(b) === trump) * 10 + power(b) - (Number(suitOf(a) === trump) * 10 + power(a))).slice(0, 4);
          return { type: 'give', cards: give };
        }
        case 'return': {
          // keep meld and trumps; send back low side cards
          const keep = new Set(meldCards(own, d.trump!));
          const give = [...own]
            .sort((a, b) => Number(keep.has(a)) * 20 + Number(suitOf(a) === d.trump) * 10 + power(a) - (Number(keep.has(b)) * 20 + Number(suitOf(b) === d.trump) * 10 + power(b)))
            .slice(0, 4);
          return { type: 'give', cards: give };
        }
        case 'play':
          return { type: 'card', cards: [botPlay(s, seat)] };
      }
      return null;
    },

    standings(s) {
      return placesFromScores(s.players.map((_, i) => s.data.scores[teamOf(i)]));
    },

    status(s, viewer) {
      const d = s.data;
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline = '';
      const contract = d.bidder != null && d.bid != null ? `${name(s, d.bidder)} bid ${d.bid}${d.trump ? ` in ${SUIT_SYMBOL[d.trump]}` : ''}` : '';
      if (s.phase === 'bid') headline = s.turn === viewer ? `Your bid${d.bid ? ` — ${d.bid} to beat` : ` — at least ${MIN_BID}`}` : `${turnName} to bid${d.bid ? ` · ${d.bid} so far` : ''}`;
      else if (s.phase === 'trump') headline = s.turn === viewer ? 'You won the bid: name trumps' : `${turnName} is naming trumps`;
      else if (s.phase === 'pass') headline = s.turn === viewer ? `Pass four cards to ${name(s, d.bidder!)}` : `${turnName} is passing four cards`;
      else if (s.phase === 'return') headline = s.turn === viewer ? `Pass four cards back to ${name(s, partner(viewer))}` : `${turnName} is passing four back`;
      else if (s.phase === 'meld') headline = `${contract} · meld ${sideMeld(s, teamOf(d.bidder!))} — ${s.turn === viewer ? 'play it or throw it in' : `${turnName} decides`}`;
      else if (s.phase === 'play' || s.phase === 'trickEnd') headline = `${contract} · ${s.turn === viewer ? 'your turn' : s.turn != null ? `${turnName} to play` : ''}`;
      else headline = d.result?.lines[0] ?? '';
      return {
        headline,
        hint: viewer >= 0 && d.trump && s.phase !== 'handOver' && s.phase !== 'gameOver' ? `Your side: meld ${sideMeld(s, teamOf(viewer))}, points ${d.taken[teamOf(viewer)]}` : undefined,
        seats: s.players.map((_, i) => ({
          badge: [s.phase === 'bid' && d.passed[i] ? 'Passed' : d.bidder === i && d.bid ? `Bid ${d.bid}` : '', d.meld[i]?.points && s.phase !== 'bid' ? `meld ${d.meld[i].points}` : '']
            .filter(Boolean)
            .join(' · '),
          tag: i === s.dealer ? 'D' : undefined,
        })),
        scoreboard: {
          columns: ['Score'],
          rows: [0, 1].map((t) => ({ name: teamName(s, t), values: [d.scores[t]], highlight: !!s.winner?.includes(t) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${teamName(s, teamOf(s.winner![0]))} win!`, lines: d.result?.lines ?? [] }
            : s.phase === 'handOver'
              ? { title: 'Hand over', lines: d.result?.lines ?? [] }
              : s.phase === 'meld'
                ? { title: 'Meld', lines: s.players.map((_, i) => `${name(s, i)}: ${d.meld[i].lines.join(', ') || 'nothing'} = ${d.meld[i].points}`) }
                : undefined,
      };
    },
  };
  return module;
}
