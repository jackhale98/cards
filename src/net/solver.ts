import type { Board, OtherResult } from '../engine/types';

/**
 * Duplicate bridge compared with the solver: each board's par. In the app the solver runs in a
 * worker of its own (solverWorker.ts, with pars.ts: DDS and the bridge rules stay out of the page);
 * in tests, `parsHere` (pars.ts).
 */

/** Works out the par of each board (a promise: DDS loads, and each board takes it a moment). */
export type Solver = (boards: Board[]) => Promise<OtherResult[]>;

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
