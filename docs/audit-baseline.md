# Screen audit baseline

The full screen audit (`pnpm audit:screens`) of every game, once the table was
sized by one function, `src/ui/layout/table.ts`, last run at commit a2dc440 (after the middle's cards
grow into spare height on large screens). 160 runs, no errors,
nothing overlapping, off screen or cut off. What's left are the audit's softer findings, counted
once per distinct finding across a game's runs (small and large screens, more and fewer players,
with a TV):

- **too small to read**: a face-up card under 30px wide (the smallest seen in brackets)
- **hard to touch**: an overlapped card you can pick showing under 28px
- **too small to touch**: a button under 24px; **small**: under 44px or text under 11px (notes for a person)
- **squeezed**: the middle was scaled down to fit (the sizes didn't foresee something)

| game               | runs | too small to read | hard to touch | too small to touch | small | squeezed | other |
| ------------------ | ---- | ----------------- | ------------- | ------------------ | ----- | -------- | ----- |
| baccarat           | 6    | 0                 | 0             | 2                  | 41    | 0        | 0     |
| blackjack          | 6    | 0                 | 0             | 2                  | 40    | 0        | 0     |
| bridge             | 3    | 0                 | 1             | 0                  | 27    | 0        | 0     |
| canasta            | 6    | 0                 | 3             | 2                  | 49    | 0        | 0     |
| cheat              | 6    | 0                 | 3             | 4                  | 35    | 0        | 0     |
| crazy-eights       | 6    | 0                 | 0             | 2                  | 39    | 0        | 1     |
| cribbage           | 4    | 0                 | 0             | 0                  | 35    | 0        | 0     |
| egyptian-rat-screw | 6    | 0                 | 0             | 2                  | 34    | 0        | 0     |
| euchre             | 4    | 0                 | 0             | 2                  | 33    | 0        | 0     |
| five-card-draw     | 6    | 0                 | 0             | 2                  | 39    | 0        | 0     |
| five-hundred       | 6    | 0                 | 0             | 2                  | 40    | 0        | 0     |
| gin-rummy          | 3    | 0                 | 0             | 1                  | 29    | 0        | 0     |
| go-fish            | 6    | 0                 | 0             | 2                  | 39    | 0        | 0     |
| hand-and-foot      | 6    | 0                 | 0             | 2                  | 39    | 2        | 0     |
| hearts             | 6    | 0                 | 1             | 2                  | 37    | 0        | 0     |
| holdem             | 6    | 0                 | 0             | 3                  | 37    | 0        | 0     |
| kings-corners      | 6    | 0                 | 0             | 2                  | 41    | 0        | 0     |
| oh-hell            | 6    | 0                 | 0             | 2                  | 40    | 0        | 0     |
| omaha              | 6    | 0                 | 0             | 3                  | 37    | 0        | 0     |
| palace             | 6    | 0                 | 0             | 2                  | 45    | 1        | 0     |
| pinochle           | 3    | 6 (29px)          | 3             | 0                  | 33    | 2        | 0     |
| president          | 6    | 0                 | 1             | 2                  | 39    | 0        | 0     |
| rummy-500          | 6    | 0                 | 0             | 2                  | 47    | 1        | 0     |
| setback            | 5    | 0                 | 0             | 0                  | 34    | 0        | 0     |
| seven-card-stud    | 6    | 4 (27px)          | 0             | 2                  | 60    | 1        | 0     |
| slapjack           | 6    | 0                 | 0             | 2                  | 34    | 0        | 0     |
| spades             | 6    | 0                 | 1             | 2                  | 38    | 0        | 0     |
| spit               | 3    | 0                 | 0             | 1                  | 25    | 0        | 1     |
| spoons             | 6    | 0                 | 0             | 3                  | 29    | 0        | 0     |
| whist              | 3    | 0                 | 0             | 0                  | 28    | 0        | 0     |
| **all**            | 160  | 10                | 13            | 53                 | 1123  | 7        | 2     |

What's left, and why:

- Five Card Draw no longer shows up: its seven hands at game over now measure 30px or more (the
  last baseline had 30 findings, 20px at worst).
- Pinochle's meld on the smallest phone (667×320, browser bars showing): three panels of melds
  beside the empty trick don't fit even at the smallest cards, so the middle is scaled to fit
  (0.94–0.98) and the strip's cards measure 29px. Hard to touch: a 20-card hand while passing four.
- Seven Card Stud: a showdown on a small phone (two seven-card hands and the result), 27px.
- Rummy 500, Hand and Foot, Palace: the middle scaled by 1–6% with a sheet open over it (the menu,
  save or scores) or as the result banner arrives; nothing is cut off.
- "Buttons beside your hand though they'd fit": once the buttons have had to go beside your hand in
  a part of the game, they stay there till it moves on (so your hand doesn't slide about), and the
  audit looked while a sheet was open (Crazy Eights) or between two reactions (Spit).

## Before phase 1

The same audit on the card layer before phase 1 (commit 18e7ddb): cards too small to read 548
(18px at worst: Canasta, Go Fish, Hand and Foot, Kings Corners, Rummy 500), hard to touch 42, too
small to touch 129, small 2384. Most of the unreadable cards were the middle shrunk to 60% behind
the result panel (the scaling counted the panel as room taken under the middle).
