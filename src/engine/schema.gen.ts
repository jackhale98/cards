/* Generated from schemas/game.schema.json by scripts/gen-types.mjs (pnpm gen:types). Don't edit by hand: change the schema and regenerate. */

/**
 * Which family engine runs the game, and its parameters.
 */
export type Rules =
  | FreeRules
  | TrickTakingRules
  | PokerRules
  | GinRules
  | Rummy500Rules
  | CribbageRules
  | ClimbingRules
  | CanastaRules
  | EightsRules
  | BaccaratRules
  | BlackjackRules
  | CheatRules
  | GoFishRules
  | PalaceRules
  | CornersRules
  | HandFootRules
  | SpoonsRules
  | SpitRules
  | SlapRules
  | PinochleRules;

/**
 * Declarative setup for a game in src/games/<id>/game.json: its `rules` block picks a family engine and sets its parameters (a rules.ts beside it can replace the family for a true one-off).
 */
export interface GameConfig {
  $schema?: string;
  /**
   * Must match the folder name.
   */
  id: string;
  name: string;
  tagline: string;
  /**
   * Other names the game goes by, so the picker's search finds it ("ERS", "Bullshit").
   */
  aliases?: string[];
  icon: string;
  players: PlayerCounts;
  /**
   * Seats may be filled by bots (the engine must implement bot()).
   */
  bots?: boolean;
  deck: DeckSpec;
  /**
   * @minItems 1
   */
  zones: [ZoneConfig, ...ZoneConfig[]];
  deal?: DealStep[];
  chips?: ChipsConfig;
  sort?: {
    aceLow?: boolean;
  };
  undo?: boolean;
  /**
   * How to play, in the table menu: short lines on the goal, the deal, a turn, scoring and the end (docs/ADDING_A_GAME.md). Rules for one table size go in `byPlayers`.
   */
  rulesSummary?: string[];
  options?: GameOption[];
  rules: Rules;
  /**
   * Changes for a particular number of players, keyed by the count ("3", "5"…): rule parameters merged over `rules`, deck settings over `deck`, and extra how-to-play lines.
   */
  byPlayers?: {
    [k: string]: SizeOverrides;
  };
  /**
   * Picker section (Poker, Casino, Trick-taking, Rummy, Shedding, Family, More). Defaults to one based on the rules family.
   */
  category?: string;
}
export interface PlayerCounts {
  min: number;
  max: number;
  recommended?: number;
  /**
   * Only these numbers of players are allowed (when not every count from min to max works).
   */
  counts?: number[];
}
/**
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "DeckSpec".
 */
export interface DeckSpec {
  decks?: number;
  jokers?: number;
  /**
   * Ace is 14.
   */
  ranks?: number[];
  /**
   * Card ids to leave out, e.g. ["4S", "4C"].
   */
  exclude?: string[];
  /**
   * Extra cards added on top, e.g. ["2S#2"] (a second copy of the 2♠).
   */
  extra?: string[];
}
export interface ZoneConfig {
  id: string;
  label?: string;
  perPlayer?: boolean;
  /**
   * Who may see the cards.
   */
  visibility: 'all' | 'owner' | 'none';
  layout: 'fan' | 'stack' | 'spread' | 'trick';
  /**
   * Where the zone is drawn: the hand, the centre, a compact sideways-scrolling strip along the bottom of the table, by a seat, or nowhere.
   */
  area: 'hand' | 'center' | 'strip' | 'seat' | 'none';
  /**
   * Don't draw the zone while it's empty.
   */
  hideEmpty?: boolean;
  /**
   * Card size relative to other table cards (e.g. 0.6 for many small melds).
   */
  scale?: number;
  /**
   * A stack that shows its top few face-up cards overlapping, not just the top one (slap games).
   */
  peek?: number;
  /**
   * A whole hand laid face up on the table (bridge's dummy): drawn the same way however many cards are left, so the rest don't jump about as cards are played from it.
   */
  faceUpHand?: boolean;
  /**
   * Melds of one rank (canasta's): each drawn as one squared pile with a count, its first card on top, and any cards of another rank in it (wild cards) fanned beside it, instead of every card in a row.
   */
  piles?: boolean;
  /**
   * A pile spread out card by card that keeps growing (rummy 500's discard pile): on a table screen it keeps room for this many cards, overlapped the same from the first and more as it passes that, so the piles beside it don't slide about.
   */
  reserve?: number;
  /**
   * A stack laid out as a cascade (Kings Corners): its bottom card peeks out above the top one, and no count is shown.
   */
  cascade?: boolean;
  /**
   * Where the pile sits on the table, [row, column]: with every middle pile placed, a big screen lays them out so (a cross for Kings Corners), and a phone puts them in one row in reading order.
   *
   * @minItems 2
   * @maxItems 2
   */
  grid?: [number, number];
}
export interface DealStep {
  to: string;
  count: number;
  faceUp?: boolean;
}
export interface ChipsConfig {
  start: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
}
export interface GameOption {
  id: string;
  label: string;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Show a number option as named choices; the value is the index.
   */
  choices?: string[];
}
/**
 * No rules enforced: players move cards freely.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "FreeRules".
 */
