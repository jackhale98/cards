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
