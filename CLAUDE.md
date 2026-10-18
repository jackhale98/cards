# Lamplight: guide for agents (and people)

A card table where everyone's phone is their hand. Svelte 5 + TypeScript, a static site on
Cloudflare Pages, and a small Cloudflare Worker relay in `relay/` (its own pnpm package). There is
no game server: one player's device (the host) runs the rules.

## Commands

```bash
pnpm install
pnpm dev                 # http://localhost:5173 ; ?net=local links tabs in one browser (no network)
pnpm check               # svelte-check: types for .ts and .svelte. Must be 0 errors, 0 warnings
pnpm lint                # ESLint (bugs, not style)
pnpm format              # Prettier rewrites files; pnpm format:check only checks
pnpm gen:types           # regenerate src/engine/schema.gen.ts after changing the schema
pnpm test:quick          # unit tests without the slow bot suites (seconds): use while iterating
pnpm test                # every unit test (a couple of minutes: bots play thousands of deals)
pnpm exec vitest run tests/hearts.test.ts -t "moon"   # one file / one test
pnpm test:e2e            # Playwright against a dev server on :4173 (PW_CHROMIUM=<path> to reuse a browser),
                         # plus e2e/csp.spec.ts and e2e/offline.spec.ts on a production build with the real headers (:4174),
                         # and e2e/relay.spec.ts through our relay run here (:4175; needs `pnpm -C relay install`);
                         # CI also runs the main flows in WebKit (Safari's engine): PW_WEBKIT=1 locally
pnpm -C relay check      # the relay's type check
pnpm records             # bots play bridge and Hold'em into records/; then python tools/check_records.py records
pnpm verify              # check + lint + format:check + test + build + relay check: run before you commit
pnpm verify:all          # verify + e2e
pnpm pictures            # a dozen games dealt from a fixed seed, held still (`?seed=7&still`, development only),
                         # photographed; `--update-snapshots` first, then again after a change: nothing may differ
                         # (e2e/gallery.spec.ts, in test:e2e: every game from a seed, stepped on with `__advance`,
                         # screen-checked from the deal to the hand's end at every phone size, a laptop and a TV)
AUDIT_GAMES=holdem,omaha pnpm audit:screens   # the screen audit (e2e/audit.spec.ts) for those games; `pnpm audit:screens`
                         # alone is every game (about an hour): run it when a change affects every table
```

## Map

