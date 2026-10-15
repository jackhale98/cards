// A thin C interface to DDS (Bo Haglund and Soren Hein's double-dummy solver) for the browser:
// flat arrays in and out, nothing else. Built by build.sh into src/engine/bots/dds/ddsWasm.js.
#include "dll.h"

extern "C" {

// Ready the solver: one thread (a browser worker has one), and memory for its tables.
int dds_init(int maxMemoryMB) {
  SetMaxThreads(1);
  SetResources(maxMemoryMB, 1);
  return 0;
}

// The value of every card the player to move may play.
//   holdings[hand * 4 + suit]: a bit per rank held, rank 2..14 (bit 1 << rank); hands N E S W,
//   suits S H D C. trump: 0..3, or 4 for no trumps. first: who led the trick in progress.
//   trick: the cards already played to it (suit, rank pairs), count 0..3.
// Out (up to 13 each): suit, rank, the tricks the mover's side takes from here, and the lower
// cards that are worth the same (a bit per rank). Returns how many, or a DDS error (negative).
int dds_solve(int trump, int first, const int *trick, int count, const unsigned int *holdings,
              int *outSuit, int *outRank, int *outScore, int *outEquals) {
  deal dl;
  dl.trump = trump;
  dl.first = first;
  for (int i = 0; i < 3; i++) {
    dl.currentTrickSuit[i] = i < count ? trick[2 * i] : 0;
    dl.currentTrickRank[i] = i < count ? trick[2 * i + 1] : 0;
  }
  for (int h = 0; h < 4; h++)
    for (int s = 0; s < 4; s++) dl.remainCards[h][s] = holdings[h * 4 + s];
  futureTricks fut;
  int res = SolveBoard(dl, -1, 3, 1, &fut, 0);
  if (res != RETURN_NO_FAULT) return res;
  for (int i = 0; i < fut.cards; i++) {
    outSuit[i] = fut.suit[i];
    outRank[i] = fut.rank[i];
    outScore[i] = fut.score[i];
    outEquals[i] = fut.equals[i];
  }
  return fut.cards;
}

// Tricks for every strain (S H D C NT) and declarer (N E S W): out[strain * 4 + hand].
int dds_table(const unsigned int *holdings, int *out) {
  ddTableDeal td;
  for (int h = 0; h < 4; h++)
    for (int s = 0; s < 4; s++) td.cards[h][s] = holdings[h * 4 + s];
  ddTableResults r;
  int res = CalcDDtable(td, &r);
  if (res != RETURN_NO_FAULT) return res;
  for (int s = 0; s < 5; s++)
    for (int h = 0; h < 4; h++) out[s * 4 + h] = r.resTable[s][h];
  return 0;
}
}
