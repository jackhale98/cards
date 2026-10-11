import { buildDeck, cardName, parseCard, rankLabel, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../cards';
import { passTarget, type PassDirection } from '../lib/passing';
import { followSuit, trickWinner } from '../lib/trickTaking';
import { createState, deal, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, sortHand, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

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
  lead?: 'twoOfClubs' | 'leftOfDealer' | 'maker';
  /** `chosen` = trumps are decided by the bidding (euchre, 500). */
  trump?: 'none' | Suit | 'turnUp' | 'chosen';
  breaks?: Suit;
  noPointsFirstTrick?: boolean;
  teams?: number[][];
  /** The jack of trumps (right bower) and the other jack of its colour (left bower) are the top trumps. */
  bowers?: boolean;
  /** A joker is the highest trump (in no trumps it beats everything and is played when void). */
  joker?: boolean;
  /** Cards left over after the deal, taken by the bid winner (500) or turned up (euchre). */
  kitty?: number;
  bidding?:
    | { type?: 'tricks'; nil?: boolean; hook?: boolean }
    | { type: 'euchre'; stickTheDealer?: boolean; alone?: boolean }
    | { type: 'auction'; schedule: 'avondale'; misere?: boolean }
    | { type: 'bridge' };
  scoring:
    | { type: 'penalty'; cardPoints: Record<string, number>; moon?: boolean }
    | { type: 'contract'; bags?: { every: number; penalty: number }; nil?: number }
    | { type: 'exact'; bonus: number }
    | { type: 'tricks' }
    | { type: 'euchre' }
    | { type: 'auction'; perTrick: number; slam?: number }
    | { type: 'bridge' };
  /** `loseAt`: a side at or below this score loses (500: −500). */
  end: { target?: number; lowWins?: boolean; rounds?: boolean; deals?: number; loseAt?: number };
}

/** A 500 bid: tricks (6–10) in a suit or no trumps. */
export interface Contract {
  tricks: number;
  suit: Suit | 'NT';
  value: number;
  /** Misère: take no tricks, partner sits out (open: hand face up after the first trick). */
  misere?: 'closed' | 'open';
}

/** 500's Avondale schedule: 6♠ 40 … 10NT 520 (spades, clubs, diamonds, hearts, no trumps). */
const AVONDALE_SUITS: (Suit | 'NT')[] = ['S', 'C', 'D', 'H', 'NT'];
export const avondale = (tricks: number, suit: Suit | 'NT') => 40 + (tricks - 6) * 100 + AVONDALE_SUITS.indexOf(suit) * 20;
const SUIT_BIDS: Contract[] = [6, 7, 8, 9, 10]
  .flatMap((t) => AVONDALE_SUITS.map((suit) => ({ tricks: t, suit, value: avondale(t, suit) })))
  .sort((a, b) => a.value - b.value);
export const MISERE: Contract = { tricks: 0, suit: 'NT', value: 250, misere: 'closed' };
export const OPEN_MISERE: Contract = { tricks: 0, suit: 'NT', value: 500, misere: 'open' };
/** Every 500 bid from lowest to highest: misère ranks above the sevens, open misère between 10♦ and 10♥. */
const ALL_BIDS: Contract[] = (() => {
  const out = [...SUIT_BIDS];
  out.splice(out.findIndex((b) => b.tricks === 8), 0, MISERE);
  out.splice(out.findIndex((b) => b.tricks === 10 && b.suit === 'H'), 0, OPEN_MISERE);
  return out;
})();
// a thin space keeps a bid ("6 ♦") from reading as a card ("6♦")
const contractLabel = (c: Contract) =>
  c.misere ? (c.misere === 'open' ? 'Open misère' : 'Misère') : `${c.tricks}\u2009${c.suit === 'NT' ? 'NT' : SUIT_SYMBOL[c.suit]}`;
const SAME_COLOUR: Record<Suit, Suit> = { S: 'C', C: 'S', H: 'D', D: 'H' };
/** Suits by index, for "name trumps" choices. */
const NAMEABLE: Suit[] = ['S', 'H', 'D', 'C'];
/** Contract bridge: bids are numbered 0 (1♣) … 34 (7NT). */
const STRAINS: (Suit | 'NT')[] = ['C', 'D', 'H', 'S', 'NT'];
export const bidOf = (i: number) => ({ level: Math.floor(i / 5) + 1, strain: STRAINS[i % 5] });
const bidLabel = (i: number) => contractLabel({ tricks: bidOf(i).level, suit: bidOf(i).strain, value: 0 });
export type Call = number | 'P' | 'X' | 'XX';
export interface BridgeContract {
  level: number;
  strain: Suit | 'NT';
  /** 0 undoubled, 1 doubled, 2 redoubled. */
  dbl: 0 | 1 | 2;
}
const bridgeLabel = (c: BridgeContract, short = false) =>
  `${contractLabel({ tricks: c.level, suit: c.strain, value: 0 })}${short ? ['', '×', '××'][c.dbl] : ['', ' doubled', ' redoubled'][c.dbl]}`;

/**
 * Duplicate bridge score for one deal: positive = the declaring side's score, negative = what the
 * defenders score.
 */
export function bridgeScore(c: BridgeContract, vul: boolean, won: number): number {
  const need = c.level + 6;
  if (won < need) {
    const down = need - won;
    if (!c.dbl) return -down * (vul ? 100 : 50);
    let pts = 0;
    for (let i = 1; i <= down; i++) pts += vul ? (i === 1 ? 200 : 300) : i === 1 ? 100 : i <= 3 ? 200 : 300;
    return -pts * c.dbl;
  }
  const per = c.strain === 'C' || c.strain === 'D' ? 20 : 30;
  const mult = [1, 2, 4][c.dbl];
  const trickPts = (c.level * per + (c.strain === 'NT' ? 10 : 0)) * mult;
  let score = trickPts + (trickPts >= 100 ? (vul ? 500 : 300) : 50);
  if (c.level === 6) score += vul ? 750 : 500;
  if (c.level === 7) score += vul ? 1500 : 1000;
  score += 50 * c.dbl;
  const over = won - need;
  score += c.dbl ? over * (vul ? 200 : 100) * c.dbl : over * per;
  return score;
}

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
  // which kind of bidding this game uses
  const trickBids = R.bidding && (!R.bidding.type || R.bidding.type === 'tricks') ? (R.bidding as { nil?: boolean; hook?: boolean }) : null;
  const euchreBids = R.bidding?.type === 'euchre' ? R.bidding : null;
  const auction = R.bidding?.type === 'auction' ? R.bidding : null;
  const bridgeBids = R.bidding?.type === 'bridge';
  const nilAllowed = !!trickBids?.nil;
  const target = (s: S) => Number(s.options.target ?? R.end.target ?? 100);

  function sizeForRound(n: number, round: number): number {
    const all = Math.floor((deckSize - (R.trump === 'turnUp' ? 1 : 0) - (R.kitty ?? 0)) / n);
    if (!R.handSizes || R.handSizes === 'all') return Math.floor((deckSize - (R.kitty ?? 0)) / n);
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
    d.trump = R.trump && R.trump !== 'none' && R.trump !== 'turnUp' && R.trump !== 'chosen' ? R.trump : null;
    d.maker = null;
    d.sittingOut = null;
    d.contract = null;
    d.exposed = null;
    d.passedOut = s.players.map(() => false);
    d.declines = 0;
    d.bidRound = 1;
    d.upcard = null;
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
    s.phase = euchreBids ? 'order' : auction ? 'auction' : bridgeBids ? 'call' : 'bid';
    // in bridge the dealer calls first
    s.turn = bridgeBids ? s.dealer : nextSeat(s, s.dealer);
  }

  function startPlay(s: S) {
    const d = s.data;
    s.phase = 'play';
    s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
    const twoClubs = s.players.findIndex((_, i) => ids(hand(s, i)).includes('2C'));
    if (R.lead === 'twoOfClubs' && twoClubs >= 0) s.turn = twoClubs;
    else if (R.lead === 'maker' && d.maker != null) s.turn = d.maker;
    else if (bridgeBids && d.maker != null) s.turn = nextSeat(s, d.maker); // left of the declarer leads
    else s.turn = active(s, nextSeat(s, s.dealer)) ? nextSeat(s, s.dealer) : nextActive(s, nextSeat(s, s.dealer));
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
    if (alone) d.sittingOut = (seat + 2) % s.players.length;
    log(s, `${name(s, seat)} ${pickUp ? (seat === s.dealer ? 'picks it up' : 'orders it up') : `names ${SUIT_SYMBOL[suit]}`}${alone ? ' and goes alone' : ''}`, seat, `${SUIT_SYMBOL[suit]}${alone ? ' alone' : ''}`);
    if (pickUp && d.sittingOut !== s.dealer) {
      moveCards(s, 'upcard', `hand:${s.dealer}`, ids(zone(s, 'upcard')));
      s.phase = 'discard';
      s.turn = s.dealer;
      return;
    }
    moveCards(s, 'upcard', 'kitty', ids(zone(s, 'upcard')));
    startPlay(s);
  }

  /** 500: the auction is over; the winner picks up the kitty and discards. */
  function winAuction(s: S, seat: number) {
    const d = s.data;
    d.maker = seat;
    d.trump = d.contract!.suit === 'NT' ? null : d.contract!.suit;
    // misère is played alone: partner's cards stay face down
    if (d.contract!.misere) d.sittingOut = (seat + 2) % s.players.length;
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

  const suitOf = (s: S, id: string) => suitFor(id, s.data.trump);
  const rankOf = (s: S, id: string) => rankFor(id, s.data.trump);

  /** Seats taking part this hand, in turn order from `seat` (someone going alone leaves their partner out). */
  const active = (s: S, seat: number) => s.data.sittingOut !== seat;
  const playersThisHand = (s: S) => s.players.length - (s.data.sittingOut != null ? 1 : 0);
  const nextActive = (s: S, seat: number) => nextSeat(s, seat, (x) => !active(s, x));

  function legalCards(s: S, seat: number): string[] {
    const cards = ids(zone(s, sourceZone(s, seat)));
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
    const legal = followSuit(cards, suitOf(s, trick[0].id) as Suit, (c) => suitOf(s, c) as Suit);
    // misère: a player who can't follow suit must play the joker
    const joker = cards.find((c) => parseCard(c).suit === 'X');
    if (isMisere(s) && joker && legal.length === cards.length && !cards.some((c) => suitOf(s, c) === suitOf(s, trick[0].id))) return [joker];
    if (d.trickNo === 0 && R.noPointsFirstTrick) {
      const clean = legal.filter((c) => !pointsOf(c));
      if (clean.length) return clean;
    }
    return legal;
  }

  function currentWinner(s: S) {
    const trick = zone(s, 'trick').cards;
    if (!trick.length) return null;
    // a joker always wins (in no trumps it has no suit to be compared within)
    const joker = trick.find((c) => parseCard(c.id).suit === 'X');
    if (joker) return joker;
    return trick[trickWinner(trick, { trump: s.data.trump, suitOf: (c) => suitOf(s, c), rankOf: (c) => rankOf(s, c) })];
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
    } else if (sc.type === 'euchre') {
      const makers = teamOf(s, d.maker!);
      const won = teams[makers].reduce((n, i) => n + d.tricks[i], 0);
      const alone = d.sittingOut != null;
      if (won >= 3) {
        deltas[makers] = won === 5 ? (alone ? 4 : 2) : 1;
        lines.push(`${teamName(s, makers)} make it${won === 5 ? (alone ? ' — a loner march!' : ' — march!') : ''} (${won} tricks)`);
      } else {
        deltas[1 - makers] = 2;
        lines.push(`${teamName(s, makers)} are euchred! (${won} tricks)`);
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
        for (const i of t) {
          if (d.bids[i] === 0 && nilAllowed) {
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
            const bags = (sc as { bags?: { every: number; penalty: number } }).bags;
            if (bags && d.bags[ti] >= bags.every) {
              d.bags[ti] -= bags.every;
              deltas[ti] -= bags.penalty;
              lines.push(`${teamName(s, ti)}: ${bags.every} bags, −${bags.penalty}`);
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
    if (auction) return endAuctionRound(s, deltas, lines);
    const best = lowWins ? Math.min(...d.scores) : Math.max(...d.scores);
    const reached = R.end.deals
      ? d.round + 1 >= Number(s.options.deals ?? R.end.deals)
      : R.end.rounds
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
    if (R.scoring.type === 'tricks' || R.scoring.type === 'euchre' || R.scoring.type === 'auction' || R.scoring.type === 'bridge') return true;
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
    const partnerWinning = teamOf(s, win.by!) === teamOf(s, seat) && R.teams;
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
        out.push({ type: 'play', label: fromDummy ? 'Play from dummy' : 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legalCards(s, s.turn!) } });
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
          if (trickBids?.hook && seat === s.dealer) {
            const others = d.bids.reduce<number>((n, b) => n + (b ?? 0), 0);
            assertRule(others + bid !== d.handSize, `The dealer can’t bid ${bid}: total bids can’t equal ${d.handSize}`);
          }
          d.bids[seat] = bid;
          const bidText = bid === 0 && nilAllowed ? 'nil' : String(bid);
          log(s, `${name(s, seat)} bids ${bidText}`, seat, `Bid ${bidText}`);
          if (d.bids.every((b) => b != null)) startPlay(s);
          else s.turn = nextSeat(s, seat);
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
          return startPlay(s);
        }
        case 'play': {
          assertRule(s.phase === 'play' && controller(s) === seat, 'Not your turn');
          // the declarer plays the dummy's cards on the dummy's turn
          const turn = s.turn!;
          const card = a.cards?.[0];
          assertRule(card && legalCards(s, turn).includes(card), 'You can’t play that card');
          moveCards(s, sourceZone(s, turn), 'trick', [card], { by: turn, up: true });
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
      if ((s.phase === 'order' || s.phase === 'name') && s.turn === seat) return botMakeTrumps(s, seat);
      if (s.phase === 'auction' && s.turn === seat) return botAuction(s, seat);
      if (s.phase === 'discard' && s.turn === seat) return botBury(s, seat);
      if (s.phase === 'call' && s.turn === seat) return botCall(s, seat);
      if (s.phase === 'play' && controller(s) === seat) return { type: 'play', cards: [botCard(s, s.turn!)] };
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
      } else if (s.phase === 'roundOver') headline = 'Hand complete';
      else if (s.phase === 'gameOver') headline = 'Game over';
      // (a bridge contract already names its trump suit)
      if (d.trump && s.phase !== 'gameOver' && !d.bridge) headline += ` · trumps ${SUIT_SYMBOL[d.trump]}`;
      else if (auction && d.contract && d.maker != null && s.phase === 'play') headline += d.contract.misere ? ` · ${contractLabel(d.contract)}` : ' · no trumps';

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
            d.sittingOut === i ? 'Sitting out' : d.maker === i && (s.phase === 'play' || s.phase === 'trickEnd' || s.phase === 'discard') ? (auction ? contractLabel(d.contract!) : d.sittingOut != null ? 'Alone' : 'Maker') : auction && d.passedOut?.[i] && s.phase === 'auction' ? 'Passed' : '';
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
}

