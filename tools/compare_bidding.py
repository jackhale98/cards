"""Our bots' bidding next to another program's, on the same deals.

The deals are bridge-bidding.jsonl from the self-play (BIDDING=n in tests/selfplay.bench.test.ts): each
deal's hands, dealer, vulnerability and our bots' auction. Two measures:

- Call by call: at each point of our auction, the call the other program makes there (given the same
  calls before it), by stage: the opening, the response, opener's rebid, responder's rebid, later calls,
  each side's calls when the other side has bid, and the defenders'. Where the two agree, our rules say
  what a good bidder says; where they differ is where to look.
- Deal by deal: the other program bids the whole deal on its own (all four seats), and both contracts
  are played perfectly (double dummy): how far each lands from par, in IMPs.

  BEN_HOME=~/ben python tools/compare_bidding.py records/bridge-bidding.jsonl --system booklet
  python tools/compare_bidding.py records/bridge-bidding.jsonl --referee self      # checks the tool itself

The referees: `epbot` (Edward Piwowar's EPBot, the engine of his Bridge Bidding Analyzer, BBA, which ships
in BEN's checkout: github.com/lorserker/ben, BEN_HOME), `self` (replays our own calls: every call agrees).
EPBot (and BEN) never go into the app: only this tool loads them, to bid the deals.
"""

import argparse
import json
import os
import sys
from collections import defaultdict

SEATS = "NESW"
STRAINS = "CDHSN"


def call_name(c) -> str:
    """Our call (0 = 1♣ … 34 = 7NT, 'P', 'X', 'XX') as BEN and BBA write it."""
    if c == "P":
        return "PASS"
    if c in ("X", "XX"):
        return c
    return f"{c // 5 + 1}{STRAINS[c % 5]}"


def our_call(c: str):
    """BEN's and BBA's name for a call back to ours (the other way from call_name)."""
    if c == "PASS":
        return "P"
    if c in ("X", "XX"):
        return c
    return (int(c[0]) - 1) * 5 + STRAINS.index(c[1])


def stages(calls: list[str], dealer: int) -> list[str]:
    """Each call's stage of the auction, from the side that opened (see the module's comment)."""
    out = []
    opener = None
    count = defaultdict(int)
    they_bid = False
    for i, c in enumerate(calls):
        seat = (dealer + i) % 4
        if opener is None:
            out.append("opening")
            if c != "PASS":
                opener = seat
                count[seat] = 1
            continue
        mine = seat % 2 == opener % 2
        n = count[seat]
        count[seat] += 1
        if mine:
            name = (
                ("opener rebid" if n == 1 else "later")
                if seat == opener
                else ("response" if n == 0 else "responder rebid" if n == 1 else "later")
            )
            out.append(name + (" (contested)" if they_bid else ""))
        else:
            out.append("defence first" if n == 0 else "defence later")
            if c != "PASS":
                they_bid = True
    return out


def auction_over(calls: list[str]) -> bool:
    return (len(calls) >= 4 and all(c == "PASS" for c in calls)) or (
        len(calls) >= 4 and any(c != "PASS" for c in calls) and calls[-3:] == ["PASS"] * 3
    )


def contract_of(calls: list[str], dealer: int):
    """The contract an auction reached (None: passed out): level, strain, doubled, declarer."""
    last = max((i for i, c in enumerate(calls) if c not in ("PASS", "X", "XX")), default=None)
    if last is None:
        return None
    bid = calls[last]
    dbl = 0
    for c in calls[last + 1 :]:
        dbl = 1 if c == "X" else 2 if c == "XX" else dbl
    side = (dealer + last) % 2
    strain = bid[1]
    declarer = next((dealer + i) % 4 for i, c in enumerate(calls) if (dealer + i) % 2 == side and c[1:] == strain and c[0].isdigit())
    return {"level": int(bid[0]), "strain": "NT" if strain == "N" else strain, "dbl": dbl, "declarer": SEATS[declarer]}


class SelfReferee:
    """Our own calls back: checks the tool (every call agrees, the same contracts)."""

    def __init__(self, row):
        self.calls = [call_name(c) for c in row["calls"]]

    def call(self, seat: int, before: list[str]) -> str:
        return self.calls[len(before)] if len(before) < len(self.calls) else "PASS"


