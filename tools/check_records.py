"""Check Lamplight's game records with other people's programs, and measure our bots with them.

Reads the files tests/selfplay.bench.test.ts writes (see tools/README.md):

- Bridge (PBN), with endplay and its double-dummy solver (Bo Haglund's DDS):
  every file parses; every card is legal (endplay's own follow-suit rules); our Result matches the
  tricks endplay counts. Then, for strength: how many tricks each level's card play throws away
  against perfect (double-dummy) play, and each level's score against the others on the same
  deals, in IMPs.
- Hold'em (PHH), with PokerKit: every action is replayed through PokerKit's rules, strictly (it
  must be legal as written), and every player must finish with the chips we gave them.

Exits non-zero if any record is wrong. Strength figures are reported, not judged.

    python tools/check_records.py records
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
from collections import defaultdict

errors: list[str] = []


def fail(where: str, what: str) -> None:
    errors.append(f"{where}: {what}")


# ---- bridge -----------------------------------------------------------------------------

IMP_STEPS = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300,
             1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000]


def imps(diff: int) -> int:
    """A score difference in IMPs (International Match Points), as teams score duplicate."""
    n = sum(1 for step in IMP_STEPS if abs(diff) >= step)
    return n if diff >= 0 else -n


def check_bridge(folder: str) -> dict:
    from endplay import dds
    from endplay.parsers import pbn
    from endplay.types import Player

    levels = sorted({int(x) for f in glob.glob(f"{folder}/bridge-ns*-ew*.pbn")
                     for x in re.findall(r"\d", os.path.basename(f))})
    # per level: cards played, tricks thrown away (declaring / defending)
    lost = defaultdict(lambda: {"cards": 0, "decl": 0, "defe": 0, "deals_decl": 0, "deals_def": 0})
    ns_score: dict[tuple[int, int], list[int]] = {}
    par_gap = defaultdict(list)

    for path in sorted(glob.glob(f"{folder}/bridge-ns*-ew*.pbn")):
        ns, ew = (int(x) for x in re.findall(r"ns(\d)-ew(\d)", path)[0])
        name = os.path.basename(path)
        try:
            with open(path, encoding="latin-1") as f:
                boards = pbn.load(f)
        except Exception as e:  # noqa: BLE001 (any parse failure is the finding)
            fail(name, f"endplay can't read it: {e}")
            continue
        scores = []
        for i, b in enumerate(boards, 1):
            where = f"{name} deal {i}"
            hands = [b.deal[p] for p in Player]
            if sorted(len(h) for h in hands) != [13] * 4:
                fail(where, f"the deal isn't four hands of 13: {b.deal}")
                continue
            c = b.contract
            table = dds.calc_dd_table(b.deal)
            par = dds.par(table, b.vul, b.dealer)
            if c is None or c.is_passout():
                scores.append(0)
                par_gap[(ns, ew)].append(imps(0 - par.score))
                if b.play:
                    fail(where, "a passed-out deal has play")
                continue
            # the play, card by card through endplay's rules
            d = b.deal.copy()
            d.first = c.declarer.next()
            d.trump = c.denom
            who = []
            for card in b.play:
                if card not in d.legal_moves():
                    fail(where, f"{d.curplayer.name} can't play {card} (endplay's rules)")
                    break
                who.append(d.curplayer)
                d.play(card)
            else:
                if len(b.play) == 52:
                    dd = list(dds.analyse_play(_start(b, c), b.play, False))
                    taken = dd[-1]
                    expected = c.level + 6 + c.result
                    if taken != expected:
                        fail(where, f"declarer took {taken} tricks by endplay's count, our result says {expected}")
                    # each card's cost against double-dummy play, to its side
                    decl_side = {c.declarer, c.declarer.partner}
                    # (it stops before the last trick, whose four cards are forced)
                    for k, p in enumerate(who[: len(dd) - 1]):
                        level = ns if p in (Player.north, Player.south) else ew
                        delta = dd[k + 1] - dd[k]
                        lost[level]["cards"] += 1
                        if p in decl_side:
                            lost[level]["decl"] += max(0, -delta)
                        else:
                            lost[level]["defe"] += max(0, delta)
                    decl_level = ns if c.declarer in (Player.north, Player.south) else ew
                    def_level = ew if decl_level == ns else ns
                    lost[decl_level]["deals_decl"] += 1
                    lost[def_level]["deals_def"] += 1
            score = c.score(b.vul)
            ns_points = score if c.declarer in (Player.north, Player.south) else -score
            scores.append(ns_points)
            par_gap[(ns, ew)].append(imps(ns_points - par.score))
        ns_score[(ns, ew)] = scores

    # duplicate: level a against level b on the same deals, both ways round
    matches = {}
    for a in levels:
        for b_ in levels:
            if a >= b_ or (a, b_) not in ns_score or (b_, a) not in ns_score:
                continue
            one, two = ns_score[(b_, a)], ns_score[(a, b_)]
            n = min(len(one), len(two))
            # (level b_ sat North-South in `one` and East-West in `two`)
            total = sum(imps(one[k] - two[k]) for k in range(n))
            matches[f"{b_} v {a}"] = {"deals": n, "imps_per_deal": round(total / max(1, n), 2)}

    return {
        "card_play": {
            str(level): {
                "tricks_lost_declaring_per_deal": round(v["decl"] / max(1, v["deals_decl"]), 2),
                "tricks_lost_defending_per_deal": round(v["defe"] / max(1, v["deals_def"]), 2),
            }
            for level, v in sorted(lost.items())
        },
        "against_par_imps_per_deal": {
            f"NS {ns} v EW {ew}": round(sum(v) / max(1, len(v)), 2) for (ns, ew), v in sorted(par_gap.items())
        },
        "matches": matches,
    }


def _start(board, contract):
    """The deal ready for the opening lead, as endplay's double-dummy analysis wants it."""
    d = board.deal.copy()
    d.first = contract.declarer.next()
    d.trump = contract.denom
    return d