export interface FreeRules {
  family?: 'free';
}
/**
 * Trick-taking games: Hearts, Spades, Oh Hell, Whist…
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "TrickTakingRules".
 */
export interface TrickTakingRules {
  family: 'trick-taking';
  /**
   * "all" deals the whole deck; "ladder" goes 1 → maxHand → 1; or an explicit list per round.
   */
  handSizes?: ('all' | 'ladder') | number[];
  maxHand?: number;
  passing?: {
    count: number;
    cycle: ('left' | 'right' | 'across' | 'hold' | 'left2' | 'right2')[];
  };
  lead?: 'twoOfClubs' | 'leftOfDealer' | 'maker';
  /**
   * "chosen" = decided by the bidding (euchre, 500); "pitched" = the suit of the first card the bid winner leads (Pitch / Setback).
   */
  trump?: 'none' | 'S' | 'H' | 'D' | 'C' | 'turnUp' | 'chosen' | 'lastCard' | 'pitched';
  /**
   * A player may trump even when able to follow suit (Pitch / Setback): follow suit or trump.
   */
  trumpAnytime?: boolean;
  /**
   * Suit that can't be led until one has been played.
   */
  breaks?: 'S' | 'H' | 'D' | 'C';
  noPointsFirstTrick?: boolean;
  teams?: number[][];
  bidding?:
    | {
        type?: 'tricks';
        nil?: boolean;
        /**
         * Dealer can't make total bids equal the tricks available.
         */
        hook?: boolean;
      }
    | {
        type: 'euchre';
        stickTheDealer?: boolean;
        alone?: boolean;
      }
    | {
        type: 'auction';
        schedule: 'avondale';
        /**
         * Allow misère (250, over a seven) and open misère (500, any time below 10♥). Needs a `dummy` zone for the open hand.
         */
        misere?: boolean;
      }
    | {
        type: 'bridge';
      }
    | {
        type: 'pitch';
      };
  scoring:
    | {
        type: 'penalty';
        /**
         * Keys are a suit letter (every card of that suit) or a card id like "QS".
         */
        cardPoints: {
          [k: string]: number;
        };
        moon?: boolean;
      }
    | {
        type: 'contract';
        nil?: number;
        bags?: {
          every: number;
          penalty: number;
        };
        /**
         * Points for each trick over the bid (a bag). Default 1; three-handed spades: −10.
         */
        overtrick?: number;
      }
    | {
        type: 'exact';
        bonus: number;
      }
    | {
        type: 'tricks';
      }
    | {
        type: 'whist';
      }
    | {
        type: 'euchre';
        /**
         * Points for the makers taking all five tricks (doubled when alone). Default 2.
         */
        march?: number;
        /**
         * Points for the defenders when the makers fall short (doubled for a lone defender). Default 2.
         */
        euchred?: number;
      }
    | {
        type: 'auction';
        perTrick: number;
        slam?: number;
      }
    | {
        type: 'bridge';
      }
    | {
        type: 'setback';
      };
  end: {
    target?: number;
    lowWins?: boolean;
    rounds?: boolean;
    /**
     * Play this many deals (option `deals` overrides).
     */
    deals?: number;
    /**
     * A side at or below this score loses (500: -500).
     */
    loseAt?: number;
  };
  /**
   * Jack of trumps and the same-colour jack are the top two trumps.
   */
  bowers?: boolean;
  /**
   * A joker is the highest trump (500).
   */
  joker?: boolean;
  /**
   * Cards left undealt for the bid winner (500).
   */
  kitty?: number;
  /**
   * 500 for five: the contractor names a card, and whoever holds it is their secret partner, known when the card is played.
   */
  callPartner?: boolean;
  /**
   * With a double pack, two identical cards in a trick: `later` (six-handed spades) or the first played (default) wins.
   */
  duplicates?: 'later' | 'first';
}
/**
 * Poker: Hold'em, Omaha (blinds and a board) or five card draw (antes and a draw).
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "PokerRules".
 */
