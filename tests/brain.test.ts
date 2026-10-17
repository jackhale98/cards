import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickNow, shareBrain, workerBrain, type Brain, type BrainRequest, type Pick } from '../src/net/brain';
import { Host } from '../src/net/host';
import type { GameModule, GameState } from '../src/engine/types';
import { deadline, now } from '../src/engine/bots/search';
import { pickWith, restThinking } from '../src/net/pick';

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

describe('one brain for several tables', () => {
  /** A worker that answers only when told to. */
  function fakeWorker() {
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
    return { posted, answer: (i: number, pick: Pick | null = null) => onmessage({ data: { id: posted[i].id, pick } }) };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("tables take turns, and one table's newer question never drops another table's", async () => {
    const w = fakeWorker();
    const host = new Host(null, 'BRAIN', { cid: 'h', name: 'Hana' });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    const s = host.state!;
    const shared = shareBrain(workerBrain());
    const a = shared.table('a');
    const b = shared.table('b');
    const a1 = a.think('hearts', { 1: s }, [1]);
    const b1 = b.think('hearts', { 2: s }, [2]);
    // table A has moved on while its first question is with the worker: its new one waits behind B's
    const a2 = a.think('hearts', { 3: s }, [3]);
    expect(w.posted.map((r) => r.seats)).toEqual([[1]]);
    w.answer(0);
    expect(await a1).toBeNull();
    await Promise.resolve();
    expect(w.posted.map((r) => r.seats)).toEqual([[1], [2]]);
    w.answer(1, { seat: 2, action: { type: 'pass' } });
    // (a worker brain shared directly would have answered B "nothing" here, and B's bots would never move again)
    expect(await b1).toEqual({ seat: 2, action: { type: 'pass' } });
    await Promise.resolve();
    expect(w.posted.map((r) => r.seats)).toEqual([[1], [2], [3]]);
    // a table's own older question still waiting is out of date: answered "nothing"
    const a3 = a.think('hearts', { 1: s }, [1]);
    const a4 = a.think('hearts', { 2: s }, [2]);
    expect(await a3).toBeNull();
    w.answer(2);
    expect(await a2).toBeNull();
    await Promise.resolve();
    expect(w.posted.at(-1)!.seats).toEqual([2]);
    w.answer(3);
    expect(await a4).toBeNull();
    shared.close();
    host.close();
  });

  it('two tables sharing one worker both play on', async () => {
    vi.useFakeTimers();
    // a worker that thinks for a moment, then answers as the bots would
    const posted: BrainRequest[] = [];
    class FakeWorker {
      onmessage: (e: { data: unknown }) => void = () => {};
      onerror = null;
      postMessage(req: BrainRequest) {
        posted.push(req);
        setTimeout(() => this.onmessage({ data: { id: req.id, pick: pickNow(req.game, req.views, req.seats) } }), 300);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const shared = shareBrain(workerBrain());
    const hosts = ['a', 'b'].map((id) => {
      const host = new Host(null, `T${id}`, { cid: 'h', name: 'Hana' }, undefined, { brain: shared.table(id) });
      host.setGame('hearts');
      for (let i = 0; i < 3; i++) host.addBot();
      host.start();
      return host;
    });
    for (const host of hosts) {
      const mine = host.state!.zones['hand:0'].cards.slice(0, 3).map((c) => c.id);
      expect(host.act('h', { type: 'pass', cards: mine })).toBeNull();
    }
    await vi.advanceTimersByTimeAsync(20_000);
    for (const host of hosts) expect(host.state!.phase).toBe('play');
    shared.close();
    for (const host of hosts) host.close();
    vi.useRealTimers();
  });
});

describe('battery: the bots on a device think at most a fifth of the time', () => {
  it('a bot that would think 1.2 s a move, every second, slows to about a quarter second; rested, it has its burst again', () => {
    let clock = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    restThinking();
    const allowed: number[] = [];
    // a bot whose own budget is 1.2 s (Hard bridge play on a slow phone), thinking as long as it may
    const m = {
      bot: () => {
        const may = deadline(1200) - now();
        allowed.push(may);
        clock += may;
        return { type: 'play' };
      },
    } as unknown as GameModule;
    const thinkFor = (moves: number, gap: number) => {
      for (let i = 0; i < moves; i++) {
        pickWith(m, { 0: {} as never }, [0]);
        clock += gap;
      }
    };
    thinkFor(4, 1000);
    // a burst at first: its full budget
    expect(allowed.slice(0, 4)).toEqual([1200, 1200, 1200, 1200]);
    thinkFor(40, 1000);
    // then a fifth of the time: t = (t + 1 s) / 5
    expect(allowed.at(-1)).toBeGreaterThan(200);
    expect(allowed.at(-1)).toBeLessThan(300);
    // a quiet minute (people playing): the whole budget again
    clock += 60_000;
    thinkFor(1, 1000);
    expect(allowed.at(-1)).toBe(1200);
    spy.mockRestore();
  });
});
