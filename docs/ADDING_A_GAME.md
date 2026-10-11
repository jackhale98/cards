# Adding a game

Games are **plain JSON files**. Each folder in `src/games/` with a `game.json` is a game, and
the registry finds it automatically. The file's `rules` block picks a **family engine** and
sets its parameters:

```
src/games/my-game/
  game.json   # deck, zones, options, and "rules": { "family": …, …parameters }
  rules.ts    # optional escape hatch for rules no family covers
```

| family         | games it can express today | engine |
|----------------|----------------------------|--------|
| `free`         | anything (rules not enforced). Optional zones add moves: `discard` (discard face up/down, take the top discard) and a per-player `melds` zone (lay down melds, add to anyone's) | `src/engine/families/free.ts` |
| `trick-taking` | Hearts, Spades, Oh Hell, Euchre, 500, Contract Bridge, Whist… | `src/engine/families/trickTaking.ts` |
| `poker`        | Texas Hold'em, Omaha, Pineapple-style variants (blinds and a board), Five Card Draw (`draw`: antes and one draw) | `src/engine/families/poker.ts` |
| `rummy`        | Gin Rummy (style `gin`), Rummy 500 (style `500`) | `src/engine/families/rummy.ts`, `rummy500.ts` |
| `canasta`      | Classic Canasta, partnerships or head to head | `src/engine/families/canasta.ts` |
| `climbing`     | President (style `president`): beat the last play or pass, first out wins | `src/engine/families/climbing.ts` |
| `cribbage`     | Cribbage for 2–4 (4 = partners), to 121 or 61 | `src/engine/families/cribbage.ts` |
| `blackjack`    | Blackjack against the house (the host's phone deals) | `src/engine/families/blackjack.ts` |
| `cheat`        | Cheat / Bullshit / I Doubt It | `src/engine/families/cheat.ts` |
| `gofish`       | Go Fish | `src/engine/families/gofish.ts` |
| `eights`       | Crazy Eights: match rank or suit, eights call a suit, optional Q/A/2 specials | `src/engine/families/eights.ts` |

`schemas/game.schema.json` describes every parameter, so editors like VS Code give you
autocomplete and validation as you type (each file points at it with `$schema`). `pnpm test`
also validates every game file.

**Picker section.** Games are grouped in the lobby by kind (Poker, Trick-taking, Rummy, Shedding, More), chosen from the rules family; set `"category"` in `game.json` to put a game somewhere else.

**Picker icon.** Each built-in game has a small drawing in `src/ui/components/GameIcon.svelte`
that shows what the game is about (Hold'em's hole cards and a chip, Cribbage's pegboard…).
A new game shows its `icon` glyph from `game.json` until you add a drawing there: one
`{:else if id === 'my-game'}` branch, plus its id in `DRAWN`. The snippets at the top draw
card faces, backs, corners, suits and chips in the same style as the real cards.

## Example: Spades is ~40 lines of JSON

```jsonc
"rules": {
  "family": "trick-taking",
  "lead": "leftOfDealer",
  "trump": "S",                        // spades are always trump
  "breaks": "S",                       // …and can't be led until one is played
  "teams": [[0, 2], [1, 3]],           // partners sit across
  "bidding": { "nil": true },
  "scoring": { "type": "contract", "bags": { "every": 10, "penalty": 100 }, "nil": 100 },
  "end": { "target": 500 }
}
```

Compare Hearts (`src/games/hearts/game.json`), Oh Hell (`oh-hell`) and Omaha (`omaha`): each
is a different combination of the same parameters.

### Trick-taking parameters

| key | values |
|-----|--------|
| `handSizes` | `"all"` (deal the whole deck), `"ladder"` (1 → `maxHand` → 1), or a list like `[10, 9, 8]` |
| `passing` | `{ "count": 3, "cycle": ["left", "right", "across", "hold"] }` |
| `lead` | `"twoOfClubs"`, `"leftOfDealer"` or `"maker"` (whoever won the bidding) |
| `trump` | `"none"`, a suit letter, `"turnUp"` (the card after the deal sets trumps; needs a `trump` zone) or `"chosen"` (decided by the bidding) |
| `bowers` | the jack of trumps and the other jack of its colour are the top two trumps |
| `joker` | a joker is the highest trump (in no trumps it wins any trick, played when void) |
| `kitty` | cards left undealt for the bid winner |
| `breaks` | a suit that can't be led until it has been played |
| `noPointsFirstTrick` | no point cards on the first trick unless you have no choice |
| `teams` | partnerships, e.g. `[[0, 2], [1, 3]]` |
| `bidding` | `{ "nil": true, "hook": true }` (bid a number of tricks; hook: the dealer can't make bids total the tricks), `{ "type": "euchre", "stickTheDealer": true, "alone": true }` (order up / name trumps; needs an `upcard` zone), `{ "type": "auction", "schedule": "avondale", "misere": true }` (500 bids, optionally with misère and open misère), or `{ "type": "bridge" }` (contract bridge auction with doubles; the declarer plays a face-up `dummy` zone) |
| `scoring` | `penalty` (`cardPoints`, `moon`), `contract` (`bags`, `nil`), `exact` (`bonus`), `tricks`, `euchre`, `auction` (`perTrick`, `slam`), or `bridge` (duplicate scores, Chicago vulnerability) |
| `end` | `{ "target": 100, "lowWins": true }`, `{ "rounds": true }` (play through `handSizes` once), `{ "deals": 4 }` (a fixed number of deals; option `deals` overrides); add `"loseAt": -500` to lose at a score. Auction games are won only by making a bid unless option `bidToWin` is off |

### Poker parameters

| key | values |
|-----|--------|
| `holeCards` | cards dealt to each player |
| `useHole` | `0` = best five of any cards; `2` = exactly two hole cards (Omaha) |
| `board` | community cards per street, e.g. `[3, 1, 1]` |

### Rummy parameters (style `gin`)

| key | values |
|-----|--------|
| `handSize` | cards dealt to each player (10 for Gin) |
| `knockMax` | most deadwood you may knock with (`0` = gin only) |
| `bonuses` | `gin`, `bigGin`, `undercut`, plus end-of-game `box` (per hand won) and `game` |
| `end` | `{ "target": 100 }` |

Melds are found automatically (`src/engine/lib/melds.ts` searches for the least deadwood), and
layoffs are made for the defender, so players only choose what to draw and discard.

### Cribbage parameters

| key | values |
|-----|--------|
| `target` | points to win (121, or 61 for a short game) |

Game option `muggins` (boolean): players count their own hand and crib; opponents accept or call
muggins (missed points go to the caller, overcounts are cut back with the excess to the caller, a
wrong call gives the counter the difference). Follows the ACC tournament rules 8.4 and 10.

Hand sizes and crib rules follow the player count (2: 6 cards, 2 to the crib; 3: 5 cards, 1 to the
crib plus 1 from the deck; 4: partners, 5 cards, 1 to the crib). Scoring lives in
`src/engine/lib/cribbageScore.ts`. A family can show a race-to-N board by returning
`status.track` (the cribbage pegboard uses it).

## Telling players what happened

Call `log(s, text, seat, short)` in your engine for every player action. **Only name cards that
were face up for everyone** (before or after the move). Log lines go to every device, so
"draws from the stock" never says which card, while "takes the 7♥ from the discard pile" does.
`tests/privacy.test.ts` plays every game and fails if a log line names a hidden card. The table shows the
latest entry under the headline (with the player's avatar) and pops `short` up as a bubble on
that player's seat, e.g. `log(s, 'Riley raises to 60', seat, 'Raise to 60')`.

## Zones

Zones are where cards live. Every game needs a `deck` zone.

| field        | meaning |
|--------------|---------|
| `perPlayer`  | one copy per seat, with ids `hand:0`, `hand:1`, … |
| `visibility` | `all` (face up for everyone), `owner` (only that seat), `none` (nobody, e.g. the deck) |
| `layout`     | `fan` (a hand), `stack` (a pile showing its top card), `spread` (a row), `trick` (cards placed toward whoever played them) |
| `area`       | `hand` (bottom of your screen), `center` (the table), `none` (not drawn) |
| `hideEmpty`  | don't draw the zone while it's empty (e.g. hands laid face up at the end of Gin) |

The host enforces visibility: cards a player can't see are replaced with anonymous placeholders
**before** anything is sent over the network.

## When a game needs something new

1. **A missing variation of an existing family** (say, Hearts with the J♦ worth −10): add a
   parameter to that family engine and the schema. Every game in the family can then use it.
2. **A new kind of game** (rummy melds, cribbage pegging): write a new family in
   `src/engine/families/`, register it in `families/index.ts`, and add its parameters to the
   schema. Families implement the `GameModule` interface in `src/engine/types.ts`.
3. **A true one-off**: put a `rules.ts` that exports a `GameModule` in the game's folder. It
   overrides the family.

Inside an engine, the UI knows nothing about rules. It renders zones and the `ActionSpec`s
returned by `actions()` (buttons, which may require a card selection or an amount). The host
rejects any action it didn't offer, and `assertRule(cond, 'message')` inside `apply()` shows the
message to the player. State must be plain JSON; shuffle with the seeded RNG.

Shared building blocks live in `src/engine/lib/`: `betting` (blinds, raises, side pots),
`pokerEval` (hand ranking, Omaha rule), `trickTaking` (follow suit, trick winner) and
`passing`.

## Testing

`tests/families.test.ts` plays whole games with bots for each config-only game. Copy one of
those tests for your game, then run `pnpm test`.

## Game night standings

When a game ends (`phase: 'gameOver'` with `winner` set), the host adds it to the game night
tally. The winners come first; everyone else is ranked by the family's optional
`standings(s)` (a place per seat, 0 = first, ties share; `placesFromScores` in
`src/engine/state.ts` builds it from scores). A family without it ranks everyone else equal.

## Zone size and the meld strip

A zone can set `"scale"` (e.g. `0.6`) to draw its cards smaller than other table cards, and
`"area": "strip"` to sit in one row beside the centre piles that scrolls sideways instead of
wrapping. Rummy 500 uses both for everyone's melds, so a busy table still fits on a phone.


## Smarter bots

`src/engine/bots/search.ts` is a game-agnostic Monte Carlo bot. A family supplies a `SearchGame`:
how to re-deal the cards a player can't see (`determinize`), the moves to compare, and how to play
a copy on to the end of the hand with its quick heuristic bot (`rollout`) and score it. Set
`botLevels: true` on the module and the lobby offers a **Bots: Easy / Normal / Hard** setting
(`botLevel` 0–2); Easy uses the heuristics alone. See the trick-taking family for an example.