```
src/engine/            pure TS: no DOM, no network, no UI
  types.ts             GameConfig, GameState, GameModule (setup/actions/apply/system/bot/status/redactData/standings)
  state.ts             zone helpers, log(), standings helpers
  cards.ts rng.ts      card ids ("7C", "TH" for the ten, "XA" jokers), decks; the dice: sfc32, 128 bits of
                       state in GameState.rng, seeded from crypto (tests/shuffle.test.ts checks fairness)
  redact.ts            what each viewer may see: placeholders for unseen cards
  validate.ts          checkAction: an incoming action against the specs that were offered
  families/            one engine per kind of game; index.ts loads them on demand (rules.family →
                       engine), traits.ts says which have bots / real-time play without loading them
  lib/                 betting, pokerEval, trickTaking, passing, melds, cribbageScore, teams,
                       realtime (the speed games), canastaCards, duplicate (boards, IMPs, matchpoints)
  bots/search.ts       Monte Carlo search bots any family can plug into
  events/              tournaments, pure: formats (Swiss, round robin, knockout: pairing.ts), standings,
                       what the screens and each player see (view.ts); the event is plain JSON too;
                       duplicate.ts, duplicate bridge's pairs (matchpoints) and teams (IMPs): every table
                       on the round's boards, nothing of a board shown until every table has played it
src/games/<id>/game.json   a game = a family plus parameters (schemas/game.schema.json)
src/engine/schema.gen.ts   the game.json types, generated from the schema (pnpm gen:types; never edit)
src/games/index.ts     registry: game files load with the app (GameInfo), rules only when picked
                       (loadRules / rulesFor); picker sections and search
src/net/host.ts        the authoritative host: seats and keys, checking and applying actions, the lobby;
                       its parts in src/net/host/: conns (connections, heartbeat, views and patches),
                       bots (bots and automatic steps), history (replays, the game's record, scores,
                       tonight's tally), backups (host handoff), lobby (who plays, lobby buttons),
                       records, limits; event (a tournament's table: the seats the director assigns,
                       held between hands, its result) and uplink (that table's host's link to the director);
                       twin (duplicate bridge in a room: the other table, playing the same boards, hosted here)
src/net/brain.ts       where bots think: botWorker.ts (a Web Worker) in the app, inline in tests;
                       shareBrain, one brain taking turns between several tables
src/net/director.ts    a tournament's director: runs the event, seats each round's tables (TableLinks);
                       director/: desk (its rooms: signing up, moves to tables, the screens, taking over
                       a table whose host's phone goes quiet), registry, remote (a table a player hosts),
                       tables (one hosted here: bots only, every table when the director chooses, or one
                       taken over), standby (a second device's sealed copy, and taking over through the
                       relay's escrow)
src/net/eventCrypto.ts each phone's secret: signed moves between tables, seat keys (sha256.ts: HMAC);
                       eventProtocol.ts the director's messages; eventLink.ts a phone's (or TV's) link
src/event.svelte.ts    the app's side of tournaments: a phone signing up, a screen, directing
src/net/client.ts      a player's (or TV's) connection to the host
src/net/protocol.ts    every message between devices
src/net/*Transport.ts  relay (ours), trystero (public WebRTC networks), local, multi (several at once)
src/net/backup.ts      sealed backups for host handoff;  night.ts game-night tally;  reports.ts error reports
src/net/gameRecord.ts  the whole game move by move, saved as CSV (each player gets only their own cards)
src/net/exports/       the standard records a game can also be saved as: PBN (bridge), Open Hand History
                       (Hold'em, Omaha); formats.ts says which game gets which
                       (and PHH, poker for PokerKit: written only for checking, see tools/);
                       eventPbn.ts, a duplicate tournament's results (every table's, each board)
src/ui/screens/        Home, Lobby, Table, TvScreen; EventDirector, EventBoard (a tournament on a big
                       screen), EventPhone, EventStandby;  src/ui/components/  the pieces
src/ui/table/          the table screen's parts: its sheets and columns (components), what shows where
                       (shown.ts), picking cards (selection), the sizes (sizing.svelte.ts over
                       layout/table.ts, the pure arithmetic); Table.svelte puts them together
src/ui/layout/         where each zone's cards go in its frame: pure functions, one per `layout` (fan, trick,
                       stack, spread, piles; index.ts picks; seat.ts, the seats' small cards); frames.svelte.ts,
                       the frames zones register; table.ts, how big everything is (and the sizes the page sets)
src/ui/motion.ts       the slide of what isn't a card (labels, the pot) as the table changes
src/ui/components/CardLayer.svelte  draws every card on the table, one element each, eased from place to
                       place; Zone.svelte / Hand.svelte are the frames (what you tap, in order)
src/app.svelte.ts      app state, routing, starting a host or client
src/sw.js              the service worker (opens at once, and offline); vite.config.ts writes in its file list
tools/                 Python checks with other people's programs: endplay (bridge, double dummy) and
                       PokerKit replay the bots' games (pnpm records); README.md reads the strength report
relay/src/index.ts     Worker + Durable Object per table: signalling, fallback relay, takeover, reports
tests/                 vitest (tests/netHarness.ts: an in-memory network)    e2e/  Playwright
docs/ADDING_A_GAME.md  how to add a game: read it before touching families or game.json
```

## Rules that keep the game fair and working

- **The host is authoritative.** Clients send intents. `Host.act` checks the action against what
  `actions()` offered (`checkAction`: cards from the selection, amounts in range, a listed target),
  applies it to a `structuredClone`, and keeps the result only if `apply` didn't throw. Rules
  refuse a move with `RuleError` (a message the player sees); any other exception is a bug and is
  reported.
- **Never leak hidden cards.** Everything a device receives goes through `redact`. Zone visibility
  hides cards; anything private in a family's `data` needs `redactData`; log lines may only name
  cards everyone has seen. `tests/privacy.test.ts` and `tests/dataPrivacy.test.ts` check every game.
- **Seats are held by a key.** Client ids are public (they're in every view); a seat goes back to
  a connection only with that seat's key, which a client sends only to the host. Clients accept
  host messages only from the host (`Client.isHost`: our relay vouches for it; elsewhere the first
  host found). Treat every message as hostile input: check types and sizes before use.
- **A tournament trusts its signatures.** Each phone's secret goes to the director once (only to the
  vouched director: `evHere`); after that it proves it holds it. A phone follows a move to another
  table only if it's signed with its own secret, and a table's host is given only its own table's seat
  keys. A standby director holds the tournament sealed, as players hold a table's backups: the key
  is with the relay until the director has gone; likewise the director holds each player-hosted
  table's backup, sealed, until that table's host has gone quiet. Every network path is in
  `tests/eventNet.test.ts`, `tests/eventTakeover.test.ts` and `tests/eventRobust.test.ts`.
