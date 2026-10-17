"""Random bridge deals with their double-dummy tricks and par, for checking our par (src/engine/lib/par.ts).

    python tools/par_deals.py 64 tests/fixtures/par-endplay.jsonl [seed]

Each line: {"deal": "N:<pbn hands>", "board": n, "t": {seat: {strain: tricks}}, "par": North-South's par score},
the board number giving the dealer and vulnerability (the standard cycle), from endplay's solver and
its par (Bo Haglund's DDS).
"""

import json
import random
import sys

from endplay import dds
from endplay.types import Deal, Denom, Player, Vul

RANKS = "AKQJT98765432"
STRAINS = {"C": Denom.clubs, "D": Denom.diamonds, "H": Denom.hearts, "S": Denom.spades, "NT": Denom.nt}
SEATS = (("N", Player.north), ("E", Player.east), ("S", Player.south), ("W", Player.west))
DEALERS = (Player.north, Player.east, Player.south, Player.west)
VULS = (Vul.none, Vul.ns, Vul.ew, Vul.both)


def board_vul(n: int) -> Vul:
    """The standard cycle: the vulnerability moves on by one every four boards, repeating every sixteen."""
    return VULS[(n - 1 + (n - 1) // 4) % 4]


def main() -> None:
    n, out = int(sys.argv[1]), sys.argv[2]
    random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    cards = [s + r for s in "SHDC" for r in RANKS]
    with open(out, "w") as f:
        for i in range(n):
            random.shuffle(cards)
            hands = []
            for h in range(4):
                mine = cards[h * 13 : (h + 1) * 13]
                hands.append(".".join("".join(r for r in RANKS if s + r in mine) for s in "SHDC"))
            text = "N:" + " ".join(hands)
            board = i % 16 + 1
            table = dds.calc_dd_table(Deal(text))
            par = dds.par(table, board_vul(board), DEALERS[(board - 1) % 4])
            tricks = {seat: {k: table[v, p] for k, v in STRAINS.items()} for seat, p in SEATS}
            f.write(json.dumps({"deal": text, "board": board, "t": tricks, "par": par.score}) + "\n")


if __name__ == "__main__":
    main()
