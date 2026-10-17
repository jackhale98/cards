import { ddTable, loadDds } from '../engine/bots/dds';
import { boardDealer, vulSides } from '../engine/lib/duplicate';
import { par } from '../engine/lib/par';
import type { Board, OtherResult } from '../engine/types';

/**
 * Each board's par (see engine/lib/par.ts), from DDS's table of tricks: in the solver's worker
 * (solverWorker.ts) in the app, here in tests. Apart from solver.ts, so the page never loads it.
 */

const RANKS = '23456789TJQKA';
const SUITS = 'SHDC';
/** A hand as DDS holds it: a bit for each rank held, by suit (spades, hearts, diamonds, clubs). */
const holding = (cards: string[]) => [0, 1, 2, 3].map((s) => cards.filter((c) => c[1] === SUITS[s]).reduce((m, c) => m | (1 << RANKS.indexOf(c[0])), 0));

/** The boards' pars, here and now (DDS loaded here). Boards it can't solve are left out. */
export async function parsHere(boards: Board[]): Promise<OtherResult[]> {
  if (!(await loadDds())) return [];
  const out: OtherResult[] = [];
  for (const b of boards) {
    const table = ddTable(b.hands.map(holding));
    if (table) out.push({ ...par(table, boardDealer(b.n), vulSides(b.n)), n: b.n, at: 'Par' });
  }
  return out;
}
