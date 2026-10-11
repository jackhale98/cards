# Adding a game

Every folder in `src/games/` is a game. The registry (`src/games/index.ts`) discovers it
automatically, so there's nothing to register.

```
src/games/my-game/
  game.json   # required: setup (deck, zones, deal, chips, options)
  rules.ts    # optional: rule enforcement, scoring, bots
```

## Level 1: config only (honour-system rules)

A `game.json` with no `rules.ts` runs on the **Free Table** engine: the deck, zones and opening deal
come from your config, and players move cards freely. See `src/games/crazy-eights/game.json`.

```jsonc
{
  "$schema": "../../../schemas/game.schema.json",
  "id": "crazy-eights",            // must match the folder name
  "name": "Crazy Eights",
  "tagline": "Match suit or rank, eights are wild.",
  "icon": "8",
  "players": { "min": 2, "max": 7 },
  "deck": {},                       // { decks, jokers, ranks } — defaults to one 52-card deck
  "zones": [
    { "id": "deck",  "visibility": "none",  "layout": "stack", "area": "center" },
    { "id": "table", "visibility": "all",   "layout": "stack", "area": "center" },
    { "id": "hand",  "perPlayer": true, "visibility": "owner", "layout": "fan", "area": "hand" }
  ],
  "deal": [{ "to": "hand", "count": 7 }, { "to": "table", "count": 1, "faceUp": true }]
}
```

### Zones

| field        | meaning |
|--------------|---------|
| `perPlayer`  | one copy per seat, with ids `hand:0`, `hand:1`, … |
| `visibility` | `all` (face up for everyone), `owner` (only the seat that owns it), `none` (nobody, e.g. the deck) |
| `layout`     | `fan` (a hand), `stack` (pile showing the top card), `spread` (a row), `trick` (cards placed toward whoever played them) |
| `area`       | `hand` (bottom of your screen), `center` (the table), `none` (not drawn) |

Every game needs a `deck` zone. Visibility is enforced by the host: cards a player can't see
are replaced with anonymous placeholders **before** they're sent over the network.

## Level 2: `rules.ts` (enforced rules)

Export a default `GameModule` (see `src/engine/types.ts`):

```ts
const myGame: GameModule<MyData> = {
  config,                                  // the imported game.json
  setup(players, seed, options) { … },     // build the initial state (use createState + deal)
  actions(state, seat) { … },              // buttons available to this seat right now
  apply(state, seat, action) { … },        // mutate a cloned state; throw RuleError if illegal
  status(state, viewer) { … },             // headline, per-seat badges, pot, scoreboard, banner
  system?(state) { … },                    // timed automatic steps, e.g. collect a finished trick
  bot?(state, seat) { … },                 // pick an action for a bot seat
  redactData?(state, viewer) { … },        // hide private game data (e.g. cards chosen to pass)
};
```

How it fits together:

- **The UI knows nothing about rules.** It renders zones and the `ActionSpec`s you return from
  `actions()`. An action can require a card selection (`select: { min, max, cards }`) or an
  amount (`amount: { min, max, step, default }`). With `quick: true`, tapping a selected card
  again or swiping it up triggers the action.
- **The host validates everything.** An action type you didn't offer to that seat is rejected
  before `apply` runs. Inside `apply`, use `assertRule(cond, 'message')`: the message is shown
  to the player.
- **State must be plain JSON.** Put game-specific state in `state.data`, chips in
  `state.players[i].chips`, and shuffle with the seeded RNG (`shuffle(arr, state)`) so games replay deterministically.

Reusable building blocks live in `src/engine/lib/`:

| module        | use it for |
|---------------|------------|
| `betting`     | poker-style rounds: blinds, raises, all-ins, side pots |
| `pokerEval`   | best 5-card hand from 5–7 cards |
| `trickTaking` | follow-suit legality, trick winner with trumps/custom suit & rank |
| `passing`     | left/right/across passing |

`src/games/hearts/rules.ts` and `src/games/holdem/rules.ts` are complete examples.

## Testing

Add a test in `tests/` that simulates a full game with bots (see `tests/games.test.ts`). The
schema test validates every `game.json` automatically. Run `pnpm test`.