def booklet_card(home: str) -> str:
    """BBA's SAYC card with what the ACBL's SAYC booklet doesn't have switched off (BBA's card plays
    SAYC with many additions: Bergen raises, inverted minors, splinters, Smolen, Lebensohl, Drury,
    key-card Blackwood...), written next to it once. Our reading of the booklet: check it against yours."""
    off = {
        "1N-3C transfer to diamonds", "1N-3D splinter", "1N-3M splinter", "Bergen", "Blackwood 1430", "Drury", "DOPI",
        "ROPI", "Exclusion", "Extended acceptance after NT", "Super acceptance after NT", "Fit showing jumps",
        "Inverted minors", "Leaping Michaels", "Lebensohl after 1NT", "Lebensohl after double", "Maximal Doubles",
        "Mixed raise", "Multi-Landy", "Ogust", "Responsive double", "SMOLEN", "Splinter", "Support double redouble",
        "Two suit takeout double", "Two way game tries", "Two Way New Minor Forcing", "Unusual 1NT", "Unusual 4NT",
        "Extended Stayman", "Minor Suit Stayman after 2NT", "Imposible 2S", "Strength Lawrence structure",
        "5NT pick a slam",
    }
    on = {"Blackwood without K and Q", "Gerber only for NT openings", "1N-3D natural"}
    out = os.path.join(home, "BBA", "CC", "Booklet-Sayc.bbsa")
    with open(os.path.join(home, "BBA", "CC", "BBA-Sayc.bbsa"), newline="") as f:
        lines = f.read().replace("\r", "").split("\n")
    for i, line in enumerate(lines):
        if " = " in line:
            k = line.rsplit(" = ", 1)[0]
            if k in off or k in on:
                lines[i] = f"{k} = {int(k in on)}"
    with open(out, "w", newline="") as f:
        f.write("\r\n".join(lines))
    return out


class EPBotReferee:
    """EPBot, through BEN's wrapper, with one of BBA's convention cards for both sides."""

    CARDS = {"sayc": "BBA-Sayc.bbsa", "21gf": "BBA-21GF.bbsa"}
    _booklet = None

    def __init__(self, row, system: str):
        home = os.environ.get("BEN_HOME")
        if not home:
            sys.exit("Set BEN_HOME to a BEN checkout (github.com/lorserker/ben)")
        sys.path.insert(0, os.path.join(home, "src"))
        os.environ.setdefault("BBA_BIN", os.path.join(home, "bin"))
        from bba.BBA import BBABotBid

        # (a convention card of our own, the booklet's SAYC, or one of BBA's)
        if system == "booklet":
            EPBotReferee._booklet = EPBotReferee._booklet or booklet_card(home)
            card = EPBotReferee._booklet
        elif system.endswith(".bbsa"):
            card = os.path.abspath(system)
        else:
            card = os.path.join(home, "BBA", "CC", self.CARDS[system])
        hands = row["deal"][2:].split(" ")
        dealer = SEATS.index(row["dealer"])
        self.bots = [BBABotBid(card, card, seat, hands[seat], list(row["vul"]), dealer, False, False) for seat in range(4)]

    def call(self, seat: int, before: list[str]) -> str:
        return self.bots[seat].bid(before).bid


def referee_for(name: str, row, system: str):
    return SelfReferee(row) if name == "self" else EPBotReferee(row, system)


def imps(diff: int) -> int:
    steps = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000]
    n = sum(1 for s in steps if abs(diff) >= s)
    return n if diff >= 0 else -n


