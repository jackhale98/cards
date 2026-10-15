import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickNow, workerBrain, type Brain, type BrainRequest, type Pick } from '../src/net/brain';
import { Host } from '../src/net/host';
import type { GameState } from '../src/engine/types';

/** A brain that answers only when told to, like a worker thread thinking in the background. */
function slowBrain() {
  const asked: { views: Record<number, GameState>; seats: number[]; answer: (p: Pick | null) => void }[] = [];
  const brain: Brain = {
    think: (game, views, seats) => new Promise((answer) => asked.push({ views, seats, answer: (p) => answer(p ?? pickNow(game, views, seats)) })),
    close() {},
    onError: () => {},
  };
  return { brain, asked };
}

describe('bots thinking in the background', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('play once the answer comes back, after a natural pause', async () => {
    const { brain, asked } = slowBrain();
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' }, undefined, { brain });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    const v = host.state!.v;
    expect(asked).toHaveLength(1);
    expect(asked[0].seats).toEqual([1, 2, 3]);
    // nothing happens while the bots think, however long
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.state!.v).toBe(v);
    asked[0].answer(null);
    await vi.advanceTimersByTimeAsync(1300);
    expect(host.state!.v).toBeGreaterThan(v);
    host.close();
  });

  it('ignore an answer that arrives after the table has moved on', async () => {
    const { brain, asked } = slowBrain();
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' }, undefined, { brain });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    // the person passes meanwhile: the bots are asked again about the new table
    const mine = host.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
    expect(host.act('h', { type: 'pass', cards: mine })).toBeNull();
    expect(asked).toHaveLength(2);
    const v = host.state!.v;
    // the stale answer (for the table before the pass) is dropped
    asked[0].answer({ seat: 1, action: { type: 'pass', cards: asked[0].views[1].zones['hand:1'].cards.slice(0, 3).map((c) => c.id) } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state!.v).toBe(v);
    asked[1].answer(null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state!.v).toBeGreaterThan(v);
    host.close();
  });

  it('a bot that breaks is reported and the table carries on', () => {
    const errors: unknown[] = [];
    const brain: Brain = {
      think: () => {
        throw new Error('boom');
      },
      close() {},
      onError: () => {},
    };
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' }, undefined, { brain });
    brain.onError = (e) => errors.push(e);
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    expect(() => host.start()).not.toThrow();
    expect(errors).toHaveLength(1);
    // the person can still play
    const mine = host.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
    expect(host.act('h', { type: 'pass', cards: mine })).toBeNull();
    host.close();
  });

  it('a bot that keeps failing still moves: something plain and legal, so the table never waits on it', async () => {
    const errors: unknown[] = [];
    const brain: Brain = { think: () => Promise.resolve('failed'), close() {}, onError: (e) => errors.push(e) };
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' }, undefined, { brain });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    const mine = host.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
    expect(host.act('h', { type: 'pass', cards: mine })).toBeNull();
    await vi.advanceTimersByTimeAsync(6000);
    expect(host.state!.phase).toBe('play');
    host.close();
  });

  it('the worker is asked one thing at a time: a newer question replaces one still waiting', async () => {
    const posted: BrainRequest[] = [];
    let onmessage: (e: { data: unknown }) => void = () => {};
    class FakeWorker {
      set onmessage(f: (e: { data: unknown }) => void) {
        onmessage = f;
      }
      onerror = null;
      postMessage(req: BrainRequest) {
        posted.push(req);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    const s = host.state!;
    const brain = workerBrain();
    const first = brain.think('hearts', { 1: s }, [1]);
    const second = brain.think('hearts', { 2: s }, [2]);
    const third = brain.think('hearts', { 3: s }, [3]);
    // only the first went to the worker; the second was overtaken by the third
    expect(posted.map((r) => r.seats)).toEqual([[1]]);
    expect(posted[0].config.id).toBe('hearts');
    expect(await second).toBeNull();
    onmessage({ data: { id: posted[0].id, pick: null } });
    expect(await first).toBeNull();
    expect(posted.map((r) => r.seats)).toEqual([[1], [3]]);
    onmessage({ data: { id: posted[1].id, pick: { seat: 3, action: { type: 'pass' } } } });
    expect(await third).toEqual({ seat: 3, action: { type: 'pass' } });
    brain.close();
    host.close();
    vi.unstubAllGlobals();
  });
});
