# Screen audit baseline

The full screen audit (`pnpm audit:screens`) of every game on the card layer (commit 18e7ddb),
the starting point for docs/ARCHITECTURE_PLAN.md phase 1. Nothing overlapping, off screen or cut
off in any game. What's left are the audit's softer findings, counted once per distinct finding
across a game's runs (small and large screens, more and fewer players, with a TV):

- **too small to read**: a face-up card under 30px wide (the smallest seen in brackets)
- **hard to touch**: an overlapped card you can pick showing under 28px
- **too small to touch**: a button under 24px; **small**: under 44px or text under 11px (notes for a person)

| game               | runs | too small to read | hard to touch | too small to touch | small | other |
| ------------------ | ---- | ----------------- | ------------- | ------------------ | ----- | ----- |
| baccarat           | 6    | 27 (29px)         | 0             | 4                  | 89    | 0     |
| blackjack          | 6    | 18 (28px)         | 0             | 4                  | 88    | 0     |
| bridge             | 3    | 0                 | 2             | 0                  | 42    | 0     |
| canasta            | 6    | 119 (18px)        | 5             | 8                  | 110   | 0     |
| cheat              | 6    | 0                 | 15            | 8                  | 80    | 0     |
| crazy-eights       | 6    | 0                 | 0             | 4                  | 88    | 0     |
| cribbage           | 4    | 10 (21px)         | 0             | 0                  | 62    | 0     |
| egyptian-rat-screw | 6    | 0                 | 0             | 4                  | 78    | 0     |
| euchre             | 4    | 0                 | 0             | 4                  | 53    | 0     |
| five-card-draw     | 6    | 35 (20px)         | 0             | 4                  | 85    | 0     |
| five-hundred       | 6    | 0                 | 0             | 4                  | 88    | 0     |
| gin-rummy          | 3    | 20 (30px)         | 0             | 2                  | 43    | 0     |
| go-fish            | 6    | 70 (18px)         | 0             | 8                  | 94    | 0     |
| hand-and-foot      | 6    | 35 (18px)         | 8             | 6                  | 90    | 0     |
| hearts             | 6    | 0                 | 1             | 4                  | 86    | 0     |
| holdem             | 6    | 0                 | 0             | 9                  | 81    | 0     |
| kings-corners      | 6    | 58 (18px)         | 0             | 4                  | 94    | 0     |
| oh-hell            | 6    | 0                 | 0             | 4                  | 88    | 0     |
| omaha              | 6    | 0                 | 0             | 9                  | 80    | 0     |
| palace             | 6    | 2 (20px)          | 0             | 4                  | 100   | 0     |
| pinochle           | 3    | 13 (30px)         | 5             | 0                  | 51    | 0     |
| president          | 6    | 0                 | 0             | 4                  | 86    | 0     |
| rummy-500          | 6    | 103 (18px)        | 2             | 10                 | 105   | 0     |
| setback            | 5    | 0                 | 0             | 0                  | 79    | 0     |
| seven-card-stud    | 6    | 34 (20px)         | 0             | 4                  | 114   | 0     |
| slapjack           | 6    | 0                 | 0             | 4                  | 83    | 0     |
| spades             | 6    | 0                 | 1             | 4                  | 86    | 0     |
| spit               | 3    | 4 (26px)          | 0             | 2                  | 43    | 1     |
| spoons             | 6    | 0                 | 0             | 7                  | 74    | 0     |
| whist              | 3    | 0                 | 3             | 0                  | 44    | 0     |
| **all**            | 160  | 548               | 42            | 129                | 2384  | 1     |
