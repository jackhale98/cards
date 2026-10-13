# Adding a game

Games are **plain JSON files**. Each folder in `src/games/` with a `game.json` is a game, and
the registry finds it automatically. The file's `rules` block picks a **family engine** and
sets its parameters:

```
src/games/my-game/
  game.json   # deck, zones, options, and "rules": { "family": …, …parameters }
  rules.ts    # optional escape hatch for rules no family covers
```

| family         | games it can express today                                                                                                                                                      | engine                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `free`         | anything (rules not enforced). Optional zones add moves: `discard` (discard face up/down, take the top discard) and a per-player `melds` zone (lay down melds, add to anyone's) | `src/engine/families/free.ts`                                                                                                                                                                                    |
| `trick-taking` | Hearts, Spades, Oh Hell, Euchre, 500, Contract Bridge, Whist…                                                                                                                   | `src/engine/families/trick/` (one file per stage: `deal`, `bidding`, `play`, `scoring`, `actions`, `status`; bots in `bots.ts`, 500 and bridge contracts in `contracts.ts`; the map is at the top of `index.ts`) |
| `poker`        | Texas Hold'em, Omaha, Pineapple-style variants (blinds and a board), Five Card Draw (`draw`: antes and one draw)                                                                | `src/engine/families/poker.ts`                                                                                                                                                                                   |
| `rummy`        | Gin Rummy (style `gin`), Rummy 500 (style `500`)                                                                                                                                | `src/engine/families/rummy.ts`, `rummy500.ts`                                                                                                                                                                    |
| `canasta`      | Classic Canasta, partnerships or head to head                                                                                                                                   | `src/engine/families/canasta.ts`                                                                                                                                                                                 |
| `climbing`     | President (style `president`): beat the last play or pass, first out wins                                                                                                       | `src/engine/families/climbing.ts`                                                                                                                                                                                |
| `cribbage`     | Cribbage for 2–4 (4 = partners), to 121 or 61                                                                                                                                   | `src/engine/families/cribbage.ts`                                                                                                                                                                                |
| `blackjack`    | Blackjack against the house (the host's phone deals)                                                                                                                            | `src/engine/families/blackjack.ts`                                                                                                                                                                               |
| `baccarat`     | Punto Banco against the house: bet on Player, Banker or Tie                                                                                                                     | `src/engine/families/baccarat.ts`                                                                                                                                                                                |
| `cheat`        | Cheat / Bullshit / I Doubt It                                                                                                                                                   | `src/engine/families/cheat.ts`                                                                                                                                                                                   |
| `gofish`       | Go Fish                                                                                                                                                                         | `src/engine/families/gofish.ts`                                                                                                                                                                                  |
| `eights`       | Crazy Eights: match rank or suit, eights call a suit, optional Q/A/2 specials                                                                                                   | `src/engine/families/eights.ts`                                                                                                                                                                                  |
| `palace`       | Palace / Shithead: beat the pile or pick it up, then face-up and blind face-down cards                                                                                          | `src/engine/families/palace.ts`                                                                                                                                                                                  |
| `corners`      | Kings Corners: build down in alternating colours, kings in the corners                                                                                                          | `src/engine/families/corners.ts`                                                                                                                                                                                 |
| `spit`         | Spit: two players play at once onto two middle piles, one rank up or down                                                                                                       | `src/engine/families/spit.ts`                                                                                                                                                                                    |
| `spoons`       | Spoons: pass cards along at once, quietly take a spoon on four of a kind, S-P-O-O-N                                                                                             | `src/engine/families/spoons.ts`                                                                                                                                                                                  |
| `slap`         | Slapjack and Egyptian Rat Screw, in real time: turn cards over, slap the pile (`style`: `slapjack` or `ers`)                                                                    | `src/engine/families/slap.ts`                                                                                                                                                                                    |
| `handfoot`     | Hand and Foot: partnership canasta with a hand and a foot, four rounds                                                                                                          | `src/engine/families/handfoot.ts`                                                                                                                                                                                |
| `pinochle`     | Partnership auction Pinochle: bid, pass four, meld, must-beat trick play                                                                                                        | `src/engine/families/pinochle.ts`                                                                                                                                                                                |

`schemas/game.schema.json` describes every parameter, so editors like VS Code give you
autocomplete and validation as you type (each file points at it with `$schema`). It is the one
definition of the format: the TypeScript types the engine uses (`src/engine/schema.gen.ts`: one
named type per family's settings, `PokerRules`, `TrickTakingRules`…) are generated from it with
`pnpm gen:types`. A family reads its settings with `familyRules(config, 'poker')`, which checks
the family. `pnpm test` validates every game file, each `byPlayers` table size merged in, and
that the generated types are up to date.

**Picker section.** Games are grouped in the lobby by kind (`CATEGORIES` in `src/games/index.ts`: Poker, Casino, Trick-taking, Rummy, Shedding, Family, Speed, More), chosen from the rules family (`BY_FAMILY`, same file); set `"category"` in `game.json` to put a game somewhere else. `"aliases"` (other names people know it by) help the picker's search find it.

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

| key                  | values                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handSizes`          | `"all"` (deal the whole deck), `"ladder"` (1 → `maxHand` → 1), or a list like `[10, 9, 8]`                                                                                                                                                                                                                                                                                                                                                                   |
| `passing`            | `{ "count": 3, "cycle": ["left", "right", "across", "hold"] }`                                                                                                                                                                                                                                                                                                                                                                                               |
| `lead`               | `"twoOfClubs"`, `"leftOfDealer"` or `"maker"` (whoever won the bidding)                                                                                                                                                                                                                                                                                                                                                                                      |
| `trump`              | `"none"`, a suit letter, `"turnUp"` (the card after the deal sets trumps; needs a `trump` zone) or `"chosen"` (decided by the bidding)                                                                                                                                                                                                                                                                                                                       |
| `bowers`             | the jack of trumps and the other jack of its colour are the top two trumps                                                                                                                                                                                                                                                                                                                                                                                   |
| `joker`              | a joker is the highest trump (in no trumps it wins any trick, played when void)                                                                                                                                                                                                                                                                                                                                                                              |
| `kitty`              | cards left undealt for the bid winner                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `breaks`             | a suit that can't be led until it has been played                                                                                                                                                                                                                                                                                                                                                                                                            |
| `noPointsFirstTrick` | no point cards on the first trick unless you have no choice                                                                                                                                                                                                                                                                                                                                                                                                  |
| `teams`              | partnerships, e.g. `[[0, 2], [1, 3]]`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bidding`            | `{ "nil": true, "hook": true }` (bid a number of tricks; hook: the dealer can't make bids total the tricks), `{ "type": "euchre", "stickTheDealer": true, "alone": true }` (order up / name trumps; needs an `upcard` zone), `{ "type": "auction", "schedule": "avondale", "misere": true }` (500 bids, optionally with misère and open misère), or `{ "type": "bridge" }` (contract bridge auction with doubles; the declarer plays a face-up `dummy` zone) |
| `scoring`            | `penalty` (`cardPoints`, `moon`), `contract` (`bags`, `nil`), `exact` (`bonus`), `tricks`, `euchre`, `auction` (`perTrick`, `slam`), or `bridge` (duplicate scores, Chicago vulnerability)                                                                                                                                                                                                                                                                   |
| `end`                | `{ "target": 100, "lowWins": true }`, `{ "rounds": true }` (play through `handSizes` once), `{ "deals": 4 }` (a fixed number of deals; option `deals` overrides); add `"loseAt": -500` to lose at a score. Auction games are won only by making a bid unless option `bidToWin` is off                                                                                                                                                                        |

### Poker parameters

| key         | values                                                             |
| ----------- | ------------------------------------------------------------------ |
| `holeCards` | cards dealt to each player                                         |
| `useHole`   | `0` = best five of any cards; `2` = exactly two hole cards (Omaha) |
| `board`     | community cards per street, e.g. `[3, 1, 1]`                       |

### Rummy parameters (style `gin`)

| key        | values                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| `handSize` | cards dealt to each player (10 for Gin)                                       |
| `knockMax` | most deadwood you may knock with (`0` = gin only)                             |
| `bonuses`  | `gin`, `bigGin`, `undercut`, plus end-of-game `box` (per hand won) and `game` |
| `end`      | `{ "target": 100 }`                                                           |

Melds are found automatically (`src/engine/lib/melds.ts` searches for the least deadwood), and
layoffs are made for the defender, so players only choose what to draw and discard.

### Cribbage parameters

| key      | values                                      |
| -------- | ------------------------------------------- |
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

| field        | meaning                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `perPlayer`  | one copy per seat, with ids `hand:0`, `hand:1`, …                                                                          |
| `visibility` | `all` (face up for everyone), `owner` (only that seat), `none` (nobody, e.g. the deck)                                     |
| `layout`     | `fan` (a hand), `stack` (a pile showing its top card), `spread` (a row), `trick` (cards placed toward whoever played them) |
| `area`       | `hand` (bottom of your screen), `center` (the table), `none` (not drawn)                                                   |
| `hideEmpty`  | don't draw the zone while it's empty (e.g. hands laid face up at the end of Gin)                                           |

The host enforces visibility: cards a player can't see are replaced with anonymous placeholders
**before** anything is sent over the network.

## When a game needs something new

1. **A missing variation of an existing family** (say, Hearts with the J♦ worth −10): add the
   parameter to the family's definition in the schema (`$defs`, with a description), run
   `pnpm gen:types`, then use it in the family engine. Every game in the family can then use it.
2. **A new kind of game** (rummy melds, cribbage pegging): add its settings to the schema as a new
   `$defs` entry (`"title": "XRules"`, `family` a `const`) listed in `rules.oneOf`, run
   `pnpm gen:types`, then write the family in `src/engine/families/`, register it in
   `families/index.ts`. Families implement the `GameModule` interface in `src/engine/types.ts`.
3. **A true one-off**: put a `rules.ts` that exports a `GameModule` in the game's folder. It
   overrides the family.

Inside an engine, the UI knows nothing about rules. It renders zones and the `ActionSpec`s
returned by `actions()` (buttons, which may require a card selection or an amount). The host
rejects any action it didn't offer, and `assertRule(cond, 'message')` inside `apply()` shows the
message to the player. State must be plain JSON; shuffle with the seeded RNG.

Shared building blocks live in `src/engine/lib/`: `betting` (blinds, raises, side pots),
`pokerEval` (hand ranking, Omaha rule), `trickTaking` (follow suit, trick winner), `passing`,
`teams` (partnerships and side names), `realtime` (reaction windows and bot reaction times for
the speed games) and `canastaCards` (wild cards, threes and card values). Card labels ("10♥") and
rank words ("sixes") are in `src/engine/cards.ts`; `showHands` is in `state.ts` and `ownOnly`
(redacting per-seat private lists) in `redact.ts`.

## Testing

Several suites pick up a new game by themselves:

- `tests/schema.test.ts`: the game file matches the schema.
- `tests/bots.test.ts`: bots play hundreds of deals, every move one the rules offered (checked
  exactly as the host checks people's moves, `src/engine/validate.ts`).
- `tests/privacy.test.ts` and `tests/dataPrivacy.test.ts`: no log line, action or `data` sent to
  a player names a card hidden from them. A family keeping private cards in `data` needs
  `redactData`.
- `e2e/layout.spec.ts`: the game is dealt in a real browser at phone, laptop and TV sizes.

Two lists name every game and need the new one added: `tests/engine.test.ts` (all ids) and
`tests/picker.test.ts` (ids per picker section). Then add `tests/<id>.test.ts` with the
game's own rules (fix a seed, set cards straight into `s.zones[…]` for a scenario, expect a
`RuleError` for a move the rules refuse), and run `pnpm verify`.

### Checklist

1. `src/games/<id>/game.json` (copy the closest game; `$schema` gives autocomplete).
2. Anything new in a family → `schemas/game.schema.json` first, `pnpm gen:types`, then its
   engine, and the table above.
3. A new family → `src/engine/families/<name>.ts`, registered in `families/index.ts` (a lazy
   import), its traits (bots? bot strengths? real time?) in `families/traits.ts`, and a picker
   section in `BY_FAMILY`. `tests/traits.test.ts` checks the traits against the engine.
4. Optional: a picker drawing in `src/ui/components/GameIcon.svelte`.
5. `tests/engine.test.ts`, `tests/picker.test.ts`, `tests/<id>.test.ts`; then `pnpm verify`.
6. The game list in `README.md`.

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

Set `botLevels: true` on a module and the lobby offers **Bots: Easy / Normal / Hard** (the
`botLevel` option, 0–2; read it with `botLevel(s.options)` from `src/engine/bots/search.ts`).
Easy should be the quick rule-of-thumb bot. What Normal and Hard do is up to the game:

- **Search** (`searchMove`): a family supplies a `SearchGame` — how to re-deal the cards a player
  can't see (`determinize`, usually `fork` + `dealUnseen`), the moves to compare, and how to play a
  copy on to the end of the hand with its quick bot (`rollout`, usually `playOut`) and score it
  (`edge`). `botBudget(s.options)` gives the samples and time cap for the level. Good for games with
  short hands and a handful of choices per turn: see trick-taking, eights, climbing and cribbage.
- **Odds**: poker deals out the unseen cards to estimate how often a hand wins.
- **Memory / lookahead**: Go Fish (who asked for what), Cheat (claims in the pile), Gin (one draw ahead).

`tests/search.bench.test.ts` measures one level against another (see the comment at its top) —
check a new level really is stronger before shipping it.

## Real-time games

Most games take turns, and the host runs one bot at a time. A game whose module sets
`realtime: true` (the slap games) works differently:

- Anyone may act at any moment. Every bot gets its own timer. `botDelay(s, seat, action)` is how long
  that bot takes to react, and a bot keeps its timer while its planned action stays the same.
- `status.race` names what players are reacting to (it changes when a new card lands). An action
  spec marked `react: true` goes the moment a finger touches it. The space bar triggers it too. The
  player's device adds `race` and `rt` (how long after `race` appeared on _that_ screen they reacted).
- The host stamps every action with `at` (its own clock). To decide a race, collect the reactions
  that arrive within a short window after the first, and the smallest `rt` wins. That way a slow
  connection doesn't cost anyone a slap. See `judge` in `families/slap.ts`.
- `system()` steps run on their own timer alongside the bots, so a step's `delay` can count down to
  a deadline (`judgeAt`, a game timer).
