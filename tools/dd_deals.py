"""Random bridge deals with their double-dummy tricks, for fitting the bidding bots' trick estimator.

    python tools/dd_deals.py 12000 dd.jsonl [seed]

Each line: {"deal": "N:<pbn hands>", "t": {seat: {strain: tricks}}} for every declarer and strain,
from endplay's solver (Bo Haglund's DDS). tests/tricks.bench.test.ts fits the estimator to them.
"""

import json
import random
import sys

from endplay import dds
from endplay.types import Deal, Denom, Player

RANKS = "AKQJT98765432"
STRAINS = {"C": Denom.clubs, "D": Denom.diamonds, "H": Denom.hearts, "S": Denom.spades, "NT": Denom.nt}
SEATS = (("N", Player.north), ("E", Player.east), ("S", Player.south), ("W", Player.west))


def main() -> None:
    n, out = int(sys.argv[1]), sys.argv[2]
    random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    cards = [s + r for s in "SHDC" for r in RANKS]
    batch: list[tuple[Deal, str]] = []
    with open(out, "w") as f:

        def flush() -> None:
            # (the solver takes deals in batches and spreads them over the cores)
            for (_, text), t in zip(batch, dds.calc_all_tables([d for d, _ in batch])):
                tricks = {seat: {k: t[v, p] for k, v in STRAINS.items()} for seat, p in SEATS}
                f.write(json.dumps({"deal": text, "t": tricks}) + "\n")
            batch.clear()

        for _ in range(n):
            random.shuffle(cards)
            hands = []
            for h in range(4):
                mine = cards[h * 13 : (h + 1) * 13]
                hands.append(".".join("".join(r for r in RANKS if s + r in mine) for s in "SHDC"))
            text = "N:" + " ".join(hands)
            batch.append((Deal(text), text))
            if len(batch) == 32:
                flush()
        if batch:
            flush()


if __name__ == "__main__":
    main()
