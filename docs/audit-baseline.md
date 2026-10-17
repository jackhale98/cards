# Screen audit baseline

The full screen audit (`pnpm audit:screens`) of every game, after phase 1 of
docs/ARCHITECTURE_PLAN.md (the table sized by one function: commit 21cbbc0). 160 runs, no errors,
nothing overlapping, off screen or cut off. What's left are the audit's softer findings, counted
once per distinct finding across a game's runs (small and large screens, more and fewer players,
with a TV):

- **too small to read**: a face-up card under 30px wide (the smallest seen in brackets)
- **hard to touch**: an overlapped card you can pick showing under 28px
- **too small to touch**: a button under 24px; **small**: under 44px or text under 11px (notes for a person)
- **squeezed**: the middle was scaled down to fit (the sizes didn't foresee something)

| game               | runs | too small to read | hard to touch | too small to touch | small | squeezed | other |
| ------------------ | ---- | ----------------- | ------------- | ------------------ | ----- | -------- | ----- |
| baccarat           | 6    | 0                 | 0             | 2                  | 39    | 0        | 0     |
| blackjack          | 6    | 0                 | 0             | 2                  | 43    | 0        | 0     |
| bridge             | 3    | 0                 | 0             | 0                  | 27    | 0        | 0     |
| canasta            | 6    | 0                 | 3             | 2                  | 47    | 1        | 0     |
| cheat              | 6    | 0                 | 4             | 4                  | 34    | 0        | 0     |
| crazy-eights       | 6    | 0                 | 0             | 2                  | 40    | 0        | 1     |
| cribbage           | 4    | 0                 | 0             | 0                  | 35    | 0        | 0     |
| egyptian-rat-screw | 6    | 0                 | 0             | 2                  | 34    | 0        | 0     |
| euchre             | 4    | 0                 | 0             | 2                  | 32    | 0        | 0     |
| five-card-draw     | 6    | 30 (20px)         | 0             | 2                  | 40    | 1        | 0     |
| five-hundred       | 6    | 0                 | 0             | 2                  | 41    | 0        | 0     |
| gin-rummy          | 3    | 0                 | 0             | 1                  | 28    | 0        | 0     |
| go-fish            | 6    | 0                 | 0             | 2                  | 41    | 0        | 0     |
| hand-and-foot      | 6    | 0                 | 0             | 2                  | 39    | 2        | 0     |
| hearts             | 6    | 0                 | 1             | 2                  | 39    | 0        | 0     |
| holdem             | 6    | 0                 | 0             | 3                  | 36    | 0        | 0     |
| kings-corners      | 6    | 0                 | 0             | 2                  | 42    | 0        | 0     |
| oh-hell            | 6    | 0                 | 0             | 2                  | 41    | 0        | 0     |
| omaha              | 6    | 0                 | 0             | 3                  | 36    | 0        | 0     |
| palace             | 6    | 0                 | 0             | 2                  | 42    | 0        | 0     |
| pinochle           | 3    | 0                 | 3             | 0                  | 34    | 0        | 0     |
| president          | 6    | 0                 | 1             | 2                  | 39    | 0        | 0     |
| rummy-500          | 6    | 7 (29px)          | 0             | 2                  | 47    | 2        | 0     |
| setback            | 5    | 0                 | 0             | 0                  | 36    | 0        | 0     |
| seven-card-stud    | 6    | 4 (28px)          | 0             | 2                  | 56    | 1        | 0     |
| slapjack           | 6    | 0                 | 0             | 2                  | 35    | 0        | 0     |
| spades             | 6    | 0                 | 1             | 2                  | 39    | 0        | 0     |
| spit               | 3    | 0                 | 0             | 1                  | 26    | 0        | 1     |
| spoons             | 6    | 0                 | 0             | 3                  | 30    | 0        | 0     |
| whist              | 3    | 0                 | 0             | 0                  | 28    | 0        | 0     |
| **all**            | 160  | 41                | 13            | 53                 | 1126  | 7        | 2     |

What's left, and why:

- Five Card Draw, 7 players, small phone, game over: seven hands turned up at once (35 cards) on a
  phone 320px tall, under the result panel. There's no readable size for that many; it was so
  before too.
- Rummy 500 and Seven Card Stud: cards in the strip at the readable smallest, measured a hair
  under it while a meld lands, and a stud showdown on a small phone.
- "Buttons beside your hand though they'd fit": once the buttons have had to go beside your hand in
  a part of the game, they stay there till it moves on (so your hand doesn't slide about), and the
  audit looked while a sheet was open (Crazy Eights) or between two reactions (Spit).

## Before phase 1

The same audit on the card layer before phase 1 (commit 18e7ddb): cards too small to read 548
(18px at worst: Canasta, Go Fish, Hand and Foot, Kings Corners, Rummy 500), hard to touch 42, too
small to touch 129, small 2384. Most of the unreadable cards were the middle shrunk to 60% behind
the result panel (the scaling counted the panel as room taken under the middle).
