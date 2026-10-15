import type { DdsModule } from './ddsWasm';

/**
 * DDS, the double-dummy solver bridge software uses (Bo Haglund and Soren Hein's, Apache 2.0),
 * built to WebAssembly by tools/dds/build.sh. With every card known it says what each card the
 * player to move may play is worth, in tricks for their side, with best play all round. The Hard
 * bridge bots ask it about many imagined deals of the cards they can't see (see trick/ddPlay.ts).
 *
 * It loads in the background (`loadDds`); until it's ready `solveCards` answers null and the bots
 * think the old way.
 *
 * Hands are 0–3 (North, East, South, West), suits 0–3 (spades, hearts, diamonds, clubs), ranks
 * 0–12 (two to ace), and 4 is no trumps.
 */

export interface Deal {
  /** hands[seat][suit]: a bit for each rank held. */
  hands: number[][];
  /** The trump suit, or 4 for no trumps. */
  trump: number;
  /** Who led the trick in progress (or leads the next one). */
  leader: number;
  /** Cards already played to the trick in progress, in order. */
  trick: { suit: number; rank: number }[];
}

export interface CardValue {
  suit: number;
  rank: number;
  /** Tricks the side of the player to move takes, from this trick on. */
  tricks: number;
}

/** Memory for the solver's tables (it uses less on small endings). */
const MEMORY_MB = 32;

let dds: DdsModule | null = null;
let loading: Promise<boolean> | null = null;
let buf = 0;

/** Start loading the solver (once); resolves whether it's ready. */
export function loadDds(): Promise<boolean> {
  loading ??= import('./ddsWasm.js')
    .then((m) => m.default())
    .then((mod) => {
      mod._dds_init(MEMORY_MB);
      // one block for every call: holdings (16), trick (6), and four answers of 13
      buf = mod._malloc(4 * (16 + 6 + 13 * 4 + 20));
      dds = mod;
      // (a sign for the browser tests that it compiled under the site's security policy)
      (globalThis as { __ddsReady?: boolean }).__ddsReady = true;
      return true;
    })
    .catch(() => false);
  return loading;
}

export const ddsReady = () => dds !== null;

function holdings(mod: DdsModule, hands: number[][]) {
  const at = buf >> 2;
  // (DDS keeps ranks 2–14 as bits 2–14)
  for (let h = 0; h < 4; h++) for (let s = 0; s < 4; s++) mod.HEAPU32[at + h * 4 + s] = (hands[h][s] << 2) >>> 0;
}

/**
 * Every card the player to move may play, with its worth (best first), or null if the solver
 * isn't loaded or the position doesn't make sense to it.
 */
export function solveCards(d: Deal): CardValue[] | null {
  const mod = dds;
  if (!mod) return null;
  holdings(mod, d.hands);
  const at = buf >> 2;
  const trick = at + 16;
  d.trick.forEach((c, i) => {
    mod.HEAP32[trick + 2 * i] = c.suit;
    mod.HEAP32[trick + 2 * i + 1] = c.rank + 2;
  });
  const suit = trick + 6;
  const rank = suit + 13;
  const score = rank + 13;
  const equals = score + 13;
  const n = mod._dds_solve(d.trump, d.leader, trick << 2, d.trick.length, buf, suit << 2, rank << 2, score << 2, equals << 2);
  if (n < 0) return null;
  const out: CardValue[] = [];
  for (let i = 0; i < n; i++) {
    const s = mod.HEAP32[suit + i];
    const tricks = mod.HEAP32[score + i];
    out.push({ suit: s, rank: mod.HEAP32[rank + i] - 2, tricks });
    // the lower cards worth the same
    const eq = mod.HEAP32[equals + i] >>> 2;
    for (let r = 0; r < 13; r++) if (eq & (1 << r)) out.push({ suit: s, rank: r, tricks });
  }
  return out.sort((a, b) => b.tricks - a.tricks);
}

/** Tricks for each strain (spades, hearts, diamonds, clubs, no trumps) and declarer (N E S W). */
export function ddTable(hands: number[][]): number[][] | null {
  const mod = dds;
  if (!mod) return null;
  holdings(mod, hands);
  const out = (buf >> 2) + 16 + 6 + 52;
  if (mod._dds_table(buf, out << 2) < 0) return null;
  return [0, 1, 2, 3, 4].map((s) => [0, 1, 2, 3].map((h) => mod.HEAP32[out + s * 4 + h]));
}