def check_bidding(path: str) -> dict:
    """Bidding alone: each contract the bots reached, played perfectly (double dummy), against par.

    The file is bridge-bidding.jsonl (BIDDING=n in the self-play): every deal's hands, dealer,
    vulnerability, the auction and the contract (or none: passed out). Card play doesn't come
    into it, so this measures the bidding: IMPs a deal against par (the score of the best contract
    for both sides, each bidding and playing perfectly), and how often the bots bid the games and
    slams that double dummy makes, or bid one that fails.
    """
    from endplay import dds
    from endplay.types import Contract, Deal, Denom, Penalty, Player, Vul

    denom = {"C": Denom.clubs, "D": Denom.diamonds, "H": Denom.hearts, "S": Denom.spades, "NT": Denom.nt}
    seat = {"N": Player.north, "E": Player.east, "S": Player.south, "W": Player.west}
    gaps: list[int] = []
    tally = defaultdict(int)
    # where the IMPs went: each deal's distance from par, put down to one cause
    lost = defaultdict(int)
    with open(path) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    for k, r in enumerate(rows, 1):
        where = f"bidding deal {k}"
        deal = Deal(r["deal"])
        ns_vul, ew_vul = r["vul"]
        vul = Vul.both if ns_vul and ew_vul else Vul.ns if ns_vul else Vul.ew if ew_vul else Vul.none
        table = dds.calc_dd_table(deal)
        par = dds.par(table, vul, seat[r["dealer"]])
        c = r["contract"]
        if c is None:
            ns = 0
            tally["passed_out"] += 1
        else:
            decl = seat[c["declarer"]]
            tricks = table[denom[c["strain"]], decl]
            pen = [Penalty.passed, Penalty.doubled, Penalty.redoubled][c["dbl"]]
            contract = Contract(level=c["level"], denom=denom[c["strain"]], declarer=decl, penalty=pen, result=tricks - c["level"] - 6)
            score = contract.score(vul)
            ns = score if decl in (Player.north, Player.south) else -score
            made = tricks >= c["level"] + 6
            game = c["level"] >= 5 or (c["level"] >= 4 and c["strain"] in ("H", "S")) or (c["level"] >= 3 and c["strain"] == "NT")
            kind = "grand" if c["level"] == 7 else "slam" if c["level"] == 6 else "game" if game else "part"
            tally[f"{kind}_bid"] += 1
            tally[f"{kind}_made"] += int(made)
        gaps.append(imps(ns - par.score))
        if abs(gaps[-1]) >= 10:
            tally["big_misses"] += 1
        lost[cause(r, table, par.score, c)] += abs(gaps[-1])
    n = max(1, len(gaps))
    return {
        "deals": len(gaps),
        # (both sides bid the same way, so North-South's average against par comes out near zero:
        # how far each deal ends from par, either way, is what says how well both bid)
        "imps_from_par_per_deal": round(sum(abs(g) for g in gaps) / n, 2),
        "ns_imps_per_deal_against_par": round(sum(gaps) / n, 2),
        "deals_within_2_imps_of_par": round(sum(1 for g in gaps if abs(g) <= 2) / n, 3),
        "contracts": {key: tally[key] for key in sorted(tally)},
        "imps_lost_per_deal_by_cause": {key: round(lost[key] / n, 2) for key in sorted(lost)},
    }


