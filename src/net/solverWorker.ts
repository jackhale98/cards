/// <reference lib="webworker" />
/**
 * The solver, off the main thread (see solver.ts): the host posts a game's boards, this answers
 * with each one's par. DDS loads here, never in the page.
 */
import type { Board } from '../engine/types';
import { parsHere } from './pars';

self.onmessage = async (e: MessageEvent<{ id: number; boards: Board[] }>) => {
  const { id, boards } = e.data;
  const results = await parsHere(boards).catch(() => []);
  (self as unknown as Worker).postMessage({ id, results });
};
