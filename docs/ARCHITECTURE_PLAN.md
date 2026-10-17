# Architecture plan: sizing, splitting, reproducing

A working plan, kept up to date as each step lands (tick the box, add the commit). It exists so the
work can be picked up mid-way from this file alone. Delete it when everything here is done (and fold
anything lasting into CLAUDE.md / docs/ADDING_A_GAME.md).

## Why

The card layer (src/ui/components/CardLayer.svelte) fixed how cards are drawn and moved. What still
makes changes hard:

1. **Sizes are guessed in several places.** `Table.svelte` estimates each zone's size to pick card
   sizes (`cardSizes`, `centerRows`, `centerHeight`, `roomy`, `displayCw`, `stripFit` /
   `packedHeight` / `unitsOf`, `spreadCw`, `slotCw`, `rowFit`), each with its own copy of the
   geometry that `src/ui/layout/` now owns. When a guess is wrong, `fitHeight` measures the page and
   scales the middle down (cards under 30px wide), and a ring of hold-steady patches (`keptRoom`,
   `stripKeep`, `growTo`, the dummy's `kept`, `tallFor`, `holdWidth`) stops measure → resize loops.
2. **`Table.svelte` (~2650 lines) does about ten jobs**: sizing, selection, fresh cards, real-time
   timing, flight anchors, announcements, table-screen seat positions, five sheets, and their CSS.
3. **`host.ts` (~1640 lines) does about eight**: seats and keys, action checking, bot scheduling,
   real-time timers, views and patches, backups and handoff, replays, records, the night's tally.
4. **Bugs are hard to reproduce**: deals are crypto-random, e2e tests play live bots, the screen
   audit takes an hour and retries checks because bots move meanwhile.
5. **Smaller**: the seats' small cards still move with the old `motion.ts` send/receive; the table
   screen's strip has CSS (`120%` wide) mirrored by numbers in the script (`mainW * 1.2`).

## Rules for every step

- Behaviour first, tidiness second: each step either changes nothing visible (a move/extract, proven
  by the same tests passing) or changes one thing on purpose (with a test that shows it).
- Before each commit: `pnpm verify`; `pnpm test:e2e` for anything in `src/ui` or `src/net`; the
  screen audit for the games a step touches (`AUDIT_GAMES=… pnpm audit:screens`), the full audit at
  the end of a phase that changes sizes. Compare audit findings with the baseline (below): nothing
  new, and the expected ones gone.
- Push verified commits to `main` and `claude/local-wifi-card-games-u2zj8i`.
- Keep this file current: tick steps, note commits and anything learned.

## Baseline

- [x] Full screen audit of the card layer (commit 18e7ddb): 160 runs, no errors, nothing
      overlapping, off screen or cut off (three replay "overlaps" were the check not knowing the
      layer clips a scrolling row's cards: fixed in e2e/screenCheck.ts). The softer findings per
      game are in `docs/audit-baseline.md`: 548 cards under 30px wide (18px at worst: Canasta, Go
      Fish, Hand and Foot, Kings Corners, Rummy 500), 42 strips under 28px to tap. Spot checks
      against the table before the layer (Bridge, Canasta, Rummy 500, Stud): same or fewer.

## Phase 1: one pure function sizes the table

Goal: card sizes, rows and room come from one pure function (`src/ui/layout/table.ts`) that uses
the zone layouts' own sizes; nothing is measured to decide sizes except the screen and the fixed
chrome (seats bar, headline, your column), and the middle is never scaled below a readable card.

- [ ] 1a. **Extract** the current sizing into `layout/table.ts` as pure functions with explicit
      inputs (screen, mode, chrome heights, zones, labels, actions count), same outputs, same
      numbers. `Table.svelte` calls it. Characterisation tests pin today's outputs for fixture
      tables (every game's zones at the audit sizes). No visible change.
- [ ] 1b. **One geometry**: replace the estimates (`centerRows`, `centerHeight`, `roomy`,
      `unitsOf`/`packedHeight`, `spreadCw`) with `layoutZone(...)` sizes (labels: an injected text
      measurer, canvas `measureText` in the app, a fixed-width one in tests). Rows are packed
      exactly as the page will (same gaps). Tests: for each fixture, the rows and heights the
      function predicts match what the page lays out (an e2e check reads the frames).
- [ ] 1c. **Fit exactly, readable first**: the function chooses, in order, smaller cards down to
      the readable minimum, more rows, dropping the last-move line, a one-row strip that scrolls;
      never below `MIN_CW` for a face-up card. `fitHeight` stays only as a guard and reports (dev
      warning; the audit flags "the middle was scaled to fit") when it has to act.
- [ ] 1d. **Remove the patches it makes unnecessary**, one at a time, each with its regression
      test still passing: `growTo` (the dummy's growth computed from spare height), `stripSpace` /
      `stripKeep` (the strip's size from the function; a one-way hold only through a hand),
      `rowFit`, `slotCw`/`stripCw` duplicates. `keptRoom` and `tallFor` are about _what_ is shown
      when, not sizes: keep them, moved into the table's state module (phase 2).
- [ ] 1e. Audit: "hard to read" findings gone or explained; nothing new. Docs: ADDING_A_GAME's
      layout section says a new layout's size feeds the table automatically.

## Phase 2: `Table.svelte` into parts

Goal: the table screen is markup plus small modules; each job readable (and testable) on its own.
No visible change: every step is a move, proven by the same pictures and the same tests.

**Where it stands** (after phase 1, 2578 lines): script ~955 (sizing ~250, which zones show ~120,
selection and acting ~110, fresh cards ~25, real-time timing ~25, sounds and reactions ~75, flight
anchors ~45, the seats row ~35, sheets' state ~60, announcements and last move ~30, the rest
derived lookups), markup ~565 (header and seats ~115, the middle ~140, the result banner ~45, your
column ~40, hand and buttons ~75, five sheets ~215), CSS ~1055.

**How it's split.** Logic goes into pure functions first (plain TS, unit tested with no DOM) with
thin rune classes over them where state must persist between updates; markup goes into
components that each own their CSS. Rules for the components:

- Class names stay the same (`.headline`, `.last`, `.recap`, `.side-status`, `.me`, `.hand-wrap`,
  `.zones`, `.strip`, `.banner`, …): the e2e tests, the screen audit and `screenCheck` find things
  by them.
- A component gets the table's modes as props (`display`, `side`, `handMode`) and styles its own
  variants (`.table.display .headline` becomes the headline's own `.display` class): no
  `:global` reaching into children, except the few places the table's grid places a child
  (`.table.wide-middle aside`), which stay on the table's own elements.
- Props in, callbacks out (`onclose`, `onsheet`, `onact`); the shared selection is one object
  passed down, not a dozen props.
- Measured sizes the sizing needs (`headH`, `meOwnH`, `sideRecapH`, …) are bound from the
  component back (`bind:`) to the sizing state, never re-measured.

### Steps (each a commit: `pnpm verify`, full e2e, the picture check below)

- [x] 2.0 **A picture check for "nothing changed"** (pulled forward from 4a): development builds
      take `?seed=…` so a table deals the same cards each time; a script (`e2e/pictures.spec.ts`,
      not in CI) deals each of a dozen games (one per layout: hearts, bridge, holdem, stud,
      rummy-500, canasta, kings-corners, cribbage, slapjack, spit, gin-rummy, palace) at a phone
      on its side, a phone in hand mode and a TV, with no bot moves, and saves screenshots;
      run before and after each step, compared pixel for pixel (`toHaveScreenshot` against the
      "before" set). Bots' later moves aren't seeded, so only the dealt moment and a scripted
      first move are compared; e2e covers the rest.
- [x] 2a. **Sheets into components** (`src/ui/table/`): `MenuSheet` (the menu and How to play,
      with the per-device settings moved into `settings.svelte.ts`: sound, four colours, hints,
      turn notifications, hand order), `ScoresSheet`, `SaveSheet`, `MeldsSheet` (everyone's melds
      full screen, with its own `spreadCw` sizing and measuring), the `Look` sheet stays a
      three-line inline; `ResultBanner` (title, lines, recap, replay and how-it-went buttons,
      tonight's standings, the support line); `RotatePrompt`. ~−400 lines from the table.
- [x] 2b. **Logic into modules** (`src/ui/table/`, each with `tests/table*.test.ts`):
  - `shown.ts`: which zones show where, pure: the showdown's zones, the middle (with `keptRoom`
    as an input, its update a pure `keptRoomAfter`), hand mode's usable piles, the strip in
    order (`stripZones`' ranking), `playFrom`, gridded/cross order, the seats' cards.
  - `selection.svelte.ts`: selected cards; `tap`, `swipe`, `zoneAction`, pruning on update;
    the rules as pure functions (`afterTap(selected, id, specs) → { selected } | { play }`).
  - `fresh.ts`: `freshAfter(before, now, fresh)` (cards that just came into your hand; a new deal
    isn't "fresh").
  - `race.svelte.ts`: when a race showed on this screen and the reaction time to send.
  - `events.ts`: `lastMoveOf` (the line under the headline), `announceText` (the screen-reader
    line), `soundFor`, `recapOf` (the hand's summary).
  - `reactions.svelte.ts`: emoji reactions showing on seats, and what each seat "said".
  - `tvSeatPos` into `layout/table.ts` (pure: seat, players, measured size).
  - `run(spec, …)` stays in the table, composing selection, fresh and race in four lines.
- [ ] 2c. **Table parts as components**: `TableStatus` (headline and last move, used in the
      middle and in the side column), `MeColumn` (your column: whose turn on a phone on its side,
      the recap, your name, chips and hint), `SeatsBar` (the header's seats: the row that scrolls
      to whoever's turn it is, the TV's oval, reactions button and bar), `ActionsColumn` (the
      race to the target, Replay hand, the action bar or the replay's controls).
- [ ] 2d. **Sizing into one place**: everything sizing reads and works out (the measured chrome,
      `middleAt`, `fitWith`, the reservation choice, `growTo`, the strip's hold, `stripSpace`,
      `centerCw`, `handCw`, `tallActions`/`tallFor`) into `table/sizing.svelte.ts`, a class built
      from a getter of its inputs; the DOM helpers (`fitHeight` guard, `fitSide`, `edgeFade`) into
      `table/actions.ts`. The `__sizes` development hook moves with it (4a's snapshot reads it).
- [ ] 2e. Docs: CLAUDE.md's map lists `src/ui/table/`; this plan's log. Target: `Table.svelte`
      under ~1000 lines (script ~300, markup ~250, CSS ~400: the table's grid and the middle).

Order and why: 2.0 first, so every later step is checked by pictures, not by eye. Sheets first
because they're self-contained (little shared state). Logic before the remaining components, so
the components get small, tested objects instead of a dozen loose props. Sizing last: it reads
almost everything else, and is easiest to move once the rest is out of the way.

Risks to watch: Svelte's scoped CSS (a style left behind silently stops applying: the picture check
catches it); effects that ran in a particular order inside one component (the flight anchors'
`$effect.pre` must still see the DOM before the update: it stays in the table); `bind:` to class
state (works for `$state` fields; check in `pnpm check`).

## Phase 3: `host.ts` into parts

Goal: one module per job behind the same `Host` API (no protocol change).

- [ ] 3a. `host/seats.ts` (seats, keys, lobby, stand-ins), `host/acts.ts` (checking and applying
      actions, rule errors), `host/bots.ts` (turn bots, real-time bot timers, thinking bank),
      `host/views.ts` (redacting, patches, routing, resync), `host/history.ts` (replays, records,
      the night's tally), backups stay in `backup.ts`.
- [ ] 3b. Existing net tests pass unchanged; add focused tests where a module's rules were only
      covered end to end.

## Phase 4: reproducible bugs

- [ ] 4a. Development builds: `?seed=…` deals from a fixed seed; the menu's "Copy debug snapshot"
      (state, view, seat, sizes) and `?snapshot=` (or a paste box) loads one as host, so a report
      of "it looked wrong here" can be put on screen exactly.
- [ ] 4b. A layout gallery: fixtures (saved moments of every game, made by a script with fixed
      seeds) rendered at the audit's sizes with the screen check, no bots, no waiting: a fast,
      deterministic spec that runs in CI. The hour-long audit stays for full play-throughs.

## Phase 5: one motion system

- [ ] 5a. The seats' small cards drawn by the card layer (a seat frame), so `motion.ts` keeps only
      the labels' slide (FLIP); remove `send`/`receive`/`flight`.
- [ ] 5b. The table screen's strip width and similar CSS-mirrored numbers become parameters of
      `layout/table.ts`, applied as inline sizes.

## Log

(newest last: what landed, what was learned)

- Baseline: the card layer audited and pushed to main; `docs/audit-baseline.md`.
- 1a (branch `arch-work`, 59ab490): sizing moved into `layout/table.ts`, same numbers.
- 1b under way on `arch-work`: `middleHeight` (zones laid out exactly, labels measured by
  `ui/labelMeasure.ts`), `fitSizes` (the table's height shared out from exact sizes), the middle's
  predicted height on `.zones` as `data-middle-h` for tests. Next: check predictions against the
  page in a browser (e2e/zzPredict.spec.ts, scratch).
- 2.0 (branch `phase2`): `?seed=…&still` (Host options `seed`, `still`; development builds only) and
  `pnpm pictures` (36 tests, 72 pictures: stable over repeated runs; a 1px change to the headline
  shows). The menu's title has the table's random code: the spec writes a fixed one in first.
- 2a: `src/ui/table/` has `MenuSheet` (full screen handled inside it), `ScoresSheet`, `SaveSheet`,
  `ResultBanner`, `RotatePrompt` and `settings.svelte.ts` (`TableSettings`); 2578 → 2185 lines,
  pictures identical. `MeldsSheet` moves in 2c, once the selection is one object (2b): today it
  would need fifteen props. Unused CSS left behind is found by svelte-check's "unused selector"
  warnings (a script in the scratchpad removed exactly those rules).
- 2b: `shown.ts`, `selection.svelte.ts` (pure rules plus a `Selection` holding the picked cards),
  `fresh.ts`, `race.ts` (`RaceClock`, the clock injectable for tests), `events.ts`,
  `reactions.svelte.ts`, `ovalSeat` in `layout/table.ts`; `tests/tableLogic.test.ts` (16 tests).
  2185 → 2075 lines (the logic was compact; the gain is that it's tested). Pictures identical.
