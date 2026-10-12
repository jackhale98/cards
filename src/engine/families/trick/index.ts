import { buildDeck, cardName, parseCard, rankLabel, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../../cards';
import { PASS_WORDS, passTarget, type PassDirection } from '../../lib/passing';
import { followSuit, trickWinner } from '../../lib/trickTaking';
import { createState, deal, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, sortHand, zone } from '../../state';
import { botBudget, searchMove } from '../../bots/search';
import { trickBots } from './bots';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../../types';

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
 *              // or { "type": "exact", "bonus": 10 }    (Oh Hell: 1 a trick, +10 for an exact bid)
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
  lead?: 'twoOfClubs' | 'leftOfDealer' | 'maker';
  /**
   * `chosen` = trumps are decided by the bidding (euchre, 500); `turnUp` = a card turned up from the
   * stock (Oh Hell); `lastCard` = the dealer's own last card, shown until they play to the first
   * trick (Whist).
   */
  trump?: 'none' | Suit | 'turnUp' | 'chosen' | 'lastCard';
  breaks?: Suit;
  noPointsFirstTrick?: boolean;
  teams?: number[][];
  /** The jack of trumps (right bower) and the other jack of its colour (left bower) are the top trumps. */
  bowers?: boolean;
  /** A joker is the highest trump (in no trumps it beats everything and is played when void). */
  joker?: boolean;
  /** With a double pack, two identical cards in a trick: `later` (six-handed spades) or the first played (default) wins. */
  duplicates?: 'later' | 'first';
  /** Cards left over after the deal, taken by the bid winner (500) or turned up (euchre). */
  kitty?: number;
  bidding?:
    | { type?: 'tricks'; nil?: boolean; hook?: boolean }
    | { type: 'euchre'; stickTheDealer?: boolean; alone?: boolean }
    | { type: 'auction'; schedule: 'avondale'; misere?: boolean }
    | { type: 'bridge' };
  scoring:
    | { type: 'penalty'; cardPoints: Record<string, number>; moon?: boolean }
    /** `overtrick`: points for each trick over the bid (default +1, a bag; three-handed spades −10). */
    | { type: 'contract'; bags?: { every: number; penalty: number }; nil?: number; overtrick?: number }
    | { type: 'exact'; bonus: number }
    | { type: 'tricks' }
    /** Whist: the side taking more tricks scores one a trick over six (`honours` option: A K Q J of trumps). */
    | { type: 'whist' }
    /** `march` (all five tricks) and `euchred` (makers fail) score 2 unless given (six-handed: 3); alone, twice that. */
    | { type: 'euchre'; march?: number; euchred?: number }
    | { type: 'auction'; perTrick: number; slam?: number }
    | { type: 'bridge' };
  /** `loseAt`: a side at or below this score loses (500: −500). */
  end: { target?: number; lowWins?: boolean; rounds?: boolean; deals?: number; loseAt?: number };
}

export * from './contracts';
import { ALL_BIDS, bidLabel, bidOf, bridgeLabel, bridgeScore, contractLabel, MISERE, NAMEABLE, OPEN_MISERE, SAME_COLOUR, SUIT_BIDS, type BridgeContract, type Call, type Contract } from './contracts';

const label = (id: string) => (parseCard(id).suit === 'X' ? 'Joker' : `${rankLabel(parseCard(id).rank)}${SUIT_SYMBOL[parseCard(id).suit]}`);

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
  /** Euchre: the turned-up card; 1 = ordering it up, 2 = naming another suit. */
  upcard?: string | null;
  bidRound?: number;
  /** Seat that made trumps (euchre) or won the auction (500). */
  maker?: number | null;
  /** Partner of a player going alone (doesn't play this hand). */
  sittingOut?: number | null;
  /** Everyone sitting out (six-handed euchre: a lone player's two partners); `sittingOut` is the first. */
  outSeats?: number[];
  /** 500: an open misère hand on the table (after the first trick). */
  exposed?: number | null;
  /** 500: the winning bid so far / the contract, and who has passed. */
  contract?: Contract | null;
  passedOut?: boolean[];
  /** Euchre: how many players have passed in this bidding round. */
  declines?: number;
  /** Bridge: the auction so far, the final contract, the dummy, and who is vulnerable (per team). */
  calls?: { seat: number; call: Call }[];
  bridge?: BridgeContract | null;
  dummy?: number | null;
  dummyUp?: boolean;
  vul?: boolean[];
  /** Hearts: the moon shooter's choice — add 26 to everyone else or take 26 off their own score. */
  moon?: 'add' | 'sub' | null;
  /** Euchre: a defender playing alone (their partner sits out too). */
  defAlone?: number | null;
  defendAsked?: boolean;
  /** 500: the suit the contractor's joker belongs to in no trumps / misère (null = no suit). */
  jokerSuit?: Suit | null;
  jokerAsked?: boolean;
  /** 500: the suit called when a suitless joker is led, and the suits led so far this hand. */
  jokerLed?: Suit | null;
  ledSuits?: string[];
  /** Whist: the dealer's turned-up last card (showing until they play to the first trick). */
  trumpCard?: string | null;
  /** Whist honours: the side dealt three or four of A K Q J of trumps, and how many. */
  honours?: { team: number; count: number } | null;
  /** Spades: blind nil bidders this hand, and who still has to decide (before looking). */
  blind?: boolean[];
  blindToAsk?: number[];
  defToAsk?: number[];
  /** Suits each player has shown out of this hand (public: the search bot deals around them). */
  voids?: string[][];
}

type S = GameState<TrickData>;

