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

The same thousand deals (seeds 1–1000):

| Bots bid     | IMPs from par a deal | Within 2 IMPs | Slams bid (made) | Grand slams bid |
| ------------ | -------------------- | ------------- | ---------------- | --------------- |
| Natural      | 5.59                 | 38%           | 12 (12)          | 0               |
| SAYC         | 5.08                 | 42%           | 35 (28)          | 0               |
| Two over one | 5.11                 | 42%           | 36 (27)          | 0               |

The systems lose most where double dummy finds a slam that bidding rarely could (about one IMP a
deal), then in missed games and competitive auctions.

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
