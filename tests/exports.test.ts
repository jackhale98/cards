import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { bidOf } from '../src/engine/families/trick/contracts';
import { recordFormats } from '../src/net/exports/formats';
import { callText } from '../src/net/exports/pbn';
import { Host } from '../src/net/host';
import { getGame } from '../src/games';
import { GAMES } from './games';
import { Bus, MemTransport } from './netHarness';

/** A game with bots in the other seats; Hana's moves made by a bot too, until `hands` hands are done. */
function play(host: Host, game: string, hands: number, people: Record<string, number> = { h: 0 }) {
  let done = 0;
  for (let i = 0; i < 20_000 && done < hands; i++) {
    if (host.viewFor('h').handDone) done++;
    for (const [cid, seat] of Object.entries(people)) {
      const v = host.viewFor(cid);
      if (v.actions.some((a) => a.type === 'next')) host.act(cid, { type: 'next' });
      else if (v.actions.length) {
        const a = GAMES[game].bot!(host.state!, seat);
        if (a) host.act(cid, a);
      }
    }
    vi.advanceTimersByTime(1500);
  }
}

function table(game: string, bots: number) {
  const host = new Host(null, 'SAVE', { cid: 'h', name: 'Hána', key: 'hk' });
  host.setGame(game);
  for (let i = 0; i < bots; i++) host.addBot();
  host.start();
  return host;
}

const RANKS = 'AKQJT98765432';
/** A hand as PBN writes it (spades, hearts, diamonds, clubs, highest first). */
const handText = (ids: string[]) =>
  ['S', 'H', 'D', 'C']
    .map((s) =>
      ids
        .filter((c) => c[1] === s)
        .map((c) => c[0])
        .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
        .join(''),
    )
    .join('.');