def dd_score(deal, table, vul, c) -> int:
    """North–South's score for a contract played double dummy (0 when passed out)."""
    from endplay.types import Contract, Denom, Penalty, Player

    if c is None:
        return 0
    denom = {"C": Denom.clubs, "D": Denom.diamonds, "H": Denom.hearts, "S": Denom.spades, "NT": Denom.nt}
    decl = [Player.north, Player.east, Player.south, Player.west][SEATS.index(c["declarer"])]
    tricks = table[denom[c["strain"]], decl]
    pen = [Penalty.passed, Penalty.doubled, Penalty.redoubled][c["dbl"]]
    score = Contract(level=c["level"], denom=denom[c["strain"]], declarer=decl, penalty=pen, result=tricks - c["level"] - 6).score(vul)
    return score if decl in (Player.north, Player.south) else -score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--referee", default="epbot", choices=["epbot", "self"])
    ap.add_argument("--system", default="sayc", help="booklet (the ACBL booklet's SAYC), sayc or 21gf (BBA's cards), or a .bbsa file")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--disagreements", help="write each call the two differ on here (JSON lines)")
    ap.add_argument("--their-auctions", help="write the referee's own auctions here, as bridge-bidding.jsonl is written (for check_records.py)")
    args = ap.parse_args()

    from endplay import dds
    from endplay.types import Deal, Player, Vul

    with open(args.path) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    if args.limit:
        rows = rows[: args.limit]

    by_stage = defaultdict(lambda: {"calls": 0, "agree": 0, "active": 0, "active_agree": 0})
    ours_from_par, theirs_from_par, head = [], [], []
    differ = open(args.disagreements, "w") if args.disagreements else None
    own_out = open(args.their_auctions, "w") if args.their_auctions else None
    for row in rows:
        dealer = SEATS.index(row["dealer"])
        ours = [call_name(c) for c in row["calls"]]
        ref = referee_for(args.referee, row, args.system)
        for i, (c, stage) in enumerate(zip(ours, stages(ours, dealer))):
            seat = (dealer + i) % 4
            theirs = ref.call(seat, ours[:i])
            t = by_stage[stage]
            t["calls"] += 1
            t["agree"] += int(theirs == c)
            # (both passing says little: count the calls where either of them bid)
            if c != "PASS" or theirs != "PASS":
                t["active"] += 1
                t["active_agree"] += int(theirs == c)
            if differ and theirs != c:
                differ.write(json.dumps({"seed": row["seed"], "deal": row["deal"], "dealer": row["dealer"], "vul": row["vul"],
                                         "before": ours[:i], "seat": SEATS[seat], "stage": stage, "ours": c, "theirs": theirs}) + "\n")
        # the referee's own auction, every seat
        own: list[str] = []
        while not auction_over(own) and len(own) < 100:
            own.append(ref.call((dealer + len(own)) % 4, list(own)))
        if own_out:
            own_out.write(json.dumps({**row, "calls": [our_call(c) for c in own], "contract": contract_of(own, dealer)}) + "\n")
        deal = Deal(row["deal"])
        ns_vul, ew_vul = row["vul"]
        vul = Vul.both if ns_vul and ew_vul else Vul.ns if ns_vul else Vul.ew if ew_vul else Vul.none
        table = dds.calc_dd_table(deal)
        par = dds.par(table, vul, [Player.north, Player.east, Player.south, Player.west][dealer]).score
        mine = dd_score(deal, table, vul, contract_of(ours, dealer))
        other = dd_score(deal, table, vul, contract_of(own, dealer))
        ours_from_par.append(abs(imps(mine - par)))
        theirs_from_par.append(abs(imps(other - par)))
        head.append(abs(imps(mine - par)) - abs(imps(other - par)))
    if differ:
        differ.close()
    if own_out:
        own_out.close()

    n = max(1, len(rows))
    order = ["opening", "response", "opener rebid", "responder rebid", "later",
             "response (contested)", "opener rebid (contested)", "responder rebid (contested)", "later (contested)",
             "defence first", "defence later"]
    report = {
        "deals": len(rows),
        "referee": args.referee if args.referee == "self" else f"epbot {args.system}",
        "calls_by_stage": {
            s: {
                "calls": t["calls"],
                "agree": round(t["agree"] / max(1, t["calls"]), 3),
                # (the calls where either bid something: the honest agreement figure)
                "active_calls": t["active"],
                "active_agree": round(t["active_agree"] / max(1, t["active"]), 3),
            }
            for s in order
            if (t := by_stage.get(s))
        },
        "imps_from_par_per_deal": {"ours": round(sum(ours_from_par) / n, 2), "theirs": round(sum(theirs_from_par) / n, 2)},
        # (positive: ours lands further from par than theirs on that deal)
        "deals_ours_further_from_par": sum(1 for h in head if h > 0),
        "deals_theirs_further_from_par": sum(1 for h in head if h < 0),
        "deals_level": sum(1 for h in head if h == 0),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
