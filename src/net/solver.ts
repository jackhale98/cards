import { ddTable, loadDds } from '../engine/bots/dds';
import { boardDealer, vulSides } from '../engine/lib/duplicate';
import { par } from '../engine/lib/par';
import type { Board, OtherResult } from '../engine/types';

/**
 * Duplicate bridge compared with the solver: each board's par (see engine/lib/par.ts), from DDS's
 * table of tricks. In the app the solver runs in a worker of its own (solverWorker.ts: DDS stays out
 * of the page); in tests, here.
 */

/** Works out the par of each board (a promise: DDS loads, and each board takes it a moment). */
export type Solver = (boards: Board[]) => Promise<OtherResult[]>;

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

/** The solver in a worker of its own (made when first asked). */
export function workerSolver(): Solver {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, (r: OtherResult[]) => void>();
  return (boards) =>
    new Promise((resolve) => {
      try {
        worker ??= new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        return resolve([]);
      }
      worker.onmessage = (e: MessageEvent<{ id: number; results: OtherResult[] }>) => {
        waiting.get(e.data.id)?.(e.data.results);
        waiting.delete(e.data.id);
      };
      const id = ++next;
      waiting.set(id, resolve);
      worker.postMessage({ id, boards });
    });
}
