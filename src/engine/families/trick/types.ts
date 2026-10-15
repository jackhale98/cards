import { buildDeck, parseCard, type Suit } from '../../cards';
import type { PassDirection } from '../../lib/passing';
import { familyRules, type GameConfig, type GameState } from '../../types';
import type { BridgeContract, Call, Contract } from './contracts';
import type { TrickTakingRules as TrickRules } from '../../schema.gen';
/** This family's settings in game.json (generated from the schema). */
export type { TrickTakingRules as TrickRules } from '../../schema.gen';

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
  /** Bridge: each side's part score toward the next game (below the line); rubber: games won, and whether the rubber is over. */
  below?: number[];
  games?: number[];
  rubberWon?: boolean;
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
  /** Honours: whist, the side dealt three or four of A K Q J of trumps; rubber bridge, the player holding
   *  four or five of A K Q J 10 of trumps (or all four aces in no trumps), and what they're worth. */
  honours?: { team: number; count: number; seat?: number; pts?: number } | null;
  /** Spades: blind nil bidders this hand, and who still has to decide (before looking). */
  blind?: boolean[];
  blindToAsk?: number[];
  defToAsk?: number[];
  /** Suits each player has shown out of this hand (public: the search bot deals around them). */
  voids?: string[][];
  /** Pitch / Setback: this hand's bidding and its four points (see pitch.ts). */
  pitch?: PitchHand;
}

/**
 * Pitch: the bid to beat (2–4, 5 for smudge) and who holds it; once trumps are pitched, the cards
 * that score High, Low and Jack (null: no jack dealt) and who played the top trump, who won the
 * tricks with the low trump and the jack. Card points for Game build up in `points`.
 */
export interface PitchHand {
  bid: number;
  by: number | null;
  high: string | null;
  highBy: number | null;
  low: string | null;
  lowTo: number | null;
  jack: string | null;
  jackTo: number | null;
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
  pitchBids: boolean;
  nilAllowed: boolean;
}

/** A card's penalty points (Hearts: a heart 1, the Q♠ 13); none in other scoring. */
export function pointsOf(R: TrickRules, id: string): number {
  if (R.scoring.type !== 'penalty') return 0;
  const pts = R.scoring.cardPoints;
  return pts[id.split('#')[0]] ?? pts[parseCard(id).suit] ?? 0;
}

export function trickGame(config: GameConfig): TrickGame {
  const R = familyRules(config, 'trick-taking');
  const deckCards = buildDeck(config.deck);
  const trickBids = R.bidding && (!R.bidding.type || R.bidding.type === 'tricks') ? R.bidding : null;
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
    pitchBids: R.bidding?.type === 'pitch',
    nilAllowed: !!trickBids?.nil,
  };
}

/** Points to play to (the `target` option, else the game's own). */
/** Bridge scored as a rubber (the `style` option) rather than Chicago. */
export const rubberBridge = (s: S) => Number(s.options.style ?? 0) === 1;
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
