import { buildDeck, parseCard, type Suit } from '../../cards';
import type { PassDirection } from '../../lib/passing';
import type { GameConfig, GameState } from '../../types';
import type { BridgeContract, Call, Contract } from './contracts';

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
  /**
   * Five-handed 500: after the kitty the contractor names a card (or plays alone); whoever holds it
   * is their secret partner, known when the card is played.
   */
  callPartner?: boolean;
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
  /** Five-handed 500: the card the contractor called (null: playing alone), and who holds it. */
  called?: string | null;
  /** Hidden from everyone else until the called card is played. */
  partner?: number | null;
  partnerShown?: boolean;
  callAsked?: boolean;
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

export type S = GameState<TrickData>;

/**
 * One game's rules, read once from its `game.json`: the parameters, plus what follows from them
 * (the pack, the points in it, which kind of bidding). Every part of the engine takes it as `g`.
 */
export interface TrickGame {
  config: GameConfig;
  R: TrickRules;
  deckSize: number;
  /** Every card in the pack, in a fixed order (a called card is chosen by its index). */
  deckCards: string[];
  /** Points in the whole deck (Hearts: 26). */
  totalPoints: number;
  lowWins: boolean;
  // which kind of bidding this game uses
  trickBids: { nil?: boolean; hook?: boolean } | null;
  euchreBids: { type: 'euchre'; stickTheDealer?: boolean; alone?: boolean } | null;
  auction: { type: 'auction'; schedule: 'avondale'; misere?: boolean } | null;
  bridgeBids: boolean;
  nilAllowed: boolean;
}

/** A card's penalty points (Hearts: a heart 1, the Q♠ 13); none in other scoring. */
export function pointsOf(R: TrickRules, id: string): number {
  if (R.scoring.type !== 'penalty') return 0;
  const pts = R.scoring.cardPoints;
  return pts[id.split('#')[0]] ?? pts[parseCard(id).suit] ?? 0;
}

export function trickGame(config: GameConfig): TrickGame {
  const R = config.rules as unknown as TrickRules;
  const deckCards = buildDeck(config.deck);
  const trickBids = R.bidding && (!R.bidding.type || R.bidding.type === 'tricks') ? (R.bidding as { nil?: boolean; hook?: boolean }) : null;
  return {
    config,
    R,
    deckSize: deckCards.length,
    deckCards,
    totalPoints: deckCards.reduce((n, c) => n + pointsOf(R, c), 0),
    lowWins: !!R.end.lowWins,
    trickBids,
    euchreBids: R.bidding?.type === 'euchre' ? R.bidding : null,
    auction: R.bidding?.type === 'auction' ? R.bidding : null,
    bridgeBids: R.bidding?.type === 'bridge',
    nilAllowed: !!trickBids?.nil,
  };
}

/** Points to play to (the `target` option, else the game's own). */
export const target = (g: TrickGame, s: S) => Number(s.options.target ?? g.R.end.target ?? 100);

/** "ladder": from the most cards (as many as the deck allows, up to `maxHand`) down to one and back up. */
export function sequence(g: TrickGame, s: S): number[] {
  const R = g.R;
  if (Array.isArray(R.handSizes)) return R.handSizes;
  const max = Math.min(Number(s.options.maxHand ?? R.maxHand ?? 99), Math.floor((g.deckSize - 1) / s.players.length));
  const down = Array.from({ length: max }, (_, i) => max - i);
  return [...down, ...down.slice(0, -1).reverse()];
}
/** Hands in a game played through `handSizes` once (`end.rounds`); otherwise no limit. */
export const totalRounds = (g: TrickGame, s: S) => (g.R.end.rounds ? sequence(g, s).length : Infinity);