describe('saving a game in its standard record', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is offered for bridge (PBN) and Hold’em and Omaha (hand history), not for other games', () => {
    expect(recordFormats(getGame('bridge')!.config)).toEqual(['pbn']);
    expect(recordFormats(getGame('holdem')!.config)).toEqual(['ohh']);
    expect(recordFormats(getGame('omaha')!.config)).toEqual(['ohh']);
    for (const id of ['hearts', 'five-card-draw', 'seven-card-stud', 'cribbage']) expect(recordFormats(getGame(id)!.config)).toEqual([]);
    const host = table('hearts', 3);
    expect(host.exportFile('h', 'pbn')).toBeNull();
    expect(host.exportFile('h', 'ohh')).toBeNull();
    host.close();
  });

  describe('bridge, as PBN', () => {
    it('spells every call as the rules number them', () => {
      for (let i = 0; i < 35; i++) expect(callText(i)).toBe(`${bidOf(i).level}${bidOf(i).strain}`);
      expect(['P', 'X', 'XX'].map((c) => callText(c as 'P'))).toEqual(['Pass', 'X', 'XX']);
    });

    it('writes each deal with its tags in order, the auction, the play and the result', () => {
      const host = table('bridge', 3);
      const dealt = host.state!.zones['hand:0'].cards.map((c) => c.id);
      play(host, 'bridge', 2);
      const text = host.exportFile('h', 'pbn')!;
      expect(text.startsWith('% PBN 2.1\r\n% EXPORT\r\n')).toBe(true);
      expect(text.replace(/\r\n/g, '')).not.toMatch(/\n/);
      expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
      const games = text
        .split('\r\n\r\n')
        .slice(1)
        .filter((g) => g.trim());
      expect(games.length).toBeGreaterThanOrEqual(2);
      const tags = (g: string) => Object.fromEntries([...g.matchAll(/^\[(\w+) "(.*)"\]$/gm)].map((m) => [m[1], m[2]]));
      const order = [...games[0].matchAll(/^\[(\w+) /gm)].map((m) => m[1]);
      expect(order.slice(0, 15)).toEqual([
        'Event',
        'Site',
        'Date',
        'Board',
        'West',
        'North',
        'East',
        'South',
        'Dealer',
        'Vulnerable',
        'Deal',
        'Scoring',
        'Declarer',
        'Contract',
        'Result',
      ]);
      const first = tags(games[0]);
      expect(first.North).toBe('Hana');
      expect(first.Date).toMatch(/^\d{4}\.\d\d\.\d\d$/);
      expect(['None', 'NS', 'EW', 'All']).toContain(first.Vulnerable);
      // the deal from the dealer round; North (Hana) is in it, as dealt
      const [dealer, hands] = first.Deal.split(':');
      expect(dealer).toBe(first.Dealer);
      const order4 = ['N', 'E', 'S', 'W'];
      const at = (order4.indexOf('N') - order4.indexOf(dealer) + 4) % 4;
      expect(hands.split(' ')[at]).toBe(handText(dealt));
      for (const g of games) {
        const t = tags(g);
        const calls = g
          .split('\r\n[Auction')[1]
          .split('\r\n')
          .slice(1)
          .join(' ')
          .split(/\r\n\[|\s+/);
        if (t.Contract === 'Pass') {
          expect(t.Declarer).toBe('');
          expect(t.Result).toBe('');
          expect(g).not.toContain('[Play');
          continue;
        }
        expect(t.Contract).toMatch(/^[1-7](C|D|H|S|NT)X{0,2}$/);
        expect(order4).toContain(t.Declarer);
        expect(Number(t.Result)).toBeGreaterThanOrEqual(0);
        expect(Number(t.Result)).toBeLessThanOrEqual(13);
        expect(calls.length).toBeGreaterThanOrEqual(4);
        // thirteen tricks of four cards, every card once
        const play = g.split(/\[Play "[NESW]"\]\r\n/)[1].split('\r\n');
        expect(play).toHaveLength(13);
        const cards = play.flatMap((l) => l.split(' '));
        expect(cards.every((c) => /^[SHDC][AKQJT2-9]$/.test(c))).toBe(true);
        expect(new Set(cards).size).toBe(52);
      }
      host.close();
    });

    it('shows only the hands that player saw: theirs, dummy and the ones played out', () => {
      const host = table('bridge', 3);
      const dealt = host.state!.players.map((p) => host.state!.zones[`hand:${p.seat}`].cards.map((c) => c.id));
      // the auction only: nobody's cards seen but your own (and none played)
      for (let i = 0; i < 200 && host.state!.phase === 'bidding'; i++) {
        const v = host.viewFor('h');
        if (v.actions.length) host.act('h', GAMES.bridge.bot!(host.state!, 0)!);
        vi.advanceTimersByTime(1500);
      }
      play(host, 'bridge', 1);
      const text = host.exportFile('h', 'pbn')!;
      const deal = /\[Deal "([NESW]):(.*)"\]/.exec(text)!;
      const hands = deal[2].split(' ');
      expect(hands.filter((h) => h !== '-').every((h) => dealt.map(handText).includes(h))).toBe(true);
      // someone watching sees no hand but those played out
      const watcher = host.exportFile(null, 'pbn')!;
      const passed = /\[Contract "Pass"\]/.test(watcher.split('\r\n\r\n')[1] ?? '');
      if (passed) expect(/\[Deal "[NESW]:- - - -"\]/.test(watcher)).toBe(true);
      host.close();
    });
  });

  describe("Hold'em, as Open Hand History", () => {
    it('writes one JSON object a hand, with only your own cards and those shown down', () => {
      const host = table('holdem', 3);
      play(host, 'holdem', 4);
      const text = host.exportFile('h', 'ohh')!;
      const hands = text.split('\n\n').map((t) => JSON.parse(t).ohh);
      expect(hands.length).toBeGreaterThanOrEqual(3);
      for (const h of hands) {
        expect(h.spec_version).toBe('1.4.9');
        expect(h.game_type).toBe('Holdem');
        expect(h.currency).toBe('XPM');
        expect(h.hero_player_id).toBe(0);
        expect(h.players.find((p: { id: number }) => p.id === 0).name).toBe('Hána');
        const acts = h.rounds.flatMap((r: { street: string; actions: { action: string; player_id: number; cards?: string[]; amount: number }[] }) =>
          r.actions.map((a) => ({ ...a, street: r.street })),
        );
        // the blinds first, then your cards (and only yours, but for what was shown)
        expect(acts[0].action).toBe('Post SB');
        expect(acts[1].action).toBe('Post BB');
        const dealt = acts.filter((a: { action: string }) => a.action === 'Dealt Cards');
        expect(dealt).toHaveLength(1);
        expect(dealt[0].player_id).toBe(0);
        expect(dealt[0].cards).toHaveLength(2);
        expect(dealt[0].cards.every((c: string) => /^[AKQJT2-9][shdc]$/.test(c))).toBe(true);
        for (const a of acts) if (a.cards && a.action !== 'Dealt Cards') expect(a.action === 'Shows Cards' && a.street === 'Showdown').toBe(true);
        // no "Bet" before the flop (the blinds opened it); amounts are chips put in
        expect(acts.some((a: { action: string; street: string }) => a.action === 'Bet' && a.street === 'Preflop')).toBe(false);
        expect(acts.filter((a: { amount: number }) => a.amount < 0)).toEqual([]);
        const putIn = acts.reduce((n: number, a: { amount: number }) => n + a.amount, 0);
        expect(putIn).toBe(h.pots[0].amount);
        const won = h.pots[0].player_wins.reduce((n: number, w: { win_amount: number }) => n + w.win_amount, 0);
        expect(won).toBe(h.pots[0].amount);
        const ids = ['Preflop', 'Flop', 'Turn', 'River', 'Showdown'];
        expect(h.rounds.map((r: { street: string }) => ids.indexOf(r.street))).toEqual(h.rounds.map((_: unknown, i: number) => i));
      }
      // someone watching: nobody's hole cards but what was shown
      const watched = host
        .exportFile(null, 'ohh')!
        .split('\n\n')
        .map((t) => JSON.parse(t).ohh);
      expect(watched.every((h) => h.hero_player_id === undefined)).toBe(true);
      expect(JSON.stringify(watched)).not.toContain('Dealt Cards');
      host.close();
    });

    it('reaches a player over the network', () => {
      const bus = new Bus();
      const ht = new MemTransport(bus, 'host-peer');
      const host = new Host(ht, 'SAVE', { cid: 'h', name: 'Hana', key: 'hk' });
      bus.join(ht);
      const t = new MemTransport(bus, 'ann-peer');
      const ann = new Client(t, 'ann', 'Ann', undefined, false, 'ak');
      bus.join(t);
      host.setGame('holdem');
      host.addBot();
      host.start();
      play(host, 'holdem', 1, { h: 0, ann: 1 });
      let got: string | null = null;
      ann.onExport = (text) => (got = text);
      ann.exportGame('ohh');
      const h = JSON.parse(got!.split('\n\n')[0]).ohh;
      expect(h.hero_player_id).toBe(1);
      host.close();
    });
  });
});
