# Checking our records (and bots) with other people's programs

Our bots play bridge and Hold'em against each other, and two well-known open-source programs
check what happened:

- **[endplay](https://endplay.readthedocs.io/)** reads the bridge games (PBN). It checks every card
  against its own rules and our result against its count of the tricks. Its double-dummy solver
  (Bo Haglund's DDS, what bridge software uses) shows how many tricks each bot level threw
  away, compared with perfect play when every card is known.
- **[PokerKit](https://pokerkit.readthedocs.io/)** (University of Toronto) replays every Hold'em
  hand (PHH) through its own rules. Every action has to be legal as written, and everyone has to
  finish with the chips we gave them: blinds, minimum raises, all-ins, side pots and showdowns.
  One rule differs: when the big blind is all in for less than the blind, we (by the usual rule)
  still have everyone call the full big blind, where PokerKit has them call what was put in. The
  report counts those hands (`short_big_blind_hands_skipped`) instead of failing them.

```bash
pip install -r tools/requirements.txt          # Python 3.9–3.13
pnpm records                                   # bots play; files land in records/
python tools/check_records.py records          # the checks, and a strength report (records/report.json)
```

`pnpm records` takes `DEALS` (bridge deals per pairing of levels, default 12) and `HANDS`
(heads-up Hold'em hands per pairing, each played twice with the seats swapped, default 200).
`PAIRS=1-2` plays only those pairings of levels, and `SEED0` starts the seeds further on, so
several runs can share out a long measurement. Heads-up poker is noisy: a hand where both are all
in with cards to come counts each player's fair share of the pot (their chance of winning it), not
how the last cards fell. Even so, telling two good levels apart takes many thousands of hands.
CI runs a small version on every push (the `records` job) and keeps the files as an artifact.

The files show every card, which a player's own download never does (see `EVERYONE` in
`src/net/exports/types.ts`). PHH is only written here: at the table, poker is saved as Open Hand
History, which poker tools read.

## Reading the strength report

- `card_play`: tricks lost per deal against double-dummy play, declaring and defending, by level
  (0 Easy, 1 Normal, 2 Hard). Double dummy sees every card, so even experts lose some.
- `matches`: one level against another on the same deals, both ways round, in IMPs a deal
  (as teams score duplicate bridge). Positive: the first level is better.
- `against_par_imps_per_deal`: North-South's score against the par score (what perfect bidding
  and play by both sides would get).
- `heads_up`: Hold'em, big blinds won per 100 hands by the first level against the second, with
  its standard error.

## Bridge bidding against par

The bots' bidding on its own: they bid a thousand deals (every dealer and vulnerability in turn),
nobody plays, and endplay scores the contract each deal reached at double-dummy tricks against the
par score (the best result for both sides bidding and playing perfectly).

```bash
SELFPLAY=1 GAMES=none BIDDING=1000 SYSTEM=1 OUT=records pnpm exec vitest run tests/selfplay.bench.test.ts
python tools/check_records.py records          # bridge_bidding in the report
```

`SYSTEM` is the lobby's "Bots bid": 0 Natural (the plain bidder), 1 SAYC, 2 two over one.

- `imps_from_par_per_deal`: how far, on average, the contract lands from par, either way, in IMPs.
  Lower is better; 0 would be perfect, and double dummy sees every card, so no real bidding gets
  there.
- `deals_within_2_imps_of_par`: the share of deals that end at (or very near) par.
- `contracts`: part scores, games and slams bid and how many make at double dummy; `big_misses` are
  deals 10 or more IMPs from par.
- `imps_lost_per_deal_by_cause`: where the IMPs from par went, each deal put down to one cause: the
  contract went down (a part score, game or slam), the side that owns the deal stopped short of a
  slam or game that double dummy makes, or anything else (the strain, a part-score fight, a
  sacrifice).

The same thousand deals (seeds 1–1000):

| Bots bid     | IMPs from par a deal | Within 2 IMPs | Slams bid (made) | Grand slams bid |
| ------------ | -------------------- | ------------- | ---------------- | --------------- |
| Natural      | 5.59                 | 38%           | 12 (12)          | 0               |
| SAYC         | 5.10                 | 42%           | 32 (26)          | 0               |
| Two over one | 5.12                 | 42%           | 31 (24)          | 0               |

The systems lose most where double dummy finds a slam that bidding rarely could (about 1.2 IMPs a
deal), then in games that go down (1.2), games missed (1.0) and part scores that go down (0.9).

Adding the standard follow-ups (Jacoby 2NT's answers, quantitative 4NT, key-card Blackwood and the
queen ask in two over one, help-suit game tries, new minor forcing, fourth suit forcing, fast
arrival, Michaels, the unusual 2NT and balancing) left these numbers where they were (5.08 and 5.11
before): where the rules run out, the bots already place the contract from what partner has shown,
so the conventions mostly reach the same contracts by the book. They matter for a person
partnering a bot, who can read its calls. Measuring against par also counts a good obstruction (a
Michaels bid that keeps the other side out of their slam) as a miss for both sides: with only
North-South bidding Michaels, the unusual 2NT and balancing, North-South came out level (0.27 IMPs
a deal against par, from 0.26).

### The trick estimator

Where the rules run out, the bots choose a contract by estimating, for hands partner could hold,
how many tricks each strain would take. The estimate is fitted to double-dummy results:

```bash
python tools/dd_deals.py 12000 dd.jsonl                                  # about twenty minutes
TRICKS_DD=dd.jsonl pnpm exec vitest run tests/tricks.bench.test.ts       # prints the weights, and how close they come
```

The weights go in `src/engine/families/trick/systems/tricks.ts`. On deals it wasn't fitted to,
the estimate is within about a trick (an eight-card fit or better: typical error 1.07 tricks; no
trumps with 20+ points: 1.23).

## DDS for the Hard bots in the partnership trick games

The Hard bots play bridge's cards the way the strong bridge programs do: they deal the cards they
can't see many times over (each deal fitting what's public: the cards played, who has shown out,
and in SAYC or two over one what the bids promised), solve each deal double dummy with DDS, and
play the card that does best across them (`src/engine/families/trick/ddPlay.ts`). Spades, Whist,
Euchre and 500 play the same way: DDS plays by bridge's rules, and their cards fit once renamed
(Euchre's bowers and 500's joker become the top trumps). In those games Hard also bids from solved
deals: Spades bids what the side makes on all but the worst deal in seven, Euchre orders up or
names trumps by what each choice scores, and 500 bids the cheapest contract it makes seven deals in
ten.

DDS is Bo Haglund and Soren Hein's solver (Apache License 2.0), the one endplay uses. It's built to
WebAssembly, single-threaded, from a pinned release:

```bash
tools/dds/build.sh            # DDS v2.9.0 and Emscripten 3.1.61, into src/engine/bots/dds/ddsWasm.js
```

`tests/ddPlay.test.ts` checks it against endplay on every strain and declarer of a few deals
(`tests/fixtures/dd-endplay.jsonl`). In the self-play bench `DD_SAMPLES` sets how many deals the
Hard bots solve a card (the test runner uses a fixed few; the app, up to 40 within 1.2 seconds).

Measured on 160 deals (`PAIRS=1-2,2-1,1-1,2-2 DD_SAMPLES=24`), Hard against Normal:

|                                            | tricks lost a deal, declaring | defending |
| ------------------------------------------ | ----------------------------- | --------- |
| Normal (rules of thumb and a small search) | 1.60                          | 1.74      |
| Hard (24 deals solved a card)              | 0.36                          | 0.74      |

On the same cards both ways round, Hard beat Normal by about 4 IMPs a deal.

## Bot levels, one against another

`tests/levels.bench.test.ts` plays each game's levels against each other: each deal twice with the
sides swapped, every bot seeing only its own seat. `--mode bench` gives the bots the app's time
limits (under the test runner they'd think without a clock); `HANDS` plays sessions, so poker
players' habits build up as at a real table.

```bash
LEVELS=1 PAIRS=2-1 DEALS=150 GAMES=hearts,spades npx vitest run tests/levels.bench.test.ts --mode bench
LEVELS=1 PAIRS=2-1 DEALS=60 HANDS=20 GAMES=holdem npx vitest run tests/levels.bench.test.ts --mode bench
```

Hard against Normal, before and after the Hard bots were rebuilt (± one standard error; for poker,
before is chips a single hand, after chips a 20-hand session):

| Game            | Measure                    | Before          | After        |
| --------------- | -------------------------- | --------------- | ------------ |
| Hold'em         | chips a session (20 hands) | +4 ± 8 a hand   | +177 ± 75    |
| Omaha           | chips a session (20 hands) | −15 ± 9 a hand  | +501 ± 82    |
| Five Card Draw  | chips a session (20 hands) | +26 ± 15 a hand | +261 ± 101   |
| Seven Card Stud | chips a deal               | −3 ± 10         | +14 ± 6      |
| Spades          | points a deal              | +2.1 ± 1.7      | +8.5 ± 2.1   |
| Hearts          | points a deal (fewer)      | +0.7 ± 0.6      | +2.8 ± 0.5   |
| Euchre          | points a deal              | +0.08 ± 0.05    | +0.34 ± 0.05 |
| Whist           | points a deal              | +0.37 ± 0.11    | +0.48 ± 0.09 |
| 500             | points a deal              | +5 ± 4          | +7 ± 4       |
| Setback         | points a deal              | —               | +0.21 ± 0.17 |
| Cribbage        | points a hand              | −0.30 ± 0.17    | +0.63 ± 0.15 |
| Gin             | points a deal              | +0.28 ± 0.25    | +1.99 ± 0.28 |

(Setback's Hard plays the last four cards solved exactly and bids what that makes three deals in
four; its card play alone measured +0.53 ± 0.25. Cribbage's Normal is now an average player, a step
down; its Easy is a beginner. Normal against Easy: Cribbage +0.97 ± 0.16 a hand.)

Points a deal undersell a step in games that score a point or two a hand, so whole games
(`WHOLE=1`, which counts wins) say more. Hard against Normal: Euchre 78%, Whist 59%, Cribbage
60%. Normal against Easy: Cribbage 55%, Gin 68%. Two thirds a step is the aim.

Tried and left out: weighing each imagined deal by how well it explains the others' plays (as the
Skat program Kermit does, with a model of play learned from human games). With the quick bot as the
model of how people play it didn't help (Hearts +2.2, Spades +6.4 with it).
