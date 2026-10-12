import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHidden } from '../src/engine/redact';
import { Client } from '../src/net/client';
import { Host } from '../src/net/host';
import type { HostMsg, View } from '../src/net/protocol';
import { Bus, MemTransport } from './netHarness';

/**
 * Someone at the table (or anyone with the code) running a modified client. They see every
 * client id in the lobby, can message anyone, and send whatever they like.
 */
describe('a player with a modified client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function table() {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host-peer');
    const host = new Host(ht, 'ABCD', { cid: 'h', name: 'Hana', key: 'hana-key' });
    bus.join(ht);
    const join = (cid: string, key: string, peer = `${cid}-peer`) => {
      const t = new MemTransport(bus, peer);
      const c = new Client(t, cid, cid, undefined, false, key);
      bus.join(t);
      return { c, t };
    };
    /** A raw connection: sends exactly what we tell it, records what it gets. */
    const rogue = (peer = 'rogue-peer') => {
      const t = new MemTransport(bus, peer);
      const got: { msg: HostMsg; from: string }[] = [];
      t.onMessage = (msg, from) => got.push({ msg: msg as HostMsg, from });
      bus.join(t);
      const views = () => got.filter((g) => g.msg.t === 'view').map((g) => (g.msg as { view: View }).view);
      return { t, got, views };
    };
    return { bus, host, join, rogue };
  }

  it("can't take someone's seat with their (public) client id", () => {
    const { host, join, rogue } = table();
    join('ann', 'ann-key');
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.start();
    const r = rogue();
    // without the key: asked who they are, never shown the seat
    r.t.send({ t: 'hello', cid: 'ann', name: 'Ann' }, 'host-peer');
    expect(r.views().every((v) => v.who && v.you === -1)).toBe(true);
    // with a made-up key: watching, no cards of Ann's, can't act for her
    r.t.send({ t: 'hello', cid: 'ann', name: 'Ann', key: 'guess' }, 'host-peer');
    const v = r.views().at(-1)!;
    expect(v.you).toBe(-1);
    expect(v.state!.zones['hand:1'].cards.every((c) => isHidden(c.id))).toBe(true);
    r.t.send({ t: 'act', a: { type: 'pass', cards: [] }, seq: 1 }, 'host-peer');
    expect(r.got.at(-1)!.msg).toMatchObject({ t: 'err' });
    // nor the host's
    r.t.send({ t: 'hello', cid: 'h', name: 'Hana', key: 'guess' }, 'host-peer');
    expect(r.views().at(-1)!.you).toBe(-1);
  });

  it('gets you back into your own seat from a new connection, with your key', () => {
    const { host, join } = table();
    const ann = join('ann', 'ann-key');
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.start();
    ann.c.close();
    const again = join('ann', 'ann-key', 'ann-peer-2');
    expect(again.c.view!.you).toBe(1);
    expect(again.c.view!.state!.zones['hand:1'].cards.some((c) => !isHidden(c.id))).toBe(true);
  });

  it("can't pose as the host to other players", () => {
    const { join, rogue } = table();
    const ann = join('ann', 'ann-key');
    const real = ann.c.view!;
    const r = rogue();
    const fake: View = { ...real, hid: 'evil', v: 999, lobby: { ...real.lobby, code: 'ZZZZZ' } };
    r.t.send({ t: 'view', view: fake }, 'ann-peer');
    r.t.send({ t: 'move', code: 'ZZZZZ' }, 'ann-peer');
    r.t.send({ t: 'view', view: { ...fake, who: true } }, 'ann-peer');
    expect(ann.c.view!.lobby.code).toBe('ABCD');
    expect(ann.c.hostPeer).toBe('host-peer');
    // and Ann's key never went to the rogue
    expect(r.got.some((g) => JSON.stringify(g.msg).includes('ann-key'))).toBe(false);
  });

  it("can't make chips out of thin air with a strange bet", () => {
    const { host, join } = table();
    join('ann', 'ann-key');
    host.setGame('holdem');
    host.start();
    const chips = () => JSON.stringify((host.state!.data as { b: unknown }).b);
    const before = chips();
    // whoever's turn it is tries a negative raise, then nonsense
    const seat = host.state!.turn;
    const cid = seat === 0 ? 'h' : 'ann';
    expect(host.act(cid, { type: 'raise', amount: -1_000_000 })).toMatch(/Choose between/);
    expect(host.act(cid, { type: 'raise', amount: 'x' as unknown as number })).toBe('Choose an amount');
    expect(host.act(cid, null as unknown as { type: string })).toBeTruthy();
    expect(chips()).toEqual(before);
  });

  it("can't fill the table with seats from one connection", () => {
    const { host, rogue } = table();
    const r = rogue();
    for (let i = 0; i < 10; i++) r.t.send({ t: 'hello', cid: `ghost${i}`, name: 'Ghost' }, 'host-peer');
    expect(host.lobby.seats.map((s) => s.id)).toEqual(['h', 'ghost9']);
  });

  it("can't fill tonight's tally with junk", () => {
    const { host, rogue } = table();
    const r = rogue();
    r.t.send({ t: 'hello', cid: 'x', name: 'X', from: 'QQQQQ', merge: [null, { at: 1, game: 'hearts', name: 5, results: [null] }] } as never, 'host-peer');
    expect(host.lobby.night?.games ?? []).toEqual([]);
  });

  it("table screens can't act", () => {
    const { host, bus } = table();
    const t = new MemTransport(bus, 'tv-peer');
    new Client(t, 'h', 'TV', undefined, true);
    bus.join(t);
    host.setGame('hearts');
    host.addBot();
    host.addBot();
    host.addBot();
    host.start();
    const errs: unknown[] = [];
    t.onMessage = (m) => errs.push(m);
    t.send({ t: 'act', a: { type: 'pass', cards: [] }, seq: 1 }, 'host-peer');
    expect(errs.at(-1)).toMatchObject({ t: 'err' });
  });
});
