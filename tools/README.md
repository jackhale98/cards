# Checking our records (and bots) with other people's programs

Our bots play bridge and Hold'em against each other, and two well-known open-source programs
check what happened:

- **[endplay](https://endplay.readthedocs.io/)** reads the bridge games (PBN). It checks every card
  against its own rules and our result against its count of the tricks. Its double-dummy solver
  (Bo Haglund's DDS, what bridge software uses) shows how many tricks each bot level threw
  away, compared with perfect play when every card is known. It also reads two duplicate
  tournaments of bots (pairs and teams, `event-*.pbn`, the results file a director saves): each
  table's score is worked out again from its contract and tricks, then the matchpoints or IMPs
  from the scores, and the standings from those.
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
| SAYC         | 4.86                 | 44%           | 42 (31)          | 0               |
| Two over one | 4.85                 | 44%           | 43 (31)          | 0               |

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

## Bridge bidding against EPBot

Par says how far the auctions land from perfect; it doesn't say whether a call is the one a good
player of the system would make. For that, `compare_bidding.py` puts our bots' auctions next to
EPBot's: the engine of Edward Piwowar's Bridge Bidding Analyzer (BBA), a strong rule-based bidder
that plays from a convention card. It ships, built for Linux, in the checkout of
[BEN](https://github.com/lorserker/ben) (GPL), with BBA's cards. Neither comes into the app.

```bash
git clone --depth 1 https://github.com/lorserker/ben ~/ben
python -m venv ~/ben-venv && ~/ben-venv/bin/pip install "numpy>=2.0,<2.1" scipy colorama endplay==0.5.12
SELFPLAY=1 GAMES=none BIDDING=1000 SYSTEM=1 OUT=records pnpm exec vitest run tests/selfplay.bench.test.ts
BEN_HOME=~/ben ~/ben-venv/bin/python tools/compare_bidding.py records/bridge-bidding.jsonl --system booklet \
  --disagreements records/differ.jsonl           # about five minutes
```

`--system booklet` is BBA's SAYC card with what the ACBL's SAYC booklet doesn't have switched off
(BBA's own card plays SAYC with Bergen raises, inverted minors, splinters, Smolen, Lebensohl, Drury
and key-card Blackwood); `sayc` and `21gf` are BBA's cards as they come. `--referee self` checks the
tool: our own calls back, every one agrees.

Two measures:

- **Call by call**: at each point of our auction, the call EPBot makes there, given the same calls
  before it, by stage of the auction. `active_agree` counts only the calls where either of them bid
  something (both passing says little). `--disagreements` writes every call they differ on, with the
  hand, for looking through.
- **Deal by deal**: EPBot bids the whole deal itself, and both contracts are scored double dummy
  against par.

The thousand deals (seeds 1–1000), October 2026: before and after the rules were put right by
what it showed (see below). The figures are the share of calls where either bid something and both
chose the same call:

| Stage                          | SAYC (booklet card): before | after | Two over one (BBA's card): before | after |
| ------------------------------ | --------------------------- | ----- | --------------------------------- | ----- |
| Opening                        | 86%                         | 87%   | 86%                               | 87%   |
| First response                 | 70%                         | 75%   | 68%                               | 70%   |
| Opener's rebid                 | 66%                         | 72%   | 66%                               | 70%   |
| Responder's rebid              | 33%                         | 35%   | 39%                               | 41%   |
| Later                          | 35%                         | 35%   | 36%                               | 34%   |
| Response, they've bid          | 34%                         | 48%   | 32%                               | 48%   |
| Opener's rebid, they've bid    | 24%                         | 26%   | 23%                               | 25%   |
| Responder's rebid, they've bid | 24%                         | 24%   | 21%                               | 22%   |
| Later, they've bid             | 14%                         | 16%   | 15%                               | 16%   |
| Defenders' first call          | 42%                         | 44%   | 40%                               | 42%   |
| Defenders' later calls         | 17%                         | 18%   | 17%                               | 18%   |

| IMPs from par a deal | Ours: before | after | EPBot |
| -------------------- | ------------ | ----- | ----- |
| SAYC                 | 5.10         | 4.86  | 4.68  |
| Two over one         | 5.12         | 4.85  | 4.53  |

Not every difference is ours to fix: some is EPBot's style (it makes weak twos on four points, and
on five cards third in hand; it jump-shifts with 15), and some is where the booklet allows either
(2NT over 1♦ with 13–15 balanced, which EPBot rarely bids). What it found that was ours, and is now
put right (each with a test in `tests/biddingSystems.test.ts`):

- **Weak twos** on poor suits and with a four-card major beside them; a hand worth opening one
  (Rule of 20) opened two; 11-point hands with aces and kings passed. Nothing after a weak two: now
  raises, a new suit forcing, and 2NT asking (SAYC: a feature; two over one: Ogust).
- **Over 1♣**, four-card suits up the line (1♦ with four diamonds and four spades); the opener's major
  before raising diamonds; 1NT rather than a five-card minor again.
- **Over 1NT**, Texas transfers. After Stayman with no fit, 4NT asks for the top of the range, not aces.
- **Raises:** a limit raise with three trumps only when light; after Jacoby 2NT, a short suit shown at
  any strength.
- **Forcing bids passed:** a reverse; the fourth suit forces a round in SAYC (to game in two over one),
  and support for responder's major comes before a stopper.
- **Their overcall:** a cue bid is the strong raise, the jump raise weak; a new suit forcing; 1NT
  with a stopper, but a negative double first with a four-card major (and never over 1NT). The opener,
  when it comes back round, reopens with a double when short in their suit.
- **Our overcalls:** weak jump overcalls; at the two level a good suit (over 1NT, six cards); after
  1♣ – pass – 1♥, both their suits counted (no unusual 2NT showing the opener's clubs).
- **Two over one:** a passed hand's two-level suit isn't game forcing.

Grading a person's bidding against our rules is close to trustworthy for openings and first
responses; past opener's rebid, and in contested auctions, the calls are still mostly judgment.

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
| Gin             | points a deal              | +0.28 ± 0.25    | +2.86 ± 0.32 |
| Oh Hell         | points a deal              | +0.46 ± 0.25    | +1.12 ± 0.26 |
| President       | places a hand              | −0.04 ± 0.05    | about level  |

(Setback's Hard plays the last four cards solved exactly and bids what that makes three deals in
four; its card play alone measured +0.53 ± 0.25. Cribbage's Normal is now an average player, a step
down; its Easy is a beginner. Normal against Easy: Cribbage +0.97 ± 0.16 a hand.)

Points a deal undersell a step in games that score a point or two a hand, so whole games
(`WHOLE=1`, which counts wins) say more. Two thirds a step is the aim where the game's luck allows
it: published work puts a strong player's edge over an average one near 55–60% in Cribbage and
Whist, and lower in Crazy Eights. The share of whole games the higher level won (two seats of each
level, or one partnership of each; 20–60 games both ways round, so a few points either way):

| Game         | Hard v Normal | Normal v Easy |
| ------------ | ------------- | ------------- |
| Bridge       | 75%           | 75%           |
| Cheat        | 69–73%        | 66%           |
| Cribbage     | 62%           | 62%           |
| Crazy Eights | 61%           | 69%           |
| Euchre       | 78%           | 62%           |
| Gin          | 66%+          | 68%           |
| Go Fish      | 66%           | 67%           |
| Hearts       | 80%           | 67%           |
| Oh Hell      | 84%           | 65%           |
| President    | 84%           | 69%           |
| Setback      | 66%           | 67%           |
| Spades       | 57%           | 66%           |
| Whist        | 59%           | 71%           |
| 500          | 75%           | 69%           |

Poker is counted in chips, over 20-hand sessions: Normal against Easy, Hold'em +510 ± 80, Omaha
+895 ± 100, Draw +369 ± 92, Stud +683 ± 67.

What the levels are, where they differ by game: Easy plays rules of thumb with a slip now and then;
in the games where every card counts toward the score (Hearts, Spades, Oh Hell, President) it also
plays a few deals out first, as its rules alone lost nearly every game to Normal. Crazy Eights'
Normal plays the rules of thumb too (its lookahead measured no better than Hard's). In Spades the
bots count each overtrick (a bag) at what ten of them cost; until they did, Normal lost whole
games to Easy, and then Hard to Normal. Cheat's Hard remembers what it put on the pile and where
picked-up piles went, and always challenges someone's last cards (it costs nothing: if they told
the truth they win either way). Go Fish's Hard weighs who most likely holds each rank.

Gin's Hard follows the 2021 AAAI Gin Rummy contest's papers: Maravich, Neller & Neller's knocking
rule, MARJJ's best-few-draws discard and its discard safety. Oh Hell's Hard bids by playing each bid
out. President's Hard (an endgame plan over Normal's rules) is about level with Normal: there, the
deal and the exchange decide most hands, and more would need a play policy tuned by self-play, as
the strongest Daihinmin programs use.

Tried and left out: weighing each imagined deal by how well it explains the others' plays (as the
Skat program Kermit does, with a model of play learned from human games). With the quick bot as the
model of how people play it didn't help (Hearts +2.2, Spades +6.4 with it).

## Thinking time (battery)

The same bench prints how long the bots thought: `PAIRS=0-0,1-1,2-2` gives, for each level, all
four seats' thinking over one deal (the app's time limits; this machine, four games at once).
Seconds of thinking a deal at a table of four bots:

| Game                                       | Easy | Normal | Hard  |
| ------------------------------------------ | ---- | ------ | ----- |
| Spades                                     | 0    | 1.0    | 7.5   |
| Whist                                      | 0    | 1.0    | 5.8   |
| Oh Hell                                    | 0    | 0.7    | 5.5   |
| President                                  | 0    | 0.8    | 4.7   |
| Setback                                    | 0    | 0.3    | 4.6   |
| Bridge                                     | 0    | 1.0    | 4.1   |
| Hearts                                     | 0    | 1.0    | 3.1   |
| 500, Omaha                                 | 0    | ≤ 0.7  | 1.8   |
| Seven Card Stud                            | 0    | 0.1    | 1.6   |
| Cribbage, Crazy Eights                     | 0    | ≤ 0.4  | 0.9   |
| Hold'em, Draw, Euchre, Gin, Cheat, Go Fish | 0    | ≤ 0.3  | ≤ 0.2 |

With people at the table the bots are fewer and a deal takes minutes, so even Hard thinks a few
percent of the time: next to the screen, which stays on all game, it's a small part of the battery.
Each move has its own time limit, and `src/net/pick.ts` caps them all together: the bots on one
device think at most a fifth of the time, in bursts of up to 6 seconds. That only bites where the
limits add up on a slow phone (Hard bridge play, 1.2 s a card), so a fast table of bots there
thinks less per card rather than running the phone flat out.
