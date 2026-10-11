import { buildDeck, cardName, parseCard, rankLabel, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../cards';
import { passTarget, type PassDirection } from '../lib/passing';
import { followSuit, trickWinner } from '../lib/trickTaking';
import { createState, deal, hand, ids, log, moveCards, moveTop, name, nextSeat, resetDeck, sortHand, zone } from '../state';
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
    | { type: 'auction'; schedule: 'avondale' };
  scoring:
    | { type: 'penalty'; cardPoints: Record<string, number>; moon?: boolean }
    | { type: 'contract'; bags?: { every: number; penalty: number }; nil?: number }
    | { type: 'exact'; bonus: number }
    | { type: 'tricks' }
    | { type: 'euchre' }
    | { type: 'auction'; perTrick: number; slam?: number };
  end: { target?: number; lowWins?: boolean; rounds?: boolean };
}

/** A 500 bid: tricks (6–10) in a suit or no trumps. */
export interface Contract {
  tricks: number;
  suit: Suit | 'NT';
  value: number;
}

/** 500's Avondale schedule: 6♠ 40 … 10NT 520 (spades, clubs, diamonds, hearts, no trumps). */
const AVONDALE_SUITS: (Suit | 'NT')[] = ['S', 'C', 'D', 'H', 'NT'];
export const avondale = (tricks: number, suit: Suit | 'NT') => 40 + (tricks - 6) * 100 + AVONDALE_SUITS.indexOf(suit) * 20;
const ALL_BIDS: Contract[] = [6, 7, 8, 9, 10]
  .flatMap((t) => AVONDALE_SUITS.map((suit) => ({ tricks: t, suit, value: avondale(t, suit) })))
  .sort((a, b) => a.value - b.value);
