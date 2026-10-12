import { afterEach, describe, expect, it, vi } from 'vitest';

describe('anonymous error reports', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const load = async (hostname: string) => {
    const posts: { url: string; body: Record<string, string> }[] = [];
    vi.stubGlobal('location', { hostname });
    vi.stubGlobal('navigator', { userAgent: 'Test Phone' });
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    });
    const mod = await import('../src/net/reports');
    return { ...mod, posts };
  };

  it('only the real site sends them (not localhost or tests)', async () => {
    const local = await load('localhost');
    local.report('error', new Error('boom'));
    expect(local.posts).toEqual([]);
    vi.resetModules();
    const real = await load('lamplight.cards');
    real.report('error', new Error('boom'));
    expect(real.posts).toHaveLength(1);
    expect(real.posts[0].url).toBe('https://relay.lamplight.cards/report');
  });

  it('never carries cards or table codes; context and device go along', async () => {
    const { report, setReportContext, posts } = await load('lamplight.cards');
    setReportContext({ game: 'hearts', phase: 'play' });
    report('engine', new Error('Cannot play QS on 7H at #/room/BZMSP'), { action: 'play' });
    const b = posts[0].body;
    expect(b.msg).not.toMatch(/QS|7H|BZMSP/);
    expect(b.game).toBe('hearts');
    expect(b.phase).toBe('play');
    expect(b.action).toBe('play');
    expect(b.ua).toBe('Test Phone');
    expect(b.kind).toBe('engine');
  });

  it('each distinct error once, and only a few a visit', async () => {
    const { report, posts } = await load('lamplight.cards');
    for (let i = 0; i < 3; i++) report('error', new Error('same thing'));
    expect(posts).toHaveLength(1);
    for (let i = 0; i < 20; i++) report('error', new Error(`different ${i}`));
    expect(posts.length).toBeLessThanOrEqual(8);
  });
});
