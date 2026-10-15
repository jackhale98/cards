import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src/net/client';
import { bidOf } from '../src/engine/families/trick/contracts';
import { recordFormats } from '../src/net/exports/formats';
import { callText, pbn } from '../src/net/exports/pbn';
import { phh } from '../src/net/exports/phh';
import { EVERYONE, type HandFormat } from '../src/net/exports/types';
import { cardCode, GameRecord, toCsv } from '../src/net/gameRecord';
import { familyRules } from '../src/engine/types';
import { Host } from '../src/net/host';
import { getGame } from '../src/games';
import { GAMES } from './games';
import { Bus, MemTransport } from './netHarness';

/**
 * A game with bots in the other seats; Hana's moves made by a bot too, until `hands` hands are
 * done (or nobody here can deal the next: Hana knocked out). Returns how many hands were played.
 */
function play(host: Host, game: string, hands: number, people: Record<string, number> = { h: 0 }): number {
  let done = 0;
  let wasDone = false;
  for (let i = 0; i < 20_000 && done < hands; i++) {
    const over = !!host.viewFor('h').handDone;
    // (each hand counted once, as it ends)
    if (over && !wasDone) done++;
    wasDone = over;
    if (over && !Object.keys(people).some((cid) => host.viewFor(cid).actions.some((a) => a.type === 'next'))) break;
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
  return done;
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

// (bots play whole hands here: allow for a busy machine)
describe('saving a game in its standard record', { timeout: 30_000 }, () => {
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

    // (bots bid and play two whole deals: a few seconds)
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
        const play = g
          .split(/\[Play "[NESW]"\]\r\n/)[1]
          .split('\r\n')
          .filter(Boolean);
        expect(play).toHaveLength(13);
        const cards = play.flatMap((l) => l.split(' '));
        expect(cards.every((c) => /^[SHDC][AKQJT2-9]$/.test(c))).toBe(true);
        expect(new Set(cards).size).toBe(52);
      }
      host.close();
    }, 30000);

    it('writes a passed-out deal as its own board, with its own cards', () => {
      const g = GAMES.bridge;
      let s = g.setup(
        ['N', 'E', 'S', 'W'].map((name) => ({ name, bot: true })),
        11,
        {},
      );
      const record = new GameRecord({ pbn: pbn as HandFormat<unknown> });
      const ended = (x: typeof s) => ['roundOver', 'gameOver'].includes(x.phase);
      record.note(s, false, () => []);
      const first = s.players.map((p) => s.zones[`hand:${p.seat}`].cards.map((c) => c.id));
      // everyone passes: the cards are dealt again at once
      for (let i = 0; i < 4; i++) {
        const next = structuredClone(s);
        const seat = s.turn!;
        g.apply(next, seat, { type: 'decline' });
        s = next;
        record.note(s, ended(s), () => [], { seat, action: { type: 'decline' } });
      }
      const second = s.players.map((p) => s.zones[`hand:${p.seat}`].cards.map((c) => c.id));
      expect(second).not.toEqual(first);
      // then the new deal is bid and played out
      for (let i = 0; i < 2000 && !ended(s); i++) {
        const next = structuredClone(s);
        const sys = g.system?.(s);
        if (sys) {
          sys.run(next);
          s = next;
          record.note(s, ended(s), () => []);
          continue;
        }
        const seat = s.players.find((p) => g.bot!(s, p.seat))!.seat;
        const action = g.bot!(s, seat)!;
        g.apply(next, seat, action);
        s = next;
        record.note(s, ended(s), () => [], { seat, action });
      }
      const text = record.write('pbn', EVERYONE, { names: ['N', 'E', 'S', 'W'], table: 'T' })!;
      const boards = text.split('\r\n\r\n').filter((b) => b.includes('[Deal '));
      expect(boards).toHaveLength(2);
      const deal = (b: string, seat: number) => {
        const [first, hands] = /\[Deal "([NESW]):(.*)"\]/.exec(b)!.slice(1);
        const order = ['N', 'E', 'S', 'W'];
        return hands.split(' ')[(seat - order.indexOf(first) + 4) % 4];
      };
      expect(deal(boards[0], 0)).toBe(handText(first[0]));
      expect(boards[0]).toContain('[Contract "Pass"]');
      expect(boards[0]).toMatch(/\[Auction "[NESW]"\]\r\nPass Pass Pass Pass/);
      expect(deal(boards[1], 0)).toBe(handText(second[0]));
      expect(boards[1]).not.toContain('[Contract "Pass"]');
      // the spreadsheet too: two hands, each with the cards it was played with
      const deals = toCsv(record, 0, ['N', 'E', 'S', 'W'])
        .split('\r\n')
        .filter((r) => /^\d+,,,Deal,/.test(r))
        .map((r) => r.split(',')[4]);
      expect(deals).toEqual([first[0].map(cardCode).join(' '), second[0].map(cardCode).join(' ')]);
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
      // (the bots play with their own dice: Hana may be knocked out before the fourth hand)
      const played = play(host, 'holdem', 4);
      const text = host.exportFile('h', 'ohh')!;
      const hands = text.split('\n\n').map((t) => JSON.parse(t).ohh);
      expect(played).toBeGreaterThanOrEqual(1);
      expect(hands.length).toBe(played);
      for (const h of hands) {
        expect(h.spec_version).toBe('1.4.9');
        expect(h.game_type).toBe('Holdem');
        expect(h.currency).toBe('XPM');
        const acts = h.rounds.flatMap((r: { street: string; actions: { action: string; player_id: number; cards?: string[]; amount: number }[] }) =>
          r.actions.map((a) => ({ ...a, street: r.street })),
        );
        // the blinds first, then your cards (and only yours, but for what was shown)
        expect(acts[0].action).toBe('Post SB');
        expect(acts[1].action).toBe('Post BB');
        const dealt = acts.filter((a: { action: string }) => a.action === 'Dealt Cards');
        // (the bots play with their own dice, so Hana may be knocked out: then she's no hero, and sees no cards)
        const hana = h.players.find((p: { id: number }) => p.id === 0);
        if (!hana) {
          expect(h.hero_player_id).toBeUndefined();
          expect(dealt).toEqual([]);
          continue;
        }
        expect(hana.name).toBe('Hána');
        expect(h.hero_player_id).toBe(0);
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

    it('Omaha is written the same way, as Omaha, with four hole cards of your own', () => {
      const host = table('omaha', 3);
      const played = play(host, 'omaha', 2);
      expect(played).toBeGreaterThanOrEqual(1);
      const hands = host
        .exportFile('h', 'ohh')!
        .split('\n\n')
        .map((t) => JSON.parse(t).ohh);
      expect(hands.length).toBe(played);
      for (const h of hands) {
        expect(h.game_type).toBe('Omaha');
        const acts = h.rounds.flatMap((r: { actions: { action: string; player_id: number; cards?: string[]; amount: number }[] }) => r.actions);
        const dealt = acts.filter((a: { action: string }) => a.action === 'Dealt Cards');
        if (!h.players.some((p: { id: number }) => p.id === 0)) continue;
        expect(dealt).toHaveLength(1);
        expect(dealt[0].cards).toHaveLength(4);
        // the chips add up: everything put in is the pot, and the pot is all won
        const putIn = acts.reduce((n: number, a: { amount: number }) => n + a.amount, 0);
        expect(putIn).toBe(h.pots.reduce((n: number, p: { amount: number }) => n + p.amount, 0));
      }
      host.close();
    }, 30_000);

    it('as PHH (for checking with PokerKit), names positions and hides other hole cards from a player', () => {
      const g = GAMES.holdem;
      const s0 = g.setup(
        ['Ann', 'Bo', 'Cy'].map((name) => ({ name, bot: true })),
        7,
        {},
      );
      const record = new GameRecord({ phh: phh(familyRules(g.config, 'poker')) as HandFormat<unknown> });
      let s = s0;
      record.note(s, false, () => []);
      for (let i = 0; i < 200 && !['handOver', 'gameOver'].includes(s.phase); i++) {
        const sys = g.system?.(s);
        const next = structuredClone(s);
        if (sys) {
          sys.run(next);
          s = next;
          record.note(s, false, () => []);
          continue;
        }
        const seat = s.turn!;
        const action = g.bot!(s, seat)!;
        g.apply(next, seat, action);
        s = next;
        record.note(s, ['handOver', 'gameOver'].includes(s.phase), () => [], { seat, action });
      }
      const meta = { names: ['Ann', 'Bo', 'Cy'], table: 'T' };
      const all = record.write('phh', EVERYONE, meta)!;
      const mine = record.write('phh', 0, meta)!;
      // three-handed: the small blind first, the button last
      const d = s0.data as { button: number };
      const players = JSON.parse(/^players = (.*)$/m.exec(all)![1]) as string[];
      expect(players[2]).toBe(meta.names[d.button]);
      expect(all).toMatch(/^blinds_or_straddles = \[5, 10, 0\]$/m);
      const dealt = (text: string) => [...text.matchAll(/"d dh p(\d) (\S+)"/g)].map((m) => [players[Number(m[1]) - 1], m[2]]);
      expect(dealt(all).every(([, c]) => /^([AKQJT2-9][shdc]){2}$/.test(c))).toBe(true);
      // a player's own copy: their cards, the others' unknown
      for (const [who, cards] of dealt(mine)) expect(cards === '????').toBe(who !== 'Ann');
      expect(record.write('pbn', 0, meta)).toBeNull();
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
