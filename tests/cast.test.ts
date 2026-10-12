import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A pretend Chromecast session: the TV ignores messages until it has "loaded", then answers. */
function fakeCast(opts: { requestError?: string; loadAfter?: number }) {
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
  const ctx = {
    getCurrentSession: () => current,
    requestSession: () => (opts.requestError ? Promise.reject(opts.requestError) : ((current = session), Promise.resolve(undefined))),
    setOptions: () => {},
  };
  const win = {
    chrome: { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' } } },
    cast: { framework: { CastContext: { getInstance: () => ctx } } },
  } as unknown as Window;
  vi.stubGlobal('window', win);
  // loading Google's script: say it's ready straight away
  vi.stubGlobal('document', { createElement: () => ({}), head: { append: () => win.__onGCastApiAvailable?.(true) } });
  setTimeout(() => (loaded = true), opts.loadAfter ?? 0);
  return { session, sent: () => sent, ready: () => listeners.forEach((l) => l('ns', JSON.stringify({ ready: true }))) };
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
