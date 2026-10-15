import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { cardCode, plainText } from '../src/net/gameRecord';
import { Host } from '../src/net/host';
import { GAMES } from './games';
import { Bus, MemTransport } from './netHarness';

/** Rows of a CSV (quoted cells unwrapped). */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  return rows;
}

/** Hearts with three bots; Hana's moves made by a bot too. Plays until `hands` hands are done. */
function play(host: Host, hands: number, cid = 'h', seat = 0) {
  let done = 0;
  for (let i = 0; i < 20_000 && done < hands; i++) {
    const v = host.viewFor(cid);
    if (v.handDone) done++;
    if (v.actions.some((a) => a.type === 'next')) host.act(cid, { type: 'next' });
    else if (v.actions.length) {
      const a = GAMES.hearts.bot!(host.state!, seat);
      if (a) host.act(cid, a);
    }
    vi.advanceTimersByTime(1500);
  }
}

// (bots play whole hands here: allow for a busy machine)
describe('saving a game as a spreadsheet', { timeout: 30_000 }, () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function hearts(name = 'Hana') {
    const host = new Host(null, 'SAVE', { cid: 'h', name, key: 'hk' });
    host.setGame('hearts');
    for (let i = 0; i < 3; i++) host.addBot();
    host.start();
    return host;
  }

  it('has a row for every move, a deal row with your cards, and the result', () => {
    const host = hearts();
    const dealt = host.state!.zones['hand:0'].cards.map((c) => c.id);
    play(host, 1);
    const rows = parse(host.exportCsv('h')!);
    expect(rows[0]).toEqual(['Hand', 'Move', 'Player', 'What happened', 'Your cards']);
    const hand1 = rows.filter((r) => r[0] === '1');
    expect(hand1[0].slice(3)).toEqual(['Deal', dealt.map(cardCode).join(' ')]);
    // every card played once: 13 tricks of 4, each its own row (never taken twice)
    const plays = hand1.filter((r) => /\b(plays|leads)\b/.test(r[3]));
    expect(plays).toHaveLength(52);
    expect(hand1.some((r) => r[3].startsWith('Result: '))).toBe(true);
    // moves are numbered, with who made them
    expect(hand1[1][1]).toBe('1');
    expect(plays.every((r) => ['Hana', 'Ada', 'Bix', 'Cleo'].includes(r[2]))).toBe(true);
    host.close();
  });

  it('gives each player only their own cards, and someone watching none', () => {
    const host = hearts();
    play(host, 2);
    const rows = parse(host.exportCsv('h')!).slice(1);
    const deals = rows.filter((r) => r[3] === 'Deal');
    expect(deals.length).toBeGreaterThanOrEqual(2);
    // (the only column with cards nobody else saw: just your own deal)
    expect(rows.filter((r) => r[4]).every((r) => r[3] === 'Deal')).toBe(true);
    expect(deals.every((r) => r[4].split(' ').length === 13)).toBe(true);
    expect(parse(host.exportCsv(null)!).every((r) => !r[4] || r[4] === 'Your cards')).toBe(true);
    host.close();
  });

  it('keeps a name that looks like a formula as plain text', () => {
    const host = hearts('=HYPERLINK("http://x","hi")');
    play(host, 1);
    const csv = host.exportCsv('h')!;
    expect(csv.startsWith('\uFEFFHand,Move')).toBe(true);
    const cells = parse(csv).flat();
    expect(cells.some((c) => c.startsWith('='))).toBe(false);
    expect(cells.some((c) => c.startsWith(`'=HYPERLINK`))).toBe(true);
    host.close();
  });

  it('reaches a player over the network, as they saw it', () => {
    const bus = new Bus();
    const ht = new MemTransport(bus, 'host-peer');
    const host = new Host(ht, 'SAVE', { cid: 'h', name: 'Hana', key: 'hk' });
    bus.join(ht);
    const t = new MemTransport(bus, 'ann-peer');
    const ann = new Client(t, 'ann', 'Ann', undefined, false, 'ak');
    bus.join(t);
    host.setGame('hearts');
    for (let i = 0; i < 2; i++) host.addBot();
    host.start();
    const annDealt = host.state!.zones['hand:1'].cards.map((c) => cardCode(c.id)).join(' ');
    let got: string | null = null;
    ann.onExport = (csv) => (got = csv);
    ann.exportGame();
    const deal = parse(got!).find((r) => r[3] === 'Deal')!;
    expect(deal[4]).toBe(annDealt);
    host.close();
  });

  it('writes cards and suits in plain letters, for searching and any font', () => {
    expect(['AS', 'TH', 'QD#2', 'XA'].map(cardCode)).toEqual(['AS', '10H', 'QD', 'Joker']);
    expect(plainText('Bix plays 10♦ — 10')).toBe('Bix plays 10D — 10');
    expect(plainText('Cleo bids 1 ♠ (40)')).toBe('Cleo bids 1S (40)');
    expect(plainText('♥ broken')).toBe('Hearts broken');
    expect(plainText('Q♥ turned up, then JK★')).toBe('QH turned up, then Joker');
    const host = hearts();
    play(host, 1);
    expect(host.exportCsv('h')!).not.toMatch(/[♠♥♦♣★]/);
    host.close();
  });

  it("isn't offered for real-time games", () => {
    const host = new Host(null, 'SAVE', { cid: 'h', name: 'Hana' });
    host.setGame('slapjack');
    host.addBot();
    host.start();
    expect(host.exportCsv('h')).toBeNull();
    host.close();
  });
});