export function trickTakingFamily(config: GameConfig): GameModule<TrickData> {
  const R = config.rules as unknown as TrickRules;
  const deckSize = buildDeck(config.deck).length;
  /**
   * The card that leads the first trick with `lead: twoOfClubs`: the lowest club dealt (the 3♣ when
   * the 2♣ is out of the deck, or is the card left over in three-handed spades).
   */
  const openerOf = (s: S) =>
    s.players
      .flatMap((_, i) => ids(hand(s, i)))
      .filter((c) => parseCard(c).suit === 'C')
      .sort((a, b) => parseCard(a).rank - parseCard(b).rank)[0];
  const pointsOf = (id: string) => {
    if (R.scoring.type !== 'penalty') return 0;
    const pts = R.scoring.cardPoints;
    return pts[id.split('#')[0]] ?? pts[parseCard(id).suit] ?? 0;
  };
  const totalPoints = buildDeck(config.deck).reduce((n, c) => n + pointsOf(c), 0);
  const teamsFor = (n: number) => R.teams?.filter((t) => t.every((s) => s < n)).length ? R.teams! : Array.from({ length: n }, (_, i) => [i]);
  /** A seat's partners (none when everyone plays for themselves). */
  const partnersOf = (s: S, seat: number) => (teamsFor(s.players.length).find((t) => t.includes(seat)) ?? [seat]).filter((x) => x !== seat);
  const teamOf = (s: S, seat: number) => teamsFor(s.players.length).findIndex((t) => t.includes(seat));
  const teamName = (s: S, team: number) => teamsFor(s.players.length)[team].map((i) => name(s, i)).join(' & ');
  const lowWins = !!R.end.lowWins;
  // which kind of bidding this game uses
  const trickBids = R.bidding && (!R.bidding.type || R.bidding.type === 'tricks') ? (R.bidding as { nil?: boolean; hook?: boolean }) : null;
  const euchreBids = R.bidding?.type === 'euchre' ? R.bidding : null;
  const auction = R.bidding?.type === 'auction' ? R.bidding : null;
  const bridgeBids = R.bidding?.type === 'bridge';
  const nilAllowed = !!trickBids?.nil;
  const target = (s: S) => Number(s.options.target ?? R.end.target ?? 100);

  function sizeForRound(s: S, round: number): number {
    const n = s.players.length;
    const all = Math.floor((deckSize - (R.trump === 'turnUp' ? 1 : 0) - (R.kitty ?? 0)) / n);
    if (!R.handSizes || R.handSizes === 'all') return Math.floor((deckSize - (R.kitty ?? 0)) / n);
    const seq = sequence(s);
    return Math.min(all, seq[round % seq.length]);
  }
  /** "ladder": from the most cards (as many as the deck allows, up to `maxHand`) down to one and back up. */
  function sequence(s: S): number[] {
    if (Array.isArray(R.handSizes)) return R.handSizes;
    const max = Math.min(Number(s.options.maxHand ?? R.maxHand ?? 99), Math.floor((deckSize - 1) / s.players.length));
    const down = Array.from({ length: max }, (_, i) => max - i);
    return [...down, ...down.slice(0, -1).reverse()];
  }
  const totalRounds = (s: S) => (R.end.rounds ? sequence(s).length : Infinity);

  function startRound(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, config);
    d.handSize = sizeForRound(s, d.round);
    deal(s, [{ to: 'hand', count: d.handSize }]);
    d.trump = R.trump && R.trump !== 'none' && R.trump !== 'turnUp' && R.trump !== 'chosen' && R.trump !== 'lastCard' ? R.trump : null;
    d.maker = null;
    d.sittingOut = null;
    d.outSeats = [];
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
    if (bridgeBids) {
      d.calls = [];
      d.bridge = null;
      d.dummy = null;
      d.dummyUp = false;
      // Chicago: nobody, dealer's side, dealer's side, everybody
      const k = d.round % 4;
      d.vul = teamsFor(n).map((t) => k === 3 || ((k === 1 || k === 2) && t.includes(s.dealer)));
    }
    if (euchreBids && zone(s, 'deck').cards.length) {
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
      teamsFor(n).forEach((t, ti) => {
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
    if (nilAllowed && s.options.blindNil) {
      // blind nil: players whose side is 100 or more behind decide before looking at their cards
      const best = Math.max(...d.scores);
      // (the blind bidder swaps cards with their partner: only with partners)
      const behind = (i: number) => d.scores[teamOf(s, i)] <= best - 100 && partnersOf(s, i).length === 1;
      d.blindToAsk = Array.from({ length: n }, (_, k) => (s.dealer + 1 + k) % n).filter(behind);
      for (const i of d.blindToAsk) for (const c of hand(s, i).cards) c.blind = true;
    }
    if (d.passDir && d.passDir !== 'hold') {
      s.phase = 'pass';
      s.turn = null;
    } else startBidding(s);
  }

  function startBidding(s: S) {
    if (!R.bidding) return startPlay(s);
    if (s.data.blindToAsk?.length) {
      s.phase = 'blind';
      s.turn = s.data.blindToAsk[0];
      return;
    }
    s.phase = euchreBids ? 'order' : auction ? 'auction' : bridgeBids ? 'call' : 'bid';
    // in bridge the dealer calls first
    s.turn = bridgeBids ? s.dealer : nextSeat(s, s.dealer);
    // a blind nil bid is already in
    if (s.phase === 'bid' && s.data.bids[s.turn] != null) s.turn = nextSeat(s, s.turn, (x) => s.data.bids[x] != null);
  }

  /** Look at your cards (passing on blind nil); then the next player behind decides, or bidding starts. */
  function lookAtCards(s: S, seat: number) {
    const d = s.data;
    for (const c of hand(s, seat).cards) delete c.blind;
    d.blindToAsk = d.blindToAsk!.filter((x) => x !== seat);
    if (d.blindToAsk.length) s.turn = d.blindToAsk[0];
    else startBidding(s);
  }

  function startPlay(s: S) {
    const d = s.data;
    s.phase = 'play';
    s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
    const opener = openerOf(s);
    const twoClubs = s.players.findIndex((_, i) => ids(hand(s, i)).includes(opener));
    if (R.lead === 'twoOfClubs' && twoClubs >= 0) s.turn = twoClubs;
    else if (R.lead === 'maker' && d.maker != null) s.turn = d.maker;
    else if (bridgeBids && d.maker != null) s.turn = nextSeat(s, d.maker); // left of the declarer leads
    else if (euchreBids && d.defAlone != null) s.turn = d.defAlone; // a lone defender leads
    else if (euchreBids && d.sittingOut != null) s.turn = nextActive(s, d.maker!); // left of a lone maker
    else s.turn = active(s, nextSeat(s, s.dealer)) ? nextSeat(s, s.dealer) : nextActive(s, nextSeat(s, s.dealer));
  }

  /**
   * Last questions before the first lead: in euchre a defender may go alone (when that option is
   * on); in 500 a contractor holding the joker in no trumps or misère may give it a suit.
   */
  function beforePlay(s: S) {
    const d = s.data;
    if (euchreBids?.alone && s.options.defendAlone && !d.defendAsked) {
      d.defendAsked = true;
      const defenders = [1, 2, 3, 4].map((k) => (s.dealer + k) % s.players.length).filter((i) => teamOf(s, i) !== teamOf(s, d.maker!));
      d.defToAsk = defenders;
      s.phase = 'defend';
      s.turn = defenders[0];
      return;
    }
    if (R.joker && !d.trump && !d.jokerAsked && d.maker != null && ids(hand(s, d.maker)).some((c) => parseCard(c).suit === 'X')) {
      d.jokerAsked = true;
      s.phase = 'joker';
      s.turn = d.maker;
      return;
    }
    startPlay(s);
  }

  /** Nobody wanted trumps / nobody bid: throw the hand in and deal again. */
  function redeal(s: S, why: string) {
    log(s, why);
    s.dealer = nextSeat(s, s.dealer);
    startRound(s);
  }

  /** Euchre: trumps are made. The dealer picks up the turned card (unless their partner goes alone). */
  function makeTrumps(s: S, seat: number, suit: Suit, alone: boolean, pickUp: boolean) {
    const d = s.data;
    d.trump = suit;
    d.maker = seat;
    if (alone) {
      // (with teams of three both partners sit out)
      d.outSeats = partnersOf(s, seat);
      d.sittingOut = d.outSeats[0] ?? null;
    }
    log(s, `${name(s, seat)} ${pickUp ? (seat === s.dealer ? 'picks it up' : 'orders it up') : `names ${SUIT_SYMBOL[suit]}`}${alone ? ' and goes alone' : ''}`, seat, `${SUIT_SYMBOL[suit]}${alone ? ' alone' : ''}`);
    if (pickUp && !d.outSeats?.includes(s.dealer)) {
      moveCards(s, 'upcard', `hand:${s.dealer}`, ids(zone(s, 'upcard')));
      s.phase = 'discard';
      s.turn = s.dealer;
      return;
    }
    moveCards(s, 'upcard', 'kitty', ids(zone(s, 'upcard')));
    beforePlay(s);
  }

  /** 500: the auction is over; the winner picks up the kitty and discards. */
  function winAuction(s: S, seat: number) {
    const d = s.data;
    d.maker = seat;
    d.trump = d.contract!.suit === 'NT' ? null : d.contract!.suit;
    // misère is played alone: partner's cards stay face down
    if (d.contract!.misere) {
      d.outSeats = partnersOf(s, seat);
      d.sittingOut = d.outSeats[0] ?? null;
    }
    log(s, `${name(s, seat)} wins the bid: ${contractLabel(d.contract!)} (${d.contract!.value})`, seat, contractLabel(d.contract!));
    moveCards(s, 'deck', `hand:${seat}`, ids(zone(s, 'deck')));
    sortHand(s, seat, { trump: d.trump });
    s.phase = 'discard';
    s.turn = seat;
  }

  // ---- bridge auction ----

  /** The last bid, who made it, and whether it has been doubled. */
  function auctionState(s: S) {
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
  const canDouble = (s: S, seat: number) => {
    const a = auctionState(s);
    return a.lastBid >= 0 && a.dbl === 0 && teamOf(s, a.bidder) !== teamOf(s, seat);
  };
  const canRedouble = (s: S, seat: number) => {
    const a = auctionState(s);
    return a.dbl === 1 && teamOf(s, a.bidder) === teamOf(s, seat);
  };
  const callLabel = (c: Call) => (typeof c === 'number' ? bidLabel(c) : c === 'P' ? 'Pass' : c === 'X' ? 'Double' : 'Redouble');

  /** After each call: four passes throws the deal in; three passes after a bid ends the auction. */
  function afterCall(s: S, seat: number) {
    const d = s.data;
    const calls = d.calls!;
    if (calls.length === 4 && calls.every((c) => c.call === 'P')) {
      log(s, 'All pass — new deal');
      return startRound(s); // same dealer, same vulnerability
    }
    const a = auctionState(s);
    if (a.lastBid >= 0 && calls.length >= 4 && calls.slice(-3).every((c) => c.call === 'P')) {
      const { level, strain } = bidOf(a.lastBid);
      const side = teamOf(s, a.bidder);
      // the declarer is whoever on that side named the strain first
      const declarer = calls.find((c) => typeof c.call === 'number' && bidOf(c.call).strain === strain && teamOf(s, c.seat) === side)!.seat;
      d.bridge = { level, strain, dbl: a.dbl };
      d.maker = declarer;
      d.dummy = (declarer + 2) % s.players.length;
      d.trump = strain === 'NT' ? null : strain;
      log(s, `${name(s, declarer)} declares ${bridgeLabel(d.bridge)}`, declarer, bridgeLabel(d.bridge, true));
      return startPlay(s);
    }
    s.turn = nextSeat(s, seat);
  }

  /** Who acts on the current turn: the declarer plays for the dummy once it's on the table. */
  const controller = (s: S) => (s.turn != null && s.data.dummyUp && s.turn === s.data.dummy ? s.data.maker! : s.turn);
  /** Where a seat plays from: its hand, or the table (a bridge dummy / an open misère hand). */
  const sourceZone = (s: S, seat: number) => ((s.data.dummyUp && seat === s.data.dummy) || s.data.exposed === seat ? 'dummy' : `hand:${seat}`);

  /** Bids still open to `seat` in a 500 auction. */
  /** Bids that may be made now: higher-ranked, with misère only once someone has bid seven. */
  const higherBids = (s: S) => {
    const cur = s.data.contract;
    const at = cur ? ALL_BIDS.indexOf(cur) : -1;
    return ALL_BIDS.filter((b, i) => i > at && (!b.misere || (auction?.misere && (b.misere === 'open' || cur?.tricks === 7))));
  };
  const isMisere = (s: S) => !!s.data.contract?.misere && s.data.maker != null;

  /** The suit a card belongs to this hand: the left bower is a trump, a joker is trump (or its own suit in no trumps). */
  function suitFor(id: string, trump: Suit | null): string {
    const c = parseCard(id);
    if (c.suit === 'X') return trump ?? 'X';
    if (R.bowers && trump && c.rank === 11 && c.suit === SAME_COLOUR[trump]) return trump;
    return c.suit;
  }

  function rankFor(id: string, trump: Suit | null): number {
    const c = parseCard(id);
    if (c.suit === 'X') return 30;
    if (R.bowers && trump && c.rank === 11) {
      if (c.suit === trump) return 25; // right bower
      if (c.suit === SAME_COLOUR[trump]) return 24; // left bower
    }
    return c.rank;
  }

  const suitOf = (s: S, id: string) => (!s.data.trump && s.data.jokerSuit && parseCard(id).suit === 'X' ? s.data.jokerSuit : suitFor(id, s.data.trump));
  /** A joker with no suit (no trumps, not nominated): it wins any trick and is led by calling a suit. */
  const suitless = (s: S, id: string) => parseCard(id).suit === 'X' && suitOf(s, id) === 'X';
  /** The suit everyone must follow: a led suitless joker calls one. */
  const ledSuit = (s: S) => {
    const first = zone(s, 'trick').cards[0];
    return first && suitless(s, first.id) ? (s.data.jokerLed ?? 'X') : first ? suitOf(s, first.id) : null;
  };
  /** 500: a suitless joker may be led (calling a suit not yet led) until all four suits have been led, and always to the last trick. */
  const jokerLeadSuits = (s: S): Suit[] => {
    const d = s.data;
    const last = d.trickNo === d.handSize - 1;
    const open = NAMEABLE.filter((x) => !d.ledSuits?.includes(x));
    return open.length ? open : last ? NAMEABLE : [];
  };
  const rankOf = (s: S, id: string) => rankFor(id, s.data.trump);

  /** Seats taking part this hand, in turn order from `seat` (someone going alone leaves their partner out). */
  const active = (s: S, seat: number) =>
    // (a game saved before outSeats only has sittingOut)
    s.data.sittingOut !== seat &&
    !s.data.outSeats?.includes(seat) &&
    !(s.data.defAlone != null && partnersOf(s, s.data.defAlone).includes(seat));
  const playersThisHand = (s: S) => s.players.filter((p) => active(s, p.seat)).length;
  const nextActive = (s: S, seat: number) => nextSeat(s, seat, (x) => !active(s, x));

  function legalCards(s: S, seat: number): string[] {
    let cards = ids(zone(s, sourceZone(s, seat)));
    const trick = zone(s, 'trick').cards;
    const d = s.data;
    if (trick.length === 0) {
      if (d.trickNo === 0 && R.lead === 'twoOfClubs' && cards.includes(openerOf(s))) return [openerOf(s)];
      // a suitless joker is led with its own action, which calls a suit
      cards = cards.filter((c) => !suitless(s, c));
      if (R.breaks && !d.broken) {
        const safe = cards.filter((c) => parseCard(c).suit !== R.breaks);
        if (safe.length) return safe;
      }
      return cards;
    }
    const led = ledSuit(s)!;
    const legal = followSuit(cards, led as Suit, (c) => suitOf(s, c) as Suit);
    // misère: a player who can't follow suit must play a suitless joker
    const joker = cards.find((c) => suitless(s, c));
    if (isMisere(s) && joker && !cards.some((c) => suitOf(s, c) === led)) return [joker];
    if (d.trickNo === 0 && R.noPointsFirstTrick) {
      const clean = legal.filter((c) => !pointsOf(c));
      if (clean.length) return clean;
    }
    return legal;
  }

  function currentWinner(s: S) {
    const trick = zone(s, 'trick').cards;
    if (!trick.length) return null;
    // the joker is the top trump; with no trumps and no suit it beats everything
    const joker = trick.find((c) => parseCard(c.id).suit === 'X');
    if (joker && (s.data.trump || suitless(s, joker.id))) return joker;
    // a led suitless joker has been handled above; otherwise the led card's suit is the one to beat
    return trick[trickWinner(trick, { trump: s.data.trump, suitOf: (c) => suitOf(s, c), rankOf: (c) => rankOf(s, c), laterWinsTies: R.duplicates === 'later' })];
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
    d.jokerLed = null;
    if (d.trickNo === d.handSize) return endRound(s);
    if (isMisere(s) && winner === d.maker) {
      log(s, `${name(s, winner)} has taken a trick — the misère fails`);
      return endRound(s);
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

  /** Points each team earns this round. */
  function roundScores(s: S): { deltas: number[]; lines: string[] } {
    const d = s.data;
    const teams = teamsFor(s.players.length);
    const lines: string[] = [];
    const sc = R.scoring;
    const deltas = teams.map(() => 0);
    if (sc.type === 'penalty') {
      const shooter = sc.moon ? d.points.findIndex((p) => p === totalPoints && p > 0) : -1;
      const sub = shooter >= 0 && d.moon === 'sub';
      if (shooter >= 0) lines.push(`🌙 ${name(s, shooter)} shot the moon${sub ? ` and takes ${totalPoints} off` : ''}!`);
      teams.forEach((t, ti) => {
        deltas[ti] = shooter >= 0 ? (t.includes(shooter) ? (sub ? -totalPoints : 0) : sub ? 0 : totalPoints) : t.reduce((n, i) => n + d.points[i], 0);
      });
    } else if (sc.type === 'tricks') {
      teams.forEach((t, ti) => (deltas[ti] = t.reduce((n, i) => n + d.tricks[i], 0)));
    } else if (sc.type === 'whist') {
      // the side with more tricks scores one for each over six (the "book")
      const won = teams.map((t) => t.reduce((n, i) => n + d.tricks[i], 0));
      const best = won.indexOf(Math.max(...won));
      deltas[best] = won[best] - 6;
      lines.push(`${teamName(s, best)} take ${won[best]} tricks: ${won[best] - 6} over the book`);
      // honours (an option): 4 for all of A K Q J of trumps, 2 for three — not for a side already at 4
      const h = d.honours;
      if (s.options.honours && h && d.scores[h.team] < target(s) - 1) {
        const pts = h.count === 4 ? 4 : 2;
        deltas[h.team] += pts;
        lines.push(`${teamName(s, h.team)} held ${h.count} honours: +${pts}`);
      }
    } else if (sc.type === 'exact') {
      teams.forEach((t, ti) => {
        // a point a trick plus the bonus for an exact bid (or, with `exactOnly`, nothing for a miss)
        for (const i of t) deltas[ti] += d.tricks[i] === d.bids[i] ? d.tricks[i] + sc.bonus : s.options.exactOnly ? 0 : d.tricks[i];
      });
    } else if (sc.type === 'euchre') {
      const makers = teamOf(s, d.maker!);
      const won = teams[makers].reduce((n, i) => n + d.tricks[i], 0);
      const alone = d.sittingOut != null;
      const march = sc.march ?? 2;
      const euchred = sc.euchred ?? 2;
      if (won >= 3) {
        deltas[makers] = won === 5 ? (alone ? march * 2 : march) : 1;
        lines.push(`${teamName(s, makers)} make it${won === 5 ? (alone ? ' — a loner march!' : ' — march!') : ''} (${won} tricks)`);
      } else {
        // a lone defender who euchres the makers scores 4
        deltas[1 - makers] = d.defAlone != null ? euchred * 2 : euchred;
        lines.push(`${teamName(s, makers)} are euchred${d.defAlone != null ? ` by ${name(s, d.defAlone)} alone` : ''}! (${won} tricks)`);
      }
    } else if (sc.type === 'bridge') {
      const c = d.bridge!;
      const side = teamOf(s, d.maker!);
      const won = teams[side].reduce((n, i) => n + d.tricks[i], 0);
      const pts = bridgeScore(c, !!d.vul?.[side], won);
      if (pts >= 0) deltas[side] = pts;
      else deltas[1 - side] = -pts;
      const diff = won - c.level - 6;
      lines.push(
        `${name(s, d.maker!)} ${diff >= 0 ? `made ${bridgeLabel(c)}${diff ? ` +${diff}` : ''}` : `went down ${-diff} in ${bridgeLabel(c)}`}${d.vul?.[side] ? ' (vulnerable)' : ''}`,
      );
    } else if (sc.type === 'auction') {
      const c = d.contract!;
      const makers = teamOf(s, d.maker!);
      if (c.misere) {
        // the contractor alone must take nothing; the opponents score nothing either way
        const made = d.tricks[d.maker!] === 0;
        deltas[makers] = made ? c.value : -c.value;
        lines.push(`${name(s, d.maker!)} ${made ? 'makes' : 'fails'} ${contractLabel(c)}: ${made ? '+' : '−'}${c.value}`);
        return { deltas, lines };
      }
      teams.forEach((t, ti) => {
        const won = t.reduce((n, i) => n + d.tricks[i], 0);
        if (ti === makers) {
          const made = won >= c.tricks;
          const value = made && won === 10 && c.value < (sc.slam ?? 250) ? (sc.slam ?? 250) : c.value;
          deltas[ti] = made ? value : -c.value;
          lines.push(`${teamName(s, ti)} ${made ? 'make' : 'go down on'} ${contractLabel(c)} with ${won} tricks: ${made ? '+' : '−'}${Math.abs(deltas[ti])}`);
        } else {
          deltas[ti] = won * sc.perTrick;
          lines.push(`${teamName(s, ti)}: ${won} tricks, +${deltas[ti]}`);
        }
      });
    } else {
      // contract (spades-style): team bid vs team tricks, nil bids scored separately
      const nilBonus = (sc as { nil?: number }).nil ?? 100;
      teams.forEach((t, ti) => {
        let bid = 0;
        let won = 0;
        // tricks taken by a failed nil don't help the partner's bid, but they are still bags
        let nilBags = 0;
        for (const i of t) {
          if (d.bids[i] === 0 && nilAllowed) {
            const ok = d.tricks[i] === 0;
            const worth = d.blind?.[i] ? nilBonus * 2 : nilBonus;
            deltas[ti] += ok ? worth : -worth;
            nilBags += d.tricks[i];
            lines.push(`${name(s, i)} ${ok ? 'made' : 'failed'} ${d.blind?.[i] ? 'blind nil' : 'nil'}`);
          } else {
            bid += d.bids[i] ?? 0;
            won += d.tricks[i];
          }
        }
        let newBags = nilBags;
        if (bid > 0 || won > 0) {
          if (won >= bid) {
            deltas[ti] += bid * 10;
            newBags += won - bid;
          } else deltas[ti] -= bid * 10;
        }
        deltas[ti] += newBags * ((sc as { overtrick?: number }).overtrick ?? 1);
        d.bags[ti] += newBags;
        const bags = (sc as { bags?: { every: number; penalty: number } }).bags;
        while (bags && d.bags[ti] >= bags.every) {
          d.bags[ti] -= bags.every;
          deltas[ti] -= bags.penalty;
          lines.push(`${teamName(s, ti)}: ${bags.every} bags, −${bags.penalty}`);
        }
      });
    }
    return { deltas, lines };
  }

  function endRound(s: S) {
    const d = s.data;
    if (R.scoring.type === 'penalty' && R.scoring.moon && d.moon == null) {
      const shooter = d.points.findIndex((p) => p === totalPoints && p > 0);
      if (shooter >= 0) {
        // the shooter chooses: everyone else +26, or 26 off their own score
        s.phase = 'moon';
        s.turn = shooter;
        return;
      }
    }
    const { deltas, lines } = roundScores(s);
    deltas.forEach((v, ti) => (d.scores[ti] += v));
    teamsFor(s.players.length).forEach((_, ti) =>
      lines.push(`${teamName(s, ti)}: ${deltas[ti] >= 0 ? '+' : ''}${deltas[ti]} → ${d.scores[ti]}`),
    );
    d.result = { lines };
    s.turn = null;
    if (auction) return endAuctionRound(s, deltas, lines);
    const best = lowWins ? Math.min(...d.scores) : Math.max(...d.scores);
    const reached = R.end.deals
      ? d.round + 1 >= Number(s.options.deals ?? R.end.deals)
      : R.end.rounds
      ? d.round + 1 >= totalRounds(s)
      : lowWins
        ? Math.max(...d.scores) >= target(s)
        : best >= target(s);
    const tied = d.scores.filter((x) => x === best).length > 1;
    if (reached && tied && !lowWins && !R.end.rounds && !R.end.deals) {
      // sides level at the top: play another hand to settle it
      lines.push(`Level at ${best} — play another hand`);
      s.phase = 'roundOver';
    } else if (reached) {
      const teams = teamsFor(s.players.length);
      s.winner = teams.flatMap((t, ti) => (d.scores[ti] === best ? t : []));
      s.phase = 'gameOver';
    } else s.phase = 'roundOver';
  }

  /**
   * 500: a side wins by reaching the target with a successful bid (unless the `bidToWin` option is
   * off, when any side reaching it wins); a side at the `loseAt` score loses.
   */
  function endAuctionRound(s: S, deltas: number[], lines: string[]) {
    const d = s.data;
    const teams = teamsFor(s.players.length);
    const makers = teamOf(s, d.maker!);
    const bidToWin = s.options.bidToWin ?? true;
    let winners: number[] = [];
    if (deltas[makers] > 0 && d.scores[makers] >= target(s)) winners = [makers];
    else if (!bidToWin) {
      const best = Math.max(...d.scores);
      if (best >= target(s)) winners = teams.map((_, ti) => ti).filter((ti) => d.scores[ti] === best);
    }
    const loseAt = R.end.loseAt;
    if (!winners.length && loseAt != null && d.scores.some((x) => x <= loseAt)) {
      winners = teams.map((_, ti) => ti).filter((ti) => d.scores[ti] > loseAt);
      for (const ti of teams.keys()) if (d.scores[ti] <= loseAt) lines.push(`${teamName(s, ti)} go out the back door at ${d.scores[ti]}`);
    }
    if (bidToWin && !winners.length && d.scores.some((x, ti) => x >= target(s) && ti !== makers)) lines.push(`(A side has to make a bid to win — reaching ${target(s)} on defence isn't enough)`);
    if (winners.length) {
      s.winner = winners.flatMap((ti) => teams[ti]);
      s.phase = 'gameOver';
    } else s.phase = 'roundOver';
  }

  // ---- bots (./bots.ts): the quick rule-of-thumb bot, and the search bot's view of a hand
  function dirLabel(s: S, seat: number) {
    const to = passTarget(seat, s.data.passDir!, s.players.length);
    return `${PASS_WORDS[s.data.passDir!]} → ${name(s, to)}`;
  }

  const { quickBot, search, botBid } = trickBots({
    R,
    get module() {
      return module;
    },
    teamsFor, teamOf, target, lowWins, totalPoints, pointsOf, euchreBids, auction, trickBids, nilAllowed, suitFor, rankFor, suitOf, rankOf, legalCards, jokerLeadSuits, currentWinner, controller, higherBids, isMisere, auctionState, canDouble,
  });

  const module: GameModule<TrickData> = {
    config,
    botLevels: true,

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
          amount: { min: 0, max: d.handSize, step: 1, default: botBid(s, seat), label: nilAllowed ? 'tricks (0 = nil)' : 'tricks' },
        });
      } else if (s.phase === 'order' && s.turn === seat) {
        const up = label(d.upcard!);
        out.push({ type: 'order', label: seat === s.dealer ? `Pick up ${up}` : `Order up ${up}`, style: 'primary' });
        if (euchreBids?.alone) out.push({ type: 'orderAlone', label: 'Go alone' });
        out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
      } else if (s.phase === 'name' && s.turn === seat) {
        const options = NAMEABLE.filter((x) => x !== parseCard(d.upcard!).suit).map((x) => ({ value: NAMEABLE.indexOf(x), label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` }));
        out.push({ type: 'name', label: 'Name trumps', style: 'primary', choose: { label: 'Trumps', options } });
        if (euchreBids?.alone) out.push({ type: 'nameAlone', label: 'Name & go alone', choose: { label: 'Trumps — going alone', options } });
        if (!(euchreBids?.stickTheDealer && seat === s.dealer)) out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
      } else if (s.phase === 'auction' && s.turn === seat) {
        const open = higherBids(s);
        // suit bids in whole rows of five (bids already passed greyed out); misère gets its own buttons
        const first = open.find((b) => !b.misere);
        const options = first
          ? SUIT_BIDS.filter((b) => b.tricks >= first.tricks).map((b) => ({ value: ALL_BIDS.indexOf(b), label: `${contractLabel(b)} · ${b.value}`, disabled: !open.includes(b) }))
          : [];
        if (first) out.push({ type: 'bid500', label: 'Bid', style: 'primary', choose: { label: d.contract ? `Bid over ${contractLabel(d.contract)}` : 'Your bid', options } });
        if (open.includes(MISERE)) out.push({ type: 'misere', label: 'Misère · 250' });
        if (open.includes(OPEN_MISERE)) out.push({ type: 'openMisere', label: 'Open misère · 500' });
        out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
      } else if (s.phase === 'call' && s.turn === seat) {
        const a = auctionState(s);
        // whole levels, one per row (♣ ♦ ♥ ♠ NT), with bids already passed greyed out
        const options = Array.from({ length: 35 }, (_, i) => i)
          .filter((i) => i >= Math.floor((a.lastBid + 1) / 5) * 5)
          .map((i) => ({ value: i, label: bidLabel(i), disabled: i <= a.lastBid }));
        if (a.lastBid < 34) out.push({ type: 'call', label: 'Bid', style: 'primary', choose: { label: a.lastBid >= 0 ? `Bid over ${bidLabel(a.lastBid)}` : 'Your bid', options } });
        if (canDouble(s, seat)) out.push({ type: 'double', label: 'Double' });
        if (canRedouble(s, seat)) out.push({ type: 'redouble', label: 'Redouble' });
        out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
      } else if (s.phase === 'discard' && s.turn === seat) {
        const k = auction ? (R.kitty ?? 3) : 1;
        out.push({ type: 'bury', label: k > 1 ? `Discard ${k}` : 'Discard', style: 'primary', select: { min: k, max: k, cards: ids(hand(s, seat)) } });
      } else if (s.phase === 'play' && controller(s) === seat) {
        const fromDummy = s.turn !== seat;
        const legal = legalCards(s, s.turn!);
        if (legal.length) out.push({ type: 'play', label: fromDummy ? 'Play from dummy' : 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legal } });
        const joker = ids(zone(s, sourceZone(s, s.turn!))).find((c) => suitless(s, c));
        if (joker && !zone(s, 'trick').cards.length && jokerLeadSuits(s).length)
          out.push({
            type: 'leadJoker',
            label: 'Lead the joker',
            style: legal.length ? undefined : 'primary',
            choose: { label: 'Call a suit for the others to follow', options: jokerLeadSuits(s).map((x) => ({ value: NAMEABLE.indexOf(x), label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` })) },
          });
      } else if (s.phase === 'blind' && s.turn === seat) {
        out.push({ type: 'blindNil', label: `Bid blind nil · ${((R.scoring as { nil?: number }).nil ?? 100) * 2}`, style: 'danger' });
        out.push({ type: 'look', label: 'Look at my cards', style: 'primary' });
      } else if (s.phase === 'blindPass' && s.turn === seat) {
        out.push({ type: 'blindGive', label: `Give 2 to ${name(s, (seat + 2) % s.players.length)}`, style: 'primary', select: { min: 2, max: 2, cards: ids(hand(s, seat)) } });
      } else if (s.phase === 'blindReturn' && s.turn === seat) {
        out.push({ type: 'blindGive', label: `Give 2 back to ${name(s, (seat + 2) % s.players.length)}`, style: 'primary', select: { min: 2, max: 2, cards: ids(hand(s, seat)) } });
      } else if (s.phase === 'defend' && s.turn === seat) {
        out.push({ type: 'defendAlone', label: 'Defend alone' });
        out.push({ type: 'stayIn', label: 'Play with partner', style: 'primary' });
      } else if (s.phase === 'joker' && s.turn === seat) {
        const options = NAMEABLE.map((x) => ({ value: NAMEABLE.indexOf(x), label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` }));
        // in misère an un-nominated joker would make the bid fail, so a suit must be chosen
        if (!d.contract?.misere) options.push({ value: 4, label: 'No suit (wins any trick; play it only when void)' });
        out.push({ type: 'nominate', label: 'Joker’s suit', style: 'primary', choose: { label: 'The joker counts as the top card of', options } });
      } else if (s.phase === 'moon' && s.turn === seat) {
        out.push({ type: 'moonSub', label: `Take ${totalPoints} off my score`, style: 'primary' });
        out.push({ type: 'moonAdd', label: `Give everyone else ${totalPoints}` });
      } else if (s.phase === 'roundOver') {
        out.push({ type: 'next', label: 'Next hand', style: 'primary' });
      } else if (s.phase === 'gameOver') {
        out.push({ type: 'rematch', label: 'New game', style: 'primary' });
      }
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
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
            log(s, `Cards passed ${PASS_WORDS[d.passDir!]}`);
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
          if (trickBids?.hook && seat === s.dealer) {
            const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
            assertRule(others + bid !== d.handSize, `The dealer can’t bid ${bid}: total bids can’t equal ${d.handSize}`);
          }
          d.bids[seat] = bid;
          const bidText = bid === 0 && nilAllowed ? 'nil' : String(bid);
          log(s, `${name(s, seat)} bids ${bidText}`, seat, `Bid ${bidText}`);
          if (d.bids.every((b) => b != null)) startPlay(s);
          else s.turn = nextSeat(s, seat, (x) => d.bids[x] != null);
          return;
        }
        case 'order':
        case 'orderAlone':
          assertRule(s.phase === 'order' && s.turn === seat, 'Not your turn');
          return makeTrumps(s, seat, parseCard(d.upcard!).suit as Suit, a.type === 'orderAlone', true);
        case 'name':
        case 'nameAlone': {
          assertRule(s.phase === 'name' && s.turn === seat, 'Not your turn');
          const suit = NAMEABLE[a.amount ?? -1];
          assertRule(suit && suit !== parseCard(d.upcard!).suit, 'Choose a different suit from the turned-down card');
          return makeTrumps(s, seat, suit, a.type === 'nameAlone', false);
        }
        case 'misere':
        case 'openMisere':
        case 'bid500': {
          assertRule(s.phase === 'auction' && s.turn === seat, 'Not your turn to bid');
          const bid = a.type === 'misere' ? MISERE : a.type === 'openMisere' ? OPEN_MISERE : ALL_BIDS[a.amount ?? -1];
          assertRule(bid && higherBids(s).includes(bid), bid?.misere === 'closed' ? 'Misère can only be bid over a seven' : 'Bid higher than the current bid');
          d.contract = bid;
          d.maker = seat;
          log(s, `${who} bids ${contractLabel(bid)} (${bid.value})`, seat, contractLabel(bid));
          const still = s.players.map((_, i) => i).filter((i) => !d.passedOut![i]);
          if (still.length === 1) return winAuction(s, seat);
          s.turn = nextSeat(s, seat, (x) => d.passedOut![x]);
          return;
        }
        case 'call': {
          assertRule(s.phase === 'call' && s.turn === seat, 'Not your turn to bid');
          const bid = Math.floor(a.amount ?? -1);
          assertRule(bid >= 0 && bid < 35 && bid > auctionState(s).lastBid, 'Bid higher than the last bid');
          d.calls!.push({ seat, call: bid });
          log(s, `${who} bids ${bidLabel(bid)}`, seat, bidLabel(bid));
          return afterCall(s, seat);
        }
        case 'double':
        case 'redouble': {
          const x = a.type === 'double';
          assertRule(s.phase === 'call' && s.turn === seat, 'Not your turn');
          assertRule(x ? canDouble(s, seat) : canRedouble(s, seat), x ? 'You can only double an opponent’s bid' : 'You can only redouble a double of your side’s bid');
          d.calls!.push({ seat, call: x ? 'X' : 'XX' });
          log(s, `${who} ${x ? 'doubles' : 'redoubles'}`, seat, x ? 'Double' : 'Redouble');
          return afterCall(s, seat);
        }
        case 'decline': {
          if (s.phase === 'call') {
            assertRule(s.turn === seat, 'Not your turn');
            d.calls!.push({ seat, call: 'P' });
            log(s, `${who} passes`, seat, 'Pass');
            return afterCall(s, seat);
          }
          assertRule(s.turn === seat && (s.phase === 'order' || s.phase === 'name' || s.phase === 'auction'), 'Not your turn');
          log(s, `${who} passes`, seat, 'Pass');
          if (s.phase === 'auction') {
            d.passedOut![seat] = true;
            const still = s.players.map((_, i) => i).filter((i) => !d.passedOut![i]);
            if (d.contract && still.length === 1 && still[0] === d.maker) return winAuction(s, d.maker!);
            if (!still.length) return redeal(s, 'Nobody bid — new deal');
            s.turn = nextSeat(s, seat, (x) => d.passedOut![x]);
            return;
          }
          assertRule(!(s.phase === 'name' && euchreBids?.stickTheDealer && seat === s.dealer), 'The dealer is stuck: name trumps');
          d.declines = (d.declines ?? 0) + 1;
          if (d.declines < s.players.length) {
            s.turn = nextSeat(s, seat);
            return;
          }
          if (s.phase === 'name') return redeal(s, 'Everyone passed — new deal');
          // round two: the card is turned down and any other suit may be named
          d.declines = 0;
          d.bidRound = 2;
          for (const c of zone(s, 'upcard').cards) c.up = false;
          log(s, `The ${cardName(d.upcard!)} is turned down`);
          s.phase = 'name';
          s.turn = nextSeat(s, s.dealer);
          return;
        }
        case 'bury': {
          assertRule(s.phase === 'discard' && s.turn === seat, 'Not your turn');
          const k = auction ? (R.kitty ?? 3) : 1;
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length === k && new Set(cards).size === k && cards.every((c) => own.includes(c)), `Choose ${k} card${k > 1 ? 's' : ''} to discard`);
          moveCards(s, `hand:${seat}`, 'kitty', cards);
          log(s, `${who} discards ${k > 1 ? `${k} cards` : 'a card'}`, seat, 'Discarded', undefined, { to: 'kitty' });
          return beforePlay(s);
        }
        case 'play': {
          assertRule(s.phase === 'play' && controller(s) === seat, 'Not your turn');
          // the declarer plays the dummy's cards on the dummy's turn
          const turn = s.turn!;
          const card = a.cards?.[0];
          assertRule(card && legalCards(s, turn).includes(card), 'You can’t play that card');
          if (!zone(s, 'trick').cards.length) d.ledSuits = [...(d.ledSuits ?? []), suitOf(s, card)];
          else {
            // not following suit shows the player is out of it
            const led = ledSuit(s);
            const voids = (d.voids ??= s.players.map(() => []));
            if (led && led !== 'X' && suitOf(s, card) !== led && !voids[turn].includes(led)) voids[turn] = [...voids[turn], led];
          }
          moveCards(s, sourceZone(s, turn), 'trick', [card], { by: turn, up: true });
          // Whist: the dealer takes the turned-up trump back into hand on playing to the first trick
          if (d.trumpCard && turn === s.dealer) {
            const shown = hand(s, s.dealer).cards.find((c) => c.id === d.trumpCard);
            if (shown) shown.up = false;
            d.trumpCard = null;
          }
          d.received[turn] = [];
          log(s, `${name(s, seat)} plays the ${cardName(card)}${turn !== seat ? ' from dummy' : ''}`, seat, `${rankLabel(parseCard(card).rank)}${SUIT_SYMBOL[parseCard(card).suit]}`);
          if (bridgeBids && !d.dummyUp) {
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
          if (zone(s, 'trick').cards.length === playersThisHand(s)) {
            s.phase = 'trickEnd';
            s.turn = null;
          } else s.turn = nextActive(s, turn);
          return;
        }
        case 'leadJoker': {
          assertRule(s.phase === 'play' && controller(s) === seat && !zone(s, 'trick').cards.length, 'Not your lead');
          const turn = s.turn!;
          const joker = ids(zone(s, sourceZone(s, turn))).find((c) => suitless(s, c));
          const suit = NAMEABLE[a.amount ?? -1];
          assertRule(joker && suit && jokerLeadSuits(s).includes(suit), 'Call a suit that hasn’t been led yet');
          d.jokerLed = suit;
          d.ledSuits = [...(d.ledSuits ?? []), suit];
          moveCards(s, sourceZone(s, turn), 'trick', [joker], { by: turn, up: true });
          log(s, `${name(s, seat)} leads the joker and calls ${SUIT_SYMBOL[suit]}`, seat, `Joker → ${SUIT_SYMBOL[suit]}`);
          s.turn = nextActive(s, turn);
          return;
        }
        case 'nominate': {
          assertRule(s.phase === 'joker' && s.turn === seat, 'Not your turn');
          const suit = a.amount === 4 && !d.contract?.misere ? null : NAMEABLE[a.amount ?? -1];
          assertRule(suit !== undefined, 'Choose a suit');
          d.jokerSuit = suit;
          log(s, suit ? `${who}’s joker is the top ${SUIT_NAME[suit].toLowerCase().replace(/s$/, '')}` : `${who}’s joker has no suit`, seat, suit ? `Joker ${SUIT_SYMBOL[suit]}` : 'Joker');
          s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
          return startPlay(s);
        }
        case 'defendAlone':
        case 'stayIn': {
          assertRule(s.phase === 'defend' && s.turn === seat, 'Not your turn');
          d.defToAsk = (d.defToAsk ?? []).filter((x) => x !== seat);
          if (a.type === 'defendAlone') {
            d.defAlone = seat;
            d.defToAsk = [];
            log(s, `${who} defends alone`, seat, 'Alone');
          }
          if (d.defToAsk.length) s.turn = d.defToAsk[0];
          else beforePlay(s);
          return;
        }
        case 'blindNil':
        case 'look': {
          assertRule(s.phase === 'blind' && s.turn === seat, 'Not your turn');
          if (a.type === 'look') return lookAtCards(s, seat);
          const partner = partnersOf(s, seat)[0];
          d.blind![seat] = true;
          d.bids[seat] = 0;
          log(s, `${who} bids blind nil!`, seat, 'Blind nil');
          // the partner looks at their cards and passes two across; then the blind bidder passes two back
          for (const c of hand(s, partner).cards) delete c.blind;
          d.blindToAsk = d.blindToAsk!.filter((x) => x !== seat && x !== partner);
          s.phase = 'blindPass';
          s.turn = partner;
          return;
        }
        case 'blindGive': {
          assertRule((s.phase === 'blindPass' || s.phase === 'blindReturn') && s.turn === seat, 'Not your turn');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length === 2 && new Set(cards).size === 2 && cards.every((c) => own.includes(c)), 'Choose 2 cards');
          const to = (seat + 2) % s.players.length;
          moveCards(s, `hand:${seat}`, `hand:${to}`, cards);
          d.received[to] = cards;
          log(s, `${who} passes 2 cards to ${name(s, to)}`, seat, 'Passed 2');
          if (s.phase === 'blindPass') {
            // the blind bidder now picks up their cards
            for (const c of hand(s, to).cards) delete c.blind;
            sortHand(s, to, { trump: d.trump });
            s.phase = 'blindReturn';
            s.turn = to;
          } else {
            sortHand(s, to, { trump: d.trump });
            startBidding(s);
          }
          return;
        }
        case 'moonAdd':
        case 'moonSub':
          assertRule(s.phase === 'moon' && s.turn === seat, 'Not your turn');
          d.moon = a.type === 'moonSub' ? 'sub' : 'add';
          return endRound(s);
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
      // card play is searched unless the bots are set to Easy; the other decisions use the quick rules
      const budget = botBudget(s.options);
      if (budget && s.phase === 'play' && controller(s) === seat) return searchMove(search, s, seat, budget) ?? quickBot(s, seat);
      return quickBot(s, seat);
    },

    redactData(s, viewer) {
      const d = s.data;
      return {
        ...d,
        passes: d.passes.map((p, i) => (p && i !== viewer ? [] : p)),
        received: d.received.map((r, i) => (i === viewer ? r : [])),
      };
    },

    standings(s) {
      return placesFromScores(
        s.players.map((_, i) => s.data.scores[teamOf(s, i)]),
        lowWins,
      );
    },

    status(s, viewer) {
      const d = s.data;
      const teams = teamsFor(s.players.length);
      const bidding = !!trickBids;
      let headline = '';
      if (s.phase === 'pass') {
        headline = d.passes[viewer] ? 'Waiting for everyone to pass…' : viewer >= 0 ? `Pass ${R.passing!.count} cards ${dirLabel(s, viewer)}` : 'Passing cards';
      } else if (s.phase === 'order') {
        const up = label(d.upcard!);
        headline = s.turn === viewer ? (viewer === s.dealer ? `Pick up the ${up}, or pass?` : `Order up the ${up}, or pass?`) : `${name(s, s.turn!)} is deciding on the ${up}`;
      } else if (s.phase === 'name') {
        const stuck = euchreBids?.stickTheDealer && s.turn === s.dealer;
        headline = s.turn === viewer ? (stuck ? "You're stuck — name trumps" : 'Name a trump suit, or pass') : `${name(s, s.turn!)} to name trumps`;
      } else if (s.phase === 'auction') {
        const cur = d.contract ? `${contractLabel(d.contract)} (${d.contract.value}) by ${name(s, d.maker!)}` : 'no bids yet';
        headline = s.turn === viewer ? `Your bid · ${cur}` : `${name(s, s.turn!)} to bid · ${cur}`;
      } else if (s.phase === 'call') {
        const a = auctionState(s);
        const cur = a.lastBid >= 0 ? `${bridgeLabel({ ...bidOf(a.lastBid), dbl: a.dbl }, true)} by ${name(s, a.bidder)}` : 'no bids yet';
        const vul = d.vul ?? [];
        const vulText = vul.every(Boolean) ? 'all vulnerable' : !vul.some(Boolean) ? 'none vulnerable' : `${teamName(s, vul.indexOf(true))} vulnerable`;
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
        else if (s.turn === viewer) headline = leading ? (d.trickNo === 0 && R.lead === 'twoOfClubs' ? 'Lead the 2♣' : 'Your lead') : 'Your turn';
        else if (ctl != null && ctl !== s.turn) headline = `${name(s, ctl)} to play from dummy`;
        else if (s.turn != null) headline = `${name(s, s.turn)} to play`;
        if (d.bridge && d.maker != null) headline += ` · ${bridgeLabel(d.bridge, true)} by ${name(s, d.maker)}`;
      } else if (s.phase === 'blind') {
        headline = s.turn === viewer ? 'Bid blind nil before looking at your cards, or look?' : `${name(s, s.turn!)} is deciding on blind nil`;
      } else if (s.phase === 'blindPass' || s.phase === 'blindReturn') {
        headline = s.turn === viewer ? `Pass 2 cards to ${name(s, (viewer + 2) % s.players.length)}` : `${name(s, s.turn!)} is passing 2 cards`;
      } else if (s.phase === 'defend') {
        headline = s.turn === viewer ? 'Defend alone, or play with your partner?' : `${name(s, s.turn!)} may defend alone`;
      } else if (s.phase === 'joker') {
        headline = s.turn === viewer ? 'Give the joker a suit' : `${name(s, s.turn!)} is choosing the joker’s suit`;
      } else if (s.phase === 'moon') {
        headline = s.turn === viewer ? `You shot the moon! Take ${totalPoints} off, or give everyone ${totalPoints}?` : `🌙 ${name(s, s.turn!)} shot the moon`;
      } else if (s.phase === 'roundOver') headline = 'Hand complete';
      else if (s.phase === 'gameOver') headline = 'Game over';
      // (a bridge contract already names its trump suit)
      if (d.trump && s.phase !== 'gameOver' && !d.bridge) headline += ` · trumps ${SUIT_SYMBOL[d.trump]}`;
      else if (auction && d.contract && d.maker != null && s.phase === 'play') {
        headline += d.contract.misere ? ` · ${contractLabel(d.contract)}` : ' · no trumps';
        if (d.jokerSuit) headline += ` · joker ${SUIT_SYMBOL[d.jokerSuit]}`;
        const lead = zone(s, 'trick').cards[0];
        if (lead && suitless(s, lead.id) && d.jokerLed) headline += ` · ${SUIT_SYMBOL[d.jokerLed]} called`;
      }

      const seatBadge = (i: number) => {
        if (s.phase === 'pass' && d.passes[i]) return 'Passed ✓';
        if (bridgeBids) {
          const last = [...(d.calls ?? [])].reverse().find((c) => c.seat === i);
          const playing = s.phase === 'play' || s.phase === 'trickEnd';
          const side = teamOf(s, i);
          if (playing && d.bridge) {
            // keep it short: the side's tricks once (on the declarer and the defenders), scores live in the scoreboard
            const won = teamsFor(s.players.length)[side].reduce((n, x) => n + d.tricks[x], 0);
            const tricks = `${won} trick${won === 1 ? '' : 's'}`;
            return i === d.maker ? `Declarer ${bridgeLabel(d.bridge, true)} · ${tricks}` : i === d.dummy ? 'Dummy' : tricks;
          }
          const call = s.phase === 'call' && last ? callLabel(last.call) : '';
          return [call, `${d.scores[side]} pts`, d.vul?.[side] && s.phase === 'call' ? 'vul' : ''].filter(Boolean).join(' · ');
        }
        if (euchreBids || auction) {
          const role =
            !active(s, i) ? 'Sitting out' : d.defAlone === i ? 'Defending alone' : d.maker === i && (s.phase === 'play' || s.phase === 'trickEnd' || s.phase === 'discard') ? (auction ? contractLabel(d.contract!) : d.sittingOut != null ? 'Alone' : 'Maker') : auction && d.passedOut?.[i] && s.phase === 'auction' ? 'Passed' : '';
          return [role, s.phase === 'play' || s.phase === 'trickEnd' ? `${d.tricks[i]} tricks` : '', `${d.scores[teamOf(s, i)]} pts`].filter(Boolean).join(' · ');
        }
        const parts: string[] = [];
        if (bidding) parts.push(d.bids[i] == null ? '' : `${d.tricks[i]}/${d.bids[i] === 0 && nilAllowed ? 'nil' : d.bids[i]}`);
        else if (R.scoring.type === 'penalty') parts.push(d.points[i] ? `+${d.points[i]}` : '');
        else parts.push(`${d.tricks[i]} tricks`);
        parts.push(`${d.scores[teamOf(s, i)]} pts`);
        return parts.filter(Boolean).join(' · ');
      };

      return {
        headline,
        actor: s.phase === 'play' ? controller(s) : undefined,
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
  return module;
}