- **Rules load lazily.** UI and lobby code use `getGame(id)` (config and traits only). Only the
  host touches rules (`rulesFor`), after `loadRules`. Tests get every engine from `tests/games.ts`.
- **The schema defines game.json.** Its types are generated (`pnpm gen:types`); a family reads
  its settings with `familyRules(config, '<family>')`, never a cast. A new setting goes in the
  schema first. Tests fail if the generated file is stale or a game (or a `byPlayers` size) doesn't
  validate.
- **Game state is plain JSON** (it's cloned, sent, persisted, sealed into backups). No classes,
  Maps or functions in `GameState`.
- **Randomness that changes the game comes from the seeded RNG in the state** (`shuffle(arr, s)`),
  so a seed replays a deal. Bots may use `Math.random` for their own thinking only.
- **The UI knows no rules.** It renders zones, `ActionSpec`s and `GameStatus`. No game ids or family
  checks in `src/ui`.
- **Cards are drawn by the card layer only.** A zone lays its cards out with a layout function
  (`src/ui/layout/`) and registers its frame; it never draws them itself at a table (only on a
  sheet over it). A new arrangement of cards is a new layout function, not new CSS around cards.
  Tests find drawn cards with `e2e/cards.ts` and wait for them with `cardsLanded`.
- **Sizes come from `src/ui/layout/table.ts`**, a pure function of the screen and the zones. A size
  both the page and the sizing need (a gap, a panel's padding, how wide the strip is) is a number
  there that the page sets inline, never a CSS value with a copy of it in the script.
- **The relay is a dumb pipe** that never sees a card. Protocol changes go in `relay/src/index.ts`,
  `src/net/relayTransport.ts` and the `FakeRelay` in `tests/relay.test.ts` together, and must keep
  working with the other side one version behind (the relay deploys separately from the site).
- **Scripts come only from this site** (and Google's Cast libraries, and the Web Analytics script
  Cloudflare Pages adds): `public/_headers` sets a
  Content-Security-Policy. Something new from another site (a script, a font, an image) needs
  adding there, or the browser blocks it; e2e/csp.spec.ts catches it. WebAssembly is allowed
  (`'wasm-unsafe-eval'`) for our own build of DDS, the bridge solver (`src/engine/bots/dds`,
  rebuilt by `tools/dds/build.sh`; never edit the generated file).
- **Rules follow pagat.com.** Variants become lobby options.

## Adding a game

Usually one JSON file. Follow the checklist at the end of `docs/ADDING_A_GAME.md`: game.json,
any new family parameters (engine + schema), its How to play lines (`rulesSummary`, plus
`byPlayers.<n>.rulesSummary` for other table sizes; they must say what the engine does),
`tests/engine.test.ts` and `tests/picker.test.ts` (they list every game), the game's own test,
then `pnpm verify`. Bots, privacy, schema and the
browser layout tests cover a new game automatically.

## Tests

- One file per game or family: `tests/<game>.test.ts`; test names read as sentences.
- Build states with `g.setup(players, seed, options)` and a fixed seed; for a scenario, put cards
  straight into `s.zones[…]`.
- A bug fix gets a test that fails without the fix.
- Keep full-game bot playouts short (a few seeds, Easy bots) unless the test is about bot strength.
- e2e: use `?net=local`; wait on locators or `expect.poll` rather than fixed timeouts. `?net=local`
  delivers at once and vouches for nobody; what depends on our relay's timing or its vouching for a
  room's host belongs in e2e/relay.spec.ts (and tests/eventHarness.ts, which delays and vouches likewise).
- To put a moment on screen exactly (development builds): `?seed=7` deals the same cards, `&still`
  holds the table (no bot moves by itself), `__advance(n)` makes the next n moves the same way every
  time (`Host.step`: Easy bots thinking `steadily`), and the menu's "Copy debug snapshot" / the home
  screen's "Load debug snapshot" (`__snapshot()` / `__loadSnapshot(text)`) carry a table between
  devices. A tournament directed here steps on with `__eventStep(n)` (its tables of bots, then the
  next round). `e2e/gallery.spec.ts` uses them to screen-check every game; a test that plays a game
  through should step it from a seed too, not wait on live bots (only the real-time games need them).

## Style

- TypeScript strict, `noUnusedLocals`/`noUnusedParameters` (prefix a deliberately unused
  parameter with `_`); `import type` for types.
- Svelte 5 runes (`$state`, `$derived`, `$props`). Colours and sizes from `src/theme/tokens.css`.
- Comments say why, in plain English. Player-facing text is friendly and short ("your left",
  "Take over hosting").
- Battery matters: no endless animations or timers while nothing is happening; respect
  `prefers-reduced-motion`.
