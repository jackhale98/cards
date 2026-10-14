import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A pretend Chromecast session: the TV ignores messages until it has "loaded", then answers.
 * `requestErrors`: what Chrome answers each request for a session with, in turn (then success);
 * `rejoinAfter`: Chrome is already rejoining the TV in the background, done after that long.
 */
function fakeCast(opts: { requestError?: string; requestErrors?: string[]; loadAfter?: number; rejoinAfter?: number }) {
  const listeners: ((ns: string, msg: string) => void)[] = [];
  let sent = 0;
  let loaded = false;
  const session = {
    sendMessage: vi.fn(async (_ns: string, data: { table: string }) => {
      sent++;
      // (a message before the TV is listening is lost)
      if (loaded) queueMicrotask(() => listeners.forEach((l) => l('ns', JSON.stringify({ got: data.table }))));
    }),
    addMessageListener: (_ns: string, l: (ns: string, msg: string) => void) => listeners.push(l),
    removeMessageListener: vi.fn(),
  };
  let current: typeof session | null = null;
  let state = opts.rejoinAfter != null ? 'SESSION_STARTING' : 'NO_SESSION';
  const changed: ((e: { sessionState: string }) => void)[] = [];
  const errors = [...(opts.requestErrors ?? [])];
  const ctx = {
    getCurrentSession: () => current,
    getSessionState: () => state,
    requestSession: vi.fn(() => {
      const err = opts.requestError ?? errors.shift();
      if (err) return Promise.reject(err);
      current = session;
      return Promise.resolve(undefined);
    }),
    addEventListener: (_type: string, l: (e: { sessionState: string }) => void) => changed.push(l),
    removeEventListener: () => {},
    setOptions: () => {},
  };
  if (opts.rejoinAfter != null)
    setTimeout(() => {
      current = session;
      state = 'SESSION_RESUMED';
      changed.forEach((l) => l({ sessionState: state }));
    }, opts.rejoinAfter);
  const win = {
    chrome: { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' } } },
    cast: { framework: { CastContext: { getInstance: () => ctx } } },
  } as unknown as Window;
  vi.stubGlobal('window', win);
  // loading Google's script: say it's ready straight away
  vi.stubGlobal('document', { createElement: () => ({}), head: { append: () => win.__onGCastApiAvailable?.(true) } });
  setTimeout(() => (loaded = true), opts.loadAfter ?? 0);
  return { session, ctx, sent: () => sent, ready: () => listeners.forEach((l) => l('ns', JSON.stringify({ ready: true }))) };
}

describe('casting the table to a TV', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps sending the table code until the TV, once loaded, confirms it', async () => {
    const tv = fakeCast({ loadAfter: 4000 });
    const { castTable } = await import('../src/net/cast');
    let done = false;
    const p = castTable('BZMSP', { every: 1000 }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(false);
    expect(tv.sent()).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(done).toBe(true);
  });

  it('sends it at once when the TV says it is ready', async () => {
    const tv = fakeCast({ loadAfter: 0 });
    const { castTable } = await import('../src/net/cast');
    const p = castTable('BZMSP', { every: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    const before = tv.sent();
    tv.ready();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(tv.sent()).toBe(before + 1);
  });

  it('gives up with a reason when the TV never answers', async () => {
    fakeCast({ loadAfter: 1e9 });
    const { castTable } = await import('../src/net/cast');
    const p = castTable('BZMSP', { every: 1000, tries: 5 });
    const check = expect(p).rejects.toThrow(/didn’t answer/);
    await vi.advanceTimersByTimeAsync(6000);
    await check;
  });

  it('waits for Chrome to finish rejoining a TV already showing Lamplight, and uses it', async () => {
    const tv = fakeCast({ rejoinAfter: 1000 });
    const { castTable } = await import('../src/net/cast');
    const p = castTable('BZMSP', { every: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(tv.ctx.requestSession).not.toHaveBeenCalled();
  });

  it('when Chrome says a request is already going (invalid_parameter), uses the session it starts', async () => {
    const tv = fakeCast({ requestErrors: ['invalid_parameter'], rejoinAfter: 800 });
    tv.ctx.getSessionState = () => 'NO_SESSION'; // (the earlier request doesn't show as starting)
    const { castTable } = await import('../src/net/cast');
    const p = castTable('BZMSP', { every: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(tv.ctx.requestSession).toHaveBeenCalledTimes(1);
  });

  it('…or asks once more, and says so plainly if that fails too', async () => {
    const tv = fakeCast({ requestErrors: ['invalid_parameter'] });
    const { castTable } = await import('../src/net/cast');
    const p = castTable('BZMSP', { every: 1000, settle: 500 });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(tv.ctx.requestSession).toHaveBeenCalledTimes(2);
    vi.resetModules();
    fakeCast({ requestErrors: ['invalid_parameter', 'invalid_parameter'] });
    const again = await import('../src/net/cast');
    const q = again.castTable('BZMSP', { settle: 500 });
    const check = expect(q).rejects.toThrow(/still connecting to the TV/);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
  });

  it('tapped again while the first request is still going, waits for that one instead of asking Chrome twice', async () => {
    const tv = fakeCast({});
    let answer: (v: undefined) => void = () => {};
    // (the first request: Chrome's picker, answered a moment later)
    tv.ctx.requestSession.mockImplementationOnce(() => new Promise((r) => (answer = r)).then(() => void (tv.ctx.getCurrentSession = () => tv.session)));
    const { castTable } = await import('../src/net/cast');
    const first = castTable('BZMSP', { every: 1000 });
    await vi.advanceTimersByTimeAsync(500);
    const second = castTable('BZMSP', { every: 1000 });
    await vi.advanceTimersByTimeAsync(500);
    answer(undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([first, second]);
    expect(tv.ctx.requestSession).toHaveBeenCalledTimes(1);
  });

  it('…and when the first never finishes (a picker closed without a word), says to reload', async () => {
    const tv = fakeCast({});
    tv.ctx.requestSession.mockImplementationOnce(() => new Promise(() => {}));
    const { castTable } = await import('../src/net/cast');
    void castTable('BZMSP', { settle: 500 });
    await vi.advanceTimersByTimeAsync(100);
    const again = castTable('BZMSP', { settle: 500 });
    const check = expect(again).rejects.toThrow(/reload the page/);
    await vi.advanceTimersByTimeAsync(600);
    await check;
    expect(tv.ctx.requestSession).toHaveBeenCalledTimes(1);
  });

  it('says why when Chrome can’t start it, and stays quiet when the picker is closed', async () => {
    fakeCast({ requestError: 'receiver_unavailable' });
    const cast = await import('../src/net/cast');
    await expect(cast.castTable('BZMSP')).rejects.toThrow(/can’t run Lamplight/);
    vi.resetModules();
    fakeCast({ requestError: 'cancel' });
    const again = await import('../src/net/cast');
    await expect(again.castTable('BZMSP')).rejects.toMatchObject({ code: 'cancel' });
  });
});
