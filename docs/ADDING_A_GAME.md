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
| `poker`        | Texas Hold'em, Omaha, Pineapple-style variants (blinds and a board), Five Card Draw (`draw`: antes and one draw), Seven Card Stud (`stud`)                                      | `src/engine/families/poker.ts`                                                                                                                                                                                   |
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

## Example: Spades' rules are ten lines of JSON

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

| key                  | values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handSizes`          | `"all"` (deal the whole deck), `"ladder"` (1 → `maxHand` → 1), or a list like `[10, 9, 8]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `passing`            | `{ "count": 3, "cycle": ["left", "right", "across", "hold"] }` (also `left2` and `right2`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `lead`               | `"twoOfClubs"`, `"leftOfDealer"` or `"maker"` (whoever won the bidding)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `trump`              | `"none"`, a suit letter, `"turnUp"` (the card after the deal sets trumps; needs a `trump` zone), `"lastCard"` (the last card dealt sets trumps), `"chosen"` (decided by the bidding) or `"pitched"` (the bid winner's first lead names trumps: Setback); `trumpAnytime`: a trump may be played even when able to follow suit                                                                                                                                                                                                                                        |
| `bowers`             | the jack of trumps and the other jack of its colour are the top two trumps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `joker`              | a joker is the highest trump (in no trumps it wins any trick, played when void)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `callPartner`        | 500 for five: the contractor names a card, and whoever holds it is their secret partner                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `duplicates`         | with a double pack, two identical cards in a trick: `"later"` wins, or the `"first"` played (the default)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `kitty`              | cards left undealt for the bid winner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `breaks`             | a suit that can't be led until it has been played                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `noPointsFirstTrick` | no point cards on the first trick unless you have no choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `teams`              | partnerships, e.g. `[[0, 2], [1, 3]]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `bidding`            | `{ "nil": true, "hook": true }` (bid a number of tricks; hook: the dealer can't make bids total the tricks), `{ "type": "euchre", "stickTheDealer": true, "alone": true }` (order up / name trumps; needs an `upcard` zone), `{ "type": "auction", "schedule": "avondale", "misere": true }` (500 bids, optionally with misère and open misère), `{ "type": "bridge" }` (contract bridge auction with doubles; the declarer plays a face-up `dummy` zone), or `{ "type": "pitch" }` (Setback: one round, 2–4 or smudge, the dealer may take the bid by matching it) |
| `scoring`            | `penalty` (`cardPoints`, `moon`), `contract` (`bags`, `nil`), `exact` (`bonus`), `tricks`, `whist` (a point a trick over six), `euchre`, `auction` (`perTrick`, `slam`), `bridge` (Chicago: part scores carry within each four deals; rubber with the `style` option), or `setback` (High, Low, Jack, Game; the bidders set back on a miss; only bidders who make it win)                                                                                                                                                                                           |
| `end`                | `{ "target": 100, "lowWins": true }`, `{ "rounds": true }` (play through `handSizes` once), `{ "deals": 4 }` (a fixed number of deals; option `deals` overrides); add `"loseAt": -500` to lose at a score. Auction games are won only by making a bid unless option `bidToWin` is off                                                                                                                                                                                                                                                                               |

### Poker parameters

| key         | values                                                                |
| ----------- | --------------------------------------------------------------------- |
| `holeCards` | cards dealt to each player                                            |
| `useHole`   | `0` = best five of any cards; `2` = exactly two hole cards (Omaha)    |
| `board`     | community cards per street, e.g. `[3, 1, 1]` (`[]` for draw and stud) |
| `draw`      | `{ "max": 3 }`: draw poker, antes, then a swap of up to `max` cards   |
| `stud`      | `true`: seven card stud (antes and a bring-in; no board)              |

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

## How to play

`rulesSummary` is the **How to play** list in the table menu. Players read it on a phone, often
mid-game, and the table already offers only legal moves and a tip saying what to do now
("Pass 3 cards to your left"), so it needn't walk through procedure. Give a newcomer what they
need to play well and not be surprised:

- In this order: the goal, the deal, a turn, what beats what, scoring, the end of the game.
- Usually 4–8 lines of one or two short sentences each (`tests/howToPlay.test.ts` allows at most 13 lines of 260 characters at any table size).
- Use the words on the game's buttons and tips, and card symbols (2♣, Q♠).
- Say what the engine does. Where a rule depends on a lobby option, say "(a lobby option)".
- Rules for one table size (its deck, deal or partnerships) go in `byPlayers.<n>.rulesSummary`,
  shown after the main list only when that many play.

## Telling players what happened

Call `log(s, text, seat, short)` in your engine for every player action. **Only name cards that
were face up for everyone** (before or after the move). Log lines go to every device, so
"draws from the stock" never says which card, while "takes the 7♥ from the discard pile" does.
`tests/privacy.test.ts` plays every game and fails if a log line names a hidden card. The table shows the
latest entry under the headline (with the player's avatar) and pops `short` up as a bubble on
that player's seat, e.g. `log(s, 'Riley raises to 60', seat, 'Raise to 60')`.

## Zones

Zones are where cards live. Every game needs a `deck` zone.

| field        | meaning                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perPlayer`  | one copy per seat, with ids `hand:0`, `hand:1`, …                                                                                                    |
| `visibility` | `all` (face up for everyone), `owner` (only that seat), `none` (nobody, e.g. the deck)                                                               |
| `layout`     | `fan` (a hand), `stack` (a pile showing its top card), `spread` (a row), `trick` (cards placed toward whoever played them)                           |
| `area`       | `hand` (bottom of your screen), `center` (the table), `strip` (everyone's melds, a row; a phone opens it full screen), `seat` (by its owner), `none` |
| `hideEmpty`  | don't draw the zone while it's empty (e.g. hands laid face up at the end of Gin)                                                                     |
| `scale`      | card size relative to other table cards (`0.8` for melds)                                                                                            |
| `peek`       | a stack showing its top few cards overlapping (the slap games)                                                                                       |
| `faceUpHand` | a whole hand laid face up on the table (bridge's dummy), drawn the same however many cards are left                                                  |
| `cascade`    | a stack whose bottom card peeks out above the top one (Kings Corners)                                                                                |
| `grid`       | `[row, column]` for a middle pile: a big screen lays the piles out so (Kings Corners' cross); a phone keeps one row                                  |
| `reserve`    | a spread that keeps room for this many cards from the start, so the piles beside it don't shift as it grows                                          |
| `piles`      | melds drawn as piles: cards of one rank stacked with a count, the odd ones (wild cards) fanned beside (Canasta)                                      |

The host enforces visibility: cards a player can't see are replaced with anonymous placeholders
**before** anything is sent over the network.

## How the cards are drawn

A game never draws cards: its zones' `layout` (and the fields above) say how. Three parts, each
with one job:

1. **The page** (`Table.svelte`) lays out the table's areas: the seats, the middle's piles in
   rows, the strip, your hand along the bottom, the labels and the buttons. Each zone gets a
   frame there, sized by its layout. How big the cards are comes from `layout/table.ts`, a pure
   function of the screen and the zones: it asks each zone's layout how tall it stands at a card
   size, packs them into rows as the page will, and picks the largest cards (never under 30px
   wide) that let the middle and your hand fit. `tests/tableSize.test.ts` checks it for every
   game, and `e2e/gallery.spec.ts` checks the page lays the middle out as tall as it predicted.
2. **A layout** (`src/ui/layout/`) says where every card of one zone goes inside its frame: a pure
   function from the zone's cards and card size to the frame's size and a place (centre, width,
   turn, stacking) for each card. `fan.ts` is your hand, `trick.ts` a trick, `stack.ts` a pile,
   `spread.ts` a row (how it overlaps and wraps depends on where it is: the middle, the strip,
   the full-screen melds, a dummy), `piles.ts` melds squared into piles; `index.ts` picks one by
   the zone's `layout` (and for a spread, its `piles` and `faceUpHand` flags). `seat.ts` is the small cards beside each other player's name (their hand:
   what you can see face up, and a few backs for the rest). They're tested on their own in
   `tests/layout.test.ts`.
3. **The card layer** (`src/ui/components/CardLayer.svelte`) draws every card on the table, each
   one element for as long as it's on the table, wherever its zone's frame is on screen. When a
   card's place changes (played, drawn, re-sorted, a pile moved over by the page), the same
   element eases there; a card new to the table comes from the pile or seat the move came from
   (the log entry's `fromZone`, `seat`), and one leaving goes to where it went (`toZone`, `to`).
   (Only what isn't a card, a label beside a pile or the pot, slides by itself: `src/ui/motion.ts`.)

What you tap stays in the frames (`Zone.svelte`, `Hand.svelte`): each card's place is a button
there, in order, named for its card, so the keyboard and screen readers work as before; the
layer lets every touch through. Outside a table (the full-screen melds sheet) a frame draws its
own cards.

So a game that lays its cards out like an existing one needs nothing new. A new way of laying
cards out is a new layout function (sizes and places, tested in `tests/layout.test.ts`), a case
for it in `layout/index.ts`, and a new `layout` value in the schema; nothing else changes: the
table's sizing reads every zone's size from its layout, so a new layout's size counts there too.

## When a game needs something new

1. **A missing variation of an existing family** (say, Hearts with the J♦ worth −10): add the
   parameter to the family's definition in the schema (`$defs`, with a description), run
   `pnpm gen:types`, then use it in the family engine. Every game in the family can then use it.
2. **A new kind of game** (rummy melds, cribbage pegging): add its settings to the schema as a new
   `$defs` entry (`"title": "XRules"`, `family` a `const`) listed in `rules.oneOf`, run
   `pnpm gen:types`, then write the family in `src/engine/families/`, register it in
   `families/index.ts`. Families implement the `GameModule` interface in `src/engine/types.ts`.
3. **A true one-off**: put a `rules.ts` that exports a `GameModule` in the game's folder. It
   overrides the family. Its bots and real-time play must then be declared in `families/traits.ts` (`tests/traits.test.ts` says so if not).

Inside an engine, the UI knows nothing about rules. It renders zones and the `ActionSpec`s
returned by `actions()` (buttons, which may require a card selection or an amount; mark each
move in a bidding `confirm: true` and the player is asked before it goes, over the middle of the
table, since a call can't be taken back; `tests/confirmCalls.test.ts` lists the games with one).
The host
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
- `e2e/gallery.spec.ts`: the game is dealt in a real browser from a fixed seed and stepped through a
  hand, checked at every phone size, a laptop and a TV (with your phone in hand mode) for anything
  overlapping, cut off or off the screen, and the middle as tall as the sizes reckoned.
- `tests/howToPlay.test.ts`: every game has How to play lines, short enough to read on a phone.

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
   section in `BY_FAMILY` (`src/games/index.ts`). `tests/traits.test.ts` checks the traits against the engine.
4. Optional: a picker drawing in `src/ui/components/GameIcon.svelte`.
5. `rulesSummary` (see How to play above), with `byPlayers` lines for other table sizes.
6. `tests/engine.test.ts`, `tests/picker.test.ts`, `tests/<id>.test.ts`; a bidding game with calls that can't be taken back also goes in `AUCTIONS` in `tests/confirmCalls.test.ts`; then `pnpm verify`.
7. `AUDIT_GAMES=<id> pnpm audit:screens`: the screen audit deals and plays it at phone, tablet and
   TV sizes and reports overlaps, cut-off text and small targets.
8. The game list in `README.md`.

## Game night standings

When a game ends (`phase: 'gameOver'` with `winner` set), the host adds it to the game night
tally. The winners come first; everyone else is ranked by the family's optional
`standings(s)` (a place per seat, 0 = first, ties share; `placesFromScores` in
`src/engine/state.ts` builds it from scores). A family without it ranks everyone else equal.

## Tournaments and saved records

Any game with a result can be a tournament table (Swiss, knockout; round robin when two sides meet),
and nothing is needed for it. Optional `GameModule` members add more:

- `sides(players)`: who partners whom (`[[0, 2], [1, 3]]`). Without it everyone plays alone, and a
  tournament pairs sides.
- `report(s)` and `adjust(s, change)`: what a table tells the director (chips, board results; public
  information only) and the blinds it is told to raise. Poker has both, and is the only family that can
  be a multi-table tournament (`formatsFor` in `src/engine/events/index.ts`: flop games only).
- `duplicate`, `boards`, `compare`, `compareWith` and `nightScore`: duplicate bridge (the same boards at
  every table, compared as IMPs or matchpoints). Only the trick-taking family has them.

Which standard records a game can be saved as (PBN, Open Hand History) is decided from its game
file in `src/net/exports/formats.ts`; every other game gets the spreadsheet only.

## Zone size and the meld strip

A zone can set `"scale"` (e.g. `0.6`) to draw its cards smaller than other table cards, and
`"area": "strip"` to sit in one row beside the centre piles that scrolls sideways instead of
wrapping (on a table screen it wraps instead). Rummy 500 uses both for everyone's melds, so a
busy table still fits on a phone. A row whose cards you can pick right now spreads out enough to
tap each one.

## Smarter bots

Set `botLevels: true` on a module (and in its family's `traits.ts` entry, which the lobby reads without loading rules) and the lobby offers **Bots: Easy / Normal / Hard** (the
`botLevel` option, 0–2; read it with `botLevel(s.options)` from `src/engine/bots/search.ts`).
Easy should be the quick rule-of-thumb bot. What Normal and Hard do is up to the game:

- **Search** (`searchMove`): a family supplies a `SearchGame` — how to re-deal the cards a player
  can't see (`determinize`, usually `fork` + `dealUnseen`), the moves to compare (`candidates`, with `apply` to try one), and how to play a
  copy on to the end of the hand with its quick bot (`rollout`, usually `playOut`) and score it
  (`score`, usually `edge`). `botBudget(s.options)` gives the samples and time cap for the level. Good for games with
  short hands and a handful of choices per turn: see trick-taking, eights, climbing and cribbage.
- **Odds**: poker deals out the unseen cards to estimate how often a hand wins.
- **Memory / lookahead**: Go Fish (who asked for what), Cheat (claims in the pile), Gin (one draw ahead).

`tests/levels.bench.test.ts` measures one level against another in every game, each bot seeing
only its own seat as at a real table (see the comment at its top; `tests/search.bench.test.ts` is
the older, quicker one for the search games) — check a new level really is stronger before
shipping it.

## Real-time games

Most games take turns, and the host runs one bot at a time. A game whose module sets
`realtime: true` (the slap, Spit and Spoons games; also in `families/traits.ts`) works differently:

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
