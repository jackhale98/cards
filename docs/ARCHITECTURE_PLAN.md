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

Goal: the table screen is markup plus small modules; each job readable on its own.

- [ ] 2a. Sheets into components: `MenuSheet`, `ScoresSheet`, `SaveSheet`, `MeldsSheet` (the
      full-screen melds), `LookSheet` if not already one. Props in, events out.
- [ ] 2b. Logic into `src/ui/table/` modules (plain TS or `.svelte.ts` classes): `selection`
      (selected, selectable, tap, swipe, run, quick), `fresh` (cards just received), `race`
      (real-time reaction timing), `shown` (which zones show where: centre, strip, showdown,
      `keptRoom`, hand mode's usable piles, play-from dummy), `announce` (the screen-reader line),
      `tvSeats` (seat positions round the oval: into `layout/table.ts`).
- [ ] 2c. `TableStatus` (headline, last move) and the `.me` column as components.
- [ ] 2d. Unit tests for the modules that hold logic (selection rules, fresh-card rules, which
      zones show). Target: `Table.svelte` under ~1000 lines, mostly markup and CSS.

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