export interface PokerRules {
  family: 'poker';
  holeCards: number;
  /**
   * 0 = any five cards; N = exactly N hole cards.
   */
  useHole?: number;
  /**
   * Community cards dealt on each street ([] for draw poker).
   */
  board: number[];
  /**
   * Seven card stud: two cards down and one up, three more up, the last down; antes and a bring-in.
   */
  stud?: boolean;
  /**
   * Draw poker: everyone antes, bets, swaps up to `max` cards, then bets again.
   */
  draw?: {
    max: number;
  };
}
/**
 * Rummy games. Style "gin": two players draw and discard until someone knocks.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "GinRules".
 */
export interface GinRules {
  family: 'rummy';
  style: 'gin';
  handSize: number;
  /**
   * Most deadwood you may knock with; 0 = gin only.
   */
  knockMax: number;
  bonuses: {
    gin: number;
    bigGin?: number;
    undercut: number;
    box?: number;
    game?: number;
  };
  end: {
    target: number;
  };
}
/**
 * Rummy 500: 2–8 players meld and lay off on the table; melded cards score, cards in hand count against you.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "Rummy500Rules".
 */
export interface Rummy500Rules {
  family: 'rummy';
  style: '500';
  end: {
    target: number;
  };
}
/**
 * Cribbage for 2–4 players (4 = partnerships).
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "CribbageRules".
 */
export interface CribbageRules {
  family: 'cribbage';
  /**
   * Points to win (121 standard, 61 for a short game).
   */
  target: number;
}
/**
 * Climbing games (President): beat the last play with the same number of higher cards, or pass; first out wins.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "ClimbingRules".
 */
export interface ClimbingRules {
  family: 'climbing';
  style: 'president';
  end: {
    target: number;
  };
}
/**
 * Classic Canasta: partnerships (or two players) meld sets with wild 2s and jokers; seven make a canasta.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "CanastaRules".
 */
export interface CanastaRules {
  family: 'canasta';
  end: {
    target: number;
  };
}
/**
 * Crazy Eights: match the rank or suit of the top card; eights are wild and call a suit.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "EightsRules".
 */
export interface EightsRules {
  family: 'eights';
  end: {
    target: number;
  };
}
/**
 * Baccarat (Punto Banco) against the house.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "BaccaratRules".
 */
export interface BaccaratRules {
  family: 'baccarat';
  minBet: number;
  maxBet: number;
}
/**
 * Blackjack against the house.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "BlackjackRules".
 */
export interface BlackjackRules {
  family: 'blackjack';
  minBet: number;
  maxBet: number;
}
/**
 * Cheat (Bullshit, I Doubt It): play face down, claim the next rank, call Cheat!
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "CheatRules".
 */
export interface CheatRules {
  family: 'cheat';
}
/**
 * Go Fish: ask for ranks and collect books of four.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "GoFishRules".
 */
export interface GoFishRules {
  family: 'gofish';
}
/**
 * Palace (Shithead): hand, face-up and face-down cards; beat the pile or pick it up.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "PalaceRules".
 */
export interface PalaceRules {
  family: 'palace';
}
/**
 * Kings Corners: build down in alternating colours on eight piles around the stock.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "CornersRules".
 */
export interface CornersRules {
  family: 'corners';
  end: {
    /**
     * Points to win (the `target` option overrides).
     */
    target: number;
  };
}
/**
 * Hand and Foot: partnership canasta with a hand and a foot each, four rounds.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "HandFootRules".
 */
export interface HandFootRules {
  family: 'handfoot';
}
/**
 * Spoons: pass cards along at once, grab a spoon on four of a kind.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "SpoonsRules".
 */
export interface SpoonsRules {
  family: 'spoons';
}
/**
 * Spit: two players race to play onto two middle piles.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "SpitRules".
 */
export interface SpitRules {
  family: 'spit';
}
/**
 * Real-time slap games: Slapjack or Egyptian Rat Screw.
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "SlapRules".
 */
export interface SlapRules {
  family: 'slap';
  style: 'slapjack' | 'ers';
}
/**
 * Partnership auction Pinochle (single deck, four players).
 *
 * This interface was referenced by `GameConfig`'s JSON-Schema
 * via the `definition` "PinochleRules".
 */
export interface PinochleRules {
  family: 'pinochle';
  end: {
    target?: number;
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[0-9]+$".
 */
export interface SizeOverrides {
  /**
   * Settings merged over `rules` at this size (the merged rules are checked against the family by tests/schema.test.ts).
   */
  rules?: {
    [k: string]: unknown;
  };
  deck?: DeckSpec;
  /**
   * How-to-play lines shown after `rulesSummary` only when this many play (the deck, deal or partnerships at this size).
   */
  rulesSummary?: string[];
}