def cause(r: dict, table, par: int, c: dict | None) -> str:
    """Why a contract isn't par: it went down; or the side that owns the deal stopped short of a
    slam (or a game) that double dummy makes; or anything else (the strain, a part-score fight,
    a sacrifice, a penalty)."""
    from endplay.types import Denom, Player

    if c is not None:
        denom = {"C": Denom.clubs, "D": Denom.diamonds, "H": Denom.hearts, "S": Denom.spades, "NT": Denom.nt}
        decl = {"N": Player.north, "E": Player.east, "S": Player.south, "W": Player.west}[c["declarer"]]
        if table[denom[c["strain"]], decl] < c["level"] + 6:
            game = c["level"] >= 5 or (c["level"] >= 4 and c["strain"] in ("H", "S")) or (c["level"] >= 3 and c["strain"] == "NT")
            return "slam_went_down" if c["level"] >= 6 else "game_went_down" if game else "part_went_down"
    owners = (Player.north, Player.south) if par >= 0 else (Player.east, Player.west)
    ours = c is not None and c["declarer"] in ("NS" if par >= 0 else "EW")
    level = c["level"] if ours else 0
    strain = c["strain"] if ours else ""
    best = lambda d: max(table[d, p] for p in owners)
    games = {Denom.clubs: 11, Denom.diamonds: 11, Denom.hearts: 10, Denom.spades: 10, Denom.nt: 9}
    if any(best(d) >= 12 for d in games) and level < 6:
        return "slam_missed"
    game_bid = level >= 5 or (level >= 4 and strain in ("H", "S")) or (level >= 3 and strain == "NT")
    if any(best(d) >= t for d, t in games.items()) and not game_bid:
        return "game_missed"
    return "other"


# ---- poker ------------------------------------------------------------------------------

def alone(state) -> bool:
    """Only one player left in the hand with chips to bet (everyone else folded or all in)."""
    return sum(1 for i, live in enumerate(state.statuses) if live and state.stacks[i] > 0) <= 1


