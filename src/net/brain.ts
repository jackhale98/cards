import { rulesFor } from '../games';
import type { Action, GameState } from '../engine/types';

/** A bot's move: which bot, and what it does. */
export interface Pick {
  seat: number;
  action: Action;
}

/** A bot's answer: its move, null (no bot has anything to do), or `'failed'` (a bot threw). */
export type Thought = Pick | null | 'failed';

/**
 * Where bots think. The host asks for the next move of the first of `seats` (bots, in seat order)
 * that has one. The answer can come back at once (`inlineBrain`, in tests and as a fallback) or
 * later (`workerBrain`: a background thread, so a bot thinking hard never makes the host's phone
 * stutter). A bot that fails is reported through `onError` and answers `'failed'`: the host then
 * finds a plain legal move for it, so the table never waits on a broken bot.
 */
export interface Brain {
  think(game: string, s: GameState, seats: number[]): Thought | Promise<Thought>;
  close(): void;
  onError: (e: unknown, game: string, phase: string) => void;
}

/** First bot in `seats` with a move, worked out here and now. */
export function pickNow(game: string, s: GameState, seats: number[]): Pick | null {
  const m = rulesFor(game);
  if (!m?.bot) return null;
  for (const seat of seats) {
    const action = m.bot(s, seat);
    if (action) return { seat, action };
  }
  return null;
}

/** Bots think on the host's own thread (tests, and browsers without workers). */
export function inlineBrain(): Brain {
  const brain: Brain = {
    think(game, s, seats) {
      try {
        return pickNow(game, s, seats);
      } catch (e) {
        brain.onError(e, game, s.phase);
        return 'failed';
      }
    },
    close() {},
    onError: () => {},
  };
  return brain;
}

/** Messages to and from the bot worker (botWorker.ts). */
export type BrainRequest = { id: number; game: string; state: GameState; seats: number[] };
export type BrainReply = { id: number; pick: Pick | null } | { id: number; error: string };

/**
 * Bots think in a Web Worker. If the worker can't start (or dies), they quietly carry on thinking
 * on the main thread instead: slower to feel, but the game never stalls.
 */
export function workerBrain(): Brain {
  const fallback = inlineBrain();
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  let next = 0;
  const waiting = new Map<number, { resolve: (p: Thought) => void; req: BrainRequest }>();
  const giveUp = () => {
    worker?.terminate();
    worker = null;
    // whatever was asked meanwhile gets answered here instead
    for (const { resolve, req } of waiting.values()) resolve(fallback.think(req.game, req.state, req.seats) as Thought);
    waiting.clear();
  };
  if (worker) {
    worker.onmessage = (e: MessageEvent<BrainReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if ('error' in e.data) {
        brain.onError(new Error(e.data.error), w.req.game, w.req.state.phase);
        // (once more here: the worker may have failed to load the rules, which this thread has)
        w.resolve(fallback.think(w.req.game, w.req.state, w.req.seats) as Thought);
      } else w.resolve(e.data.pick);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      giveUp();
    };
  }
  const brain: Brain = {
    think(game, state, seats) {
      if (!worker) return fallback.think(game, state, seats);
      const req: BrainRequest = { id: ++next, game, state, seats };
      return new Promise((resolve) => {
        waiting.set(req.id, { resolve, req });
        try {
          worker!.postMessage(req);
        } catch {
          giveUp();
        }
      });
    },
    close() {
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
    onError: () => {},
  };
  fallback.onError = (e, game, phase) => brain.onError(e, game, phase);
  return brain;
}