// a thin space keeps a bid ("6 ♦") from reading as a card ("6♦")
const contractLabel = (c: Contract) => `${c.tricks}\u2009${c.suit === 'NT' ? 'NT' : SUIT_SYMBOL[c.suit]}`;
const SAME_COLOUR: Record<Suit, Suit> = { S: 'C', C: 'S', H: 'D', D: 'H' };
/** Suits by index, for "name trumps" choices. */
const NAMEABLE: Suit[] = ['S', 'H', 'D', 'C'];
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
  /** 500: the winning bid so far / the contract, and who has passed. */
  contract?: Contract | null;
  passedOut?: boolean[];
  /** Euchre: how many players have passed in this bidding round. */
  declines?: number;
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
    d.passedOut = s.players.map(() => false);
    d.declines = 0;
    d.bidRound = 1;
    d.upcard = null;
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
    s.phase = euchreBids ? 'order' : auction ? 'auction' : 'bid';
    s.turn = nextSeat(s, s.dealer);
  }

  function startPlay(s: S) {
    const d = s.data;
    s.phase = 'play';
    s.players.forEach((_, i) => sortHand(s, i, { trump: d.trump }));
    const twoClubs = s.players.findIndex((_, i) => ids(hand(s, i)).includes('2C'));
    if (R.lead === 'twoOfClubs' && twoClubs >= 0) s.turn = twoClubs;
    else if (R.lead === 'maker' && d.maker != null) s.turn = d.maker;
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
    log(s, `${name(s, seat)} wins the bid: ${contractLabel(d.contract!)} (${d.contract!.value})`, seat, contractLabel(d.contract!));
    moveCards(s, 'deck', `hand:${seat}`, ids(zone(s, 'deck')));
    sortHand(s, seat, { trump: d.trump });
    s.phase = 'discard';
    s.turn = seat;
  }

  /** Bids still open to `seat` in a 500 auction. */
  const higherBids = (s: S) => ALL_BIDS.filter((b) => b.value > (s.data.contract?.value ?? 0));

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
    const legal = followSuit(cards, suitOf(s, trick[0].id) as Suit, (c) => suitOf(s, c) as Suit);
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
    } else if (sc.type === 'auction') {
      const c = d.contract!;
      const makers = teamOf(s, d.maker!);
      teams.forEach((t, ti) => {
        const won = t.reduce((n, i) => n + d.tricks[i], 0);
        if (ti === makers) {
          const made = won >= c.tricks;
          const value = made && won === 10 && c.value < (sc.slam ?? 250) ? (sc.slam ?? 250) : c.value;
          deltas[ti] = made ? value : -c.value;
          lines.push(`${teamName(s, ti)} ${made ? 'make' : 'go down on'} ${contractLabel(c)} with ${won} tricks: ${made ? '+' : '−'}${Math.abs(deltas[ti])}`);
        } else {
          // defenders score per trick, but can't win the game on tricks alone
          deltas[ti] = Math.max(0, Math.min(won * sc.perTrick, target(s) - 10 - d.scores[ti]));
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
    if (R.scoring.type === 'tricks' || R.scoring.type === 'euchre' || R.scoring.type === 'auction') return true;
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
    const options = higherBids(s).filter((b) => b.tricks <= (capacity.get(b.suit) ?? 0));
    return options.length ? { type: 'bid500', amount: ALL_BIDS.indexOf(options[0]) } : { type: 'decline' };
  }

  /** Discard the weakest cards (never trumps if avoidable), keeping short suits short. */
  function botBury(s: S, seat: number): Action {
    const d = s.data;
    const k = auction ? (R.kitty ?? 3) : 1;
    const cards = ids(hand(s, seat));
    const weight = (c: string) => (suitOf(s, c) === d.trump ? 100 : 0) + rankOf(s, c) + cards.filter((x) => suitOf(s, x) === suitOf(s, c)).length * 0.5;
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
        const options = higherBids(s).map((b) => ({ value: ALL_BIDS.indexOf(b), label: `${contractLabel(b)} · ${b.value}` }));
        if (options.length) out.push({ type: 'bid500', label: 'Bid', style: 'primary', choose: { label: d.contract ? `Bid over ${contractLabel(d.contract)}` : 'Your bid', options } });
        out.push({ type: 'decline', label: 'Pass', style: 'quiet' });
      } else if (s.phase === 'discard' && s.turn === seat) {
        const k = auction ? (R.kitty ?? 3) : 1;
        out.push({ type: 'bury', label: k > 1 ? `Discard ${k}` : 'Discard', style: 'primary', select: { min: k, max: k, cards: ids(hand(s, seat)) } });
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
        case 'bid500': {
          assertRule(s.phase === 'auction' && s.turn === seat, 'Not your turn to bid');
          const bid = ALL_BIDS[a.amount ?? -1];
          assertRule(bid && bid.value > (d.contract?.value ?? 0), 'Bid higher than the current bid');
          d.contract = bid;
          d.maker = seat;
          log(s, `${who} bids ${contractLabel(bid)} (${bid.value})`, seat, contractLabel(bid));
          const still = s.players.map((_, i) => i).filter((i) => !d.passedOut![i]);
          if (still.length === 1) return winAuction(s, seat);
          s.turn = nextSeat(s, seat, (x) => d.passedOut![x]);
          return;
        }
        case 'decline': {
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
          if (zone(s, 'trick').cards.length === playersThisHand(s)) {
            s.phase = 'trickEnd';
            s.turn = null;
          } else s.turn = nextActive(s, seat);
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
      } else if (s.phase === 'discard') {
        const k = auction ? (R.kitty ?? 3) : 1;
        headline = s.turn === viewer ? `Discard ${k > 1 ? `${k} cards` : 'a card'}` : `${name(s, s.turn!)} is discarding`;
      } else if (s.phase === 'bid') {
        headline = s.turn === viewer ? `Your bid · ${d.handSize} tricks this hand` : `${name(s, s.turn!)} is bidding`;
      } else if (s.phase === 'play' || s.phase === 'trickEnd') {
        const leading = zone(s, 'trick').cards.length === 0;
        if (s.turn === viewer) headline = leading ? (d.trickNo === 0 && R.lead === 'twoOfClubs' ? 'Lead the 2♣' : 'Your lead') : 'Your turn';
        else if (s.turn != null) headline = `${name(s, s.turn)} to play`;
      } else if (s.phase === 'roundOver') headline = 'Hand complete';
      else if (s.phase === 'gameOver') headline = 'Game over';
      if (d.trump && s.phase !== 'gameOver') headline += ` · trumps ${SUIT_SYMBOL[d.trump]}`;
      else if (auction && d.contract && d.maker != null && s.phase === 'play') headline += ' · no trumps';

      const seatBadge = (i: number) => {
        if (s.phase === 'pass' && d.passes[i]) return 'Passed ✓';
        if (euchreBids || auction) {
          const role =
            d.sittingOut === i ? 'Sitting out' : d.maker === i && (s.phase === 'play' || s.phase === 'trickEnd' || s.phase === 'discard') ? (d.sittingOut != null ? 'Alone' : auction ? contractLabel(d.contract!) : 'Maker') : auction && d.passedOut?.[i] && s.phase === 'auction' ? 'Passed' : '';
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