def settle(state, next_action: str | None = None) -> None:
    """What the dealer does between written actions: burn a card before each street, and turn
    the hands over at a showdown (PokerKit decides who shows, and in what order).

    Before the next street (or the end), a check with nothing to call: when everyone else is all
    in and a player has already matched them, we move straight on, where PokerKit still asks
    that player to check. It changes nothing, so it's made here rather than written."""
    while True:
        if state.can_burn_card():
            state.burn_card("??")
        elif state.can_show_or_muck_hole_cards():
            state.show_or_muck_hole_cards(True)
        elif (
            (next_action is None or next_action.startswith("d db"))
            and state.can_check_or_call()
            and not state.checking_or_calling_amount
            and alone(state)
        ):
            state.check_or_call()
        else:
            return


def check_poker(folder: str) -> dict:
    from pokerkit.notation import HandHistory, parse_action

    hands = 0
    short_blinds = 0
    for path in sorted(glob.glob(f"{folder}/*.phh")):
        name = os.path.basename(path)
        with open(path, "rb") as f:
            try:
                histories = list(HandHistory.load_all(f))
            except Exception as e:  # noqa: BLE001
                fail(name, f"PokerKit can't read it: {e}")
                continue
        for i, hh in enumerate(histories, 1):
            where = f"{name} hand {i}"
            hands += 1
            # a big blind all in for less than the blind: by the usual rule (ours) the bet to call is
            # still the full big blind; PokerKit makes it what the blind put in. From there the two
            # replays part ways (who's asked to act, the chips put in), so the hand is counted, not
            # checked. Not a mistake on either side.
            blinds = hh.blinds_or_straddles
            if any(0 < hh.starting_stacks[k] < blinds[k] for k in range(min(len(blinds), len(hh.starting_stacks)))):
                short_blinds += 1
                continue
            try:
                state = hh.create_state()
            except Exception as e:  # noqa: BLE001
                fail(where, f"PokerKit won't set up the hand: {e}")
                continue
            ok = True
            for action in hh.actions:
                # (showing at a showdown: see settle)
                if " sm " in action:
                    continue
                settle(state, action)
                try:
                    parse_action(state, action, hh.parse_value)
                except Exception as e:  # noqa: BLE001
                    fail(where, f"'{action}' isn't legal for PokerKit: {e}")
                    ok = False
                    break
            if not ok:
                continue
            settle(state)
            if state.status:
                fail(where, "PokerKit thinks the hand isn't over")
                continue
            if list(state.stacks) != list(hh.finishing_stacks):
                fail(where, f"chips at the end: ours {list(hh.finishing_stacks)}, PokerKit's {list(state.stacks)}")
    result: dict = {"hands_checked": hands, "short_big_blind_hands_skipped": short_blinds}
    summary = f"{folder}/holdem-hu.json"
    if os.path.exists(summary):
        with open(summary) as f:
            nets = json.load(f)
        out = {}
        for key, xs in nets.items():
            n = len(xs)
            mean = sum(xs) / max(1, n)
            sd = (sum((x - mean) ** 2 for x in xs) / max(1, n)) ** 0.5 / max(1, n) ** 0.5
            out[key] = {"hands": n, "bb_per_100": round(mean * 100, 1), "plus_minus": round(sd * 100, 1)}
        result["heads_up"] = out
    return result


def main() -> int:
    folder = sys.argv[1] if len(sys.argv) > 1 else "records"
    report = {}
    if glob.glob(f"{folder}/*.pbn"):
        report["bridge"] = check_bridge(folder)
    if os.path.exists(f"{folder}/bridge-bidding.jsonl"):
        report["bridge_bidding"] = check_bidding(f"{folder}/bridge-bidding.jsonl")
    if glob.glob(f"{folder}/*.phh"):
        report["holdem"] = check_poker(folder)
    print(json.dumps(report, indent=2))
    with open(f"{folder}/report.json", "w") as f:
        json.dump(report, f, indent=2)
    if errors:
        print(f"\n{len(errors)} problem(s) in the records:", file=sys.stderr)
        for e in errors[:50]:
            print(f"  {e}", file=sys.stderr)
        return 1
    print("\nEvery record checks out.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
