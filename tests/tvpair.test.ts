import { describe, expect, it } from 'vitest';
import { makeTvCode, sendToTv, waitForTable } from '../src/net/tvPair';

// the local (same-browser) transport listens for the page closing
(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {};

describe('pairing a TV', () => {
  it('a phone sends its table to the TV showing a code', async () => {
    const code = makeTvCode();
    expect(code).toMatch(/^[A-Z]{5}$/);
    let got = '';
    const stop = waitForTable('local', code, (t) => (got = t));
    await new Promise((r) => setTimeout(r, 50));
    expect(await sendToTv('local', code, 'BCDFG', 3000)).toBe(true);
    expect(got).toBe('BCDFG');
    stop();
  });

  it('no TV with that code: gives up', async () => {
    expect(await sendToTv('local', makeTvCode(), 'BCDFG', 300)).toBe(false);
  });
});
