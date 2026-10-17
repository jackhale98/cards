import { describe, expect, it } from 'vitest';
import { bridgeScore, type TrickData } from '../src/engine/families/trick';
import { endRound } from '../src/engine/families/trick/scoring';
import { trickGame } from '../src/engine/families/trick/types';
import type { GameModule, GameState } from '../src/engine/types';
import { GAMES } from './games';

const g = GAMES['bridge'] as GameModule<TrickData>;
const bots = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, bot: true }));
const ids = (s: GameState, z: string) => s.zones[z].cards.map((c) => c.id);
const cardsIn = (s: GameState) => Object.values(s.zones).reduce((n, z) => n + z.cards.length, 0);
/** Bid index: level 1–7, strain C D H S NT. */
const bid = (level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT') => (level - 1) * 5 + ['C', 'D', 'H', 'S', 'NT'].indexOf(strain);

describe('bridge scoring', () => {
  it('scores made contracts', () => {
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 0 }, false, 10)).toBe(420);
    expect(bridgeScore({ level: 3, strain: 'NT', dbl: 0 }, false, 9)).toBe(400);
    expect(bridgeScore({ level: 3, strain: 'NT', dbl: 0 }, true, 10)).toBe(630);
    expect(bridgeScore({ level: 1, strain: 'NT', dbl: 0 }, false, 8)).toBe(120);
    expect(bridgeScore({ level: 2, strain: 'C', dbl: 0 }, false, 8)).toBe(90);
    expect(bridgeScore({ level: 2, strain: 'H', dbl: 1 }, false, 8)).toBe(470);
    expect(bridgeScore({ level: 2, strain: 'H', dbl: 1 }, true, 9)).toBe(870);
    expect(bridgeScore({ level: 1, strain: 'S', dbl: 2 }, false, 7)).toBe(520);
    expect(bridgeScore({ level: 6, strain: 'S', dbl: 0 }, true, 12)).toBe(1430);
    expect(bridgeScore({ level: 7, strain: 'NT', dbl: 0 }, false, 13)).toBe(1520);
    expect(bridgeScore({ level: 5, strain: 'D', dbl: 0 }, false, 11)).toBe(400);
  });

  it('scores undertricks for the defenders', () => {
    expect(bridgeScore({ level: 3, strain: 'C', dbl: 0 }, false, 7)).toBe(-100);
    expect(bridgeScore({ level: 3, strain: 'C', dbl: 0 }, true, 7)).toBe(-200);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, false, 7)).toBe(-500);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, false, 6)).toBe(-800);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 1 }, true, 8)).toBe(-500);
    expect(bridgeScore({ level: 4, strain: 'S', dbl: 2 }, false, 9)).toBe(-200);
  });
});

describe('bridge', () => {
  it('deals 13 each and the dealer calls first', () => {
    const s = g.setup(bots, 1, {});
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`)).toHaveLength(13);
    expect(s.phase).toBe('call');
    expect(s.turn).toBe(s.dealer);
    expect(s.data.vul).toEqual([false, false]);
  });

  it('runs an auction with doubles; the first to name the strain declares', () => {
    const s = g.setup(bots, 2, {});
    const d0 = s.dealer; // seat 3
    const p = (k: number) => (d0 + k) % 4;
    g.apply(s, p(0), { type: 'call', amount: bid(1, 'H') });
    // the dealer's partner can't double their own side
    expect(g.actions(s, p(1)).some((a) => a.type === 'double')).toBe(true);
    g.apply(s, p(1), { type: 'call', amount: bid(1, 'S') });
    expect(() => g.apply(s, p(2), { type: 'call', amount: bid(1, 'D') })).toThrow();
    g.apply(s, p(2), { type: 'call', amount: bid(2, 'H') });
    expect(g.actions(s, p(3)).some((a) => a.type === 'double')).toBe(true);
    g.apply(s, p(3), { type: 'double' });
    expect(g.actions(s, p(0)).some((a) => a.type === 'redouble')).toBe(true);
    g.apply(s, p(0), { type: 'decline' });
    g.apply(s, p(1), { type: 'decline' });
    expect(s.phase).toBe('call');
    g.apply(s, p(2), { type: 'decline' });
    expect(s.phase).toBe('play');
    // hearts first named by the dealer → dealer declares 2♥ doubled, their partner is dummy
    expect(s.data.maker).toBe(p(0));
    expect(s.data.dummy).toBe(p(2));
    expect(s.data.bridge).toEqual({ level: 2, strain: 'H', dbl: 1 });
    expect(s.data.trump).toBe('H');
    expect(s.turn).toBe(p(1)); // left of declarer leads
  });

  it('redeals with the same dealer when all pass', () => {
    const s = g.setup(bots, 3, {});
    const dealer = s.dealer;
    for (let i = 0; i < 4; i++) g.apply(s, s.turn!, { type: 'decline' });
    expect(s.phase).toBe('call');
    expect(s.dealer).toBe(dealer);
    expect(s.data.calls).toEqual([]);
  });

  it('lays down the dummy after the opening lead; the declarer plays it', () => {
    const s = g.setup(bots, 4, {});
    const dealer = s.dealer;
    g.apply(s, dealer, { type: 'call', amount: bid(3, 'NT') });
    for (let i = 0; i < 3; i++) g.apply(s, s.turn!, { type: 'decline' });
    const declarer = dealer;
    const dummy = (declarer + 2) % 4;
    const leader = s.turn!;
    expect(ids(s, 'dummy')).toHaveLength(0);
    g.apply(s, leader, { type: 'play', cards: [g.actions(s, leader)[0].select!.cards[0]] });
    expect(ids(s, 'dummy')).toHaveLength(13);
    expect(ids(s, `hand:${dummy}`)).toHaveLength(0);
    expect(s.turn).toBe(dummy);
    // the dummy can't play; the declarer plays from the dummy
    expect(g.actions(s, dummy)).toEqual([]);
    const spec = g.actions(s, declarer).find((a) => a.type === 'play')!;
    expect(spec.label).toBe('Play from dummy');
    expect(spec.select!.cards.every((c) => ids(s, 'dummy').includes(c))).toBe(true);
    expect(() => g.apply(s, dummy, { type: 'play', cards: [spec.select!.cards[0]] })).toThrow();
    expect(s.log.at(-1)!.at).toBeUndefined();
    g.apply(s, declarer, { type: 'play', cards: [spec.select!.cards[0]] });
    expect(s.zones.trick.cards[1].by).toBe(dummy);
    // (the declarer's play, the dummy's card: it shows at the dummy's seat)
    expect(s.log.at(-1)).toMatchObject({ seat: declarer, at: dummy });
    expect(g.status(s, declarer).actor).toBe((dummy + 1) % 4);
    // the bot playing for a human declarer's dummy does nothing
    expect(g.bot!(s, dummy)).toBeNull();
  });

  it('rotates vulnerability Chicago-style and plays full games with bots', () => {
    for (const seed of [5, 6, 7]) {
      const s = g.setup(bots, seed, {});
      const vuls: string[] = [];
      let deals = 0;
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        if (s.phase === 'call' && s.data.calls!.length === 0) vuls[s.data.round] = JSON.stringify(s.data.vul);
        const sys = g.system?.(s);
        if (sys) {
          sys.run(s);
          continue;
        }
        if (s.phase === 'roundOver') {
          deals++;
          expect(cardsIn(s)).toBe(52);
          g.apply(s, 0, { type: 'next' });
          continue;
        }
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        if (seat < 0) throw new Error(`stuck in ${s.phase}`);
        g.apply(s, seat, g.bot!(s, seat)!);
      }
      expect(s.phase).toBe('gameOver');
      expect(deals).toBe(3);
      // dealers 3, 0, 1, 2: deal 2 → the side not dealing (team 1), deal 3 → team 0, as pagat has it
      expect(vuls).toEqual(['[false,false]', '[false,true]', '[true,false]', '[true,true]']);
      expect(s.data.scores.some((x) => x > 0)).toBe(true);
    }
  });

  it('bots reach sensible contracts', () => {
    const levels: number[] = [];
    for (let seed = 10; seed < 60; seed++) {
      const s = g.setup(bots, seed, {});
      for (let i = 0; i < 200 && s.phase === 'call'; i++) g.apply(s, s.turn!, g.bot!(s, s.turn!)!);
      if (s.data.bridge) levels.push(s.data.bridge.level);
    }
    expect(levels.length).toBeGreaterThan(30);
    expect(Math.max(...levels)).toBeLessThanOrEqual(7);
    // mostly part-scores and games, with the odd slam
    expect(levels.filter((l) => l >= 6).length).toBeLessThan(levels.length / 5);
    expect(levels.filter((l) => l >= 3).length).toBeGreaterThan(0);
  });
});

describe('bridge headline', () => {
  it("leaves the contract to the declarer's badge, not the tip", () => {
    for (let seed = 1; seed < 20; seed++) {
      let s = g.setup(bots, seed, {});
      for (let i = 0; i < 400 && s.phase !== 'trickEnd' && s.phase !== 'gameOver'; i++) {
        const sys = g.system?.(s);
        const next = structuredClone(s);
        if (sys) sys.run(next);
        else {
          const seat = s.players.find((p) => g.bot!(s, p.seat))?.seat ?? s.players.find((p) => g.actions(s, p.seat).some((a) => a.type === 'next'))?.seat;
          if (seat == null) break;
          g.apply(next, seat, g.bot!(s, seat) ?? { type: 'next' });
        }
        s = next;
      }
      if (s.phase !== 'trickEnd' || s.turn != null) continue;
      const st = g.status(s, 0);
      const contract = st.seats[s.data.maker as number].badge!.match(/^Declarer (\S+)/)![1];
      expect(st.headline ?? '').not.toContain(contract);
      expect(st.headline ?? '').not.toContain(' by ');
      return;
    }
    throw new Error('no deal reached the end of a trick');
  });
});

describe('bridge: Chicago and rubber scoring (pagat)', () => {
  const tg = trickGame(g.config);
  const people = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` }));
  /** Score a deal: seat `maker` (team maker % 2) declared `level` `strain` and their side took `won` tricks. */
  function deal(s: GameState<TrickData>, maker: number, level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT', won: number, dbl: 0 | 1 | 2 = 0) {
    const d = s.data;
    d.bridge = { level, strain, dbl };
    d.maker = maker;
    d.tricks = [0, 1, 2, 3].map((i) => (i === maker ? won : i === (maker + 1) % 4 ? 13 - won : 0));
    const before = [...d.scores];
    endRound(tg, s);
    const gained = d.scores.map((x, ti) => x - before[ti]);
    if (s.phase === 'roundOver') {
      d.round++;
      d.honours = null;
    }
    return gained;
  }

  it('Chicago: part scores carry until a game, which wipes both out', () => {
    const s = g.setup(people, 1, {});
    expect(deal(s, 0, 2, 'H', 8)).toEqual([60, 0]); // no bonus for a part score before deal 4
    expect(s.data.below).toEqual([60, 0]);
    expect(deal(s, 1, 1, 'C', 7)).toEqual([0, 20]);
    expect(s.data.below).toEqual([60, 20]);
    // 2♠ makes 60 more: game, worth 300 (500 vulnerable)
    const vul = s.data.vul![0];
    expect(deal(s, 0, 2, 'S', 8)).toEqual([60 + (vul ? 500 : 300), 0]);
    expect(s.data.below).toEqual([0, 0]);
  });

  it('Chicago: a part score on the fourth deal adds 100, and part scores clear after four deals', () => {
    const s = g.setup(people, 1, { deals: 8 });
    s.data.round = 3;
    expect(deal(s, 0, 1, 'NT', 7)).toEqual([140, 0]);
    expect(s.data.below).toEqual([0, 0]);
  });

  it('rubber: a game makes your side vulnerable, and two games win the rubber', () => {
    const s = g.setup(people, 1, { style: 1 });
    expect(s.data.vul).toEqual([false, false]);
    expect(deal(s, 0, 4, 'S', 10)).toEqual([120, 0]); // no bonus for a game until the rubber
    expect(s.data.games).toEqual([1, 0]);
    expect(s.phase).toBe('roundOver');
    g.apply(s, 0, { type: 'next' });
    expect(s.data.vul).toEqual([true, false]);
    // vulnerable and down 1: 100 to the other side
    expect(deal(s, 0, 4, 'H', 9)).toEqual([0, 100]);
    g.apply(s, 0, { type: 'next' });
    // 3NT makes the second game: 100 + 700 for the rubber, 2–0
    expect(deal(s, 2, 3, 'NT', 9)).toEqual([800, 0]);
    expect(s.phase).toBe('gameOver');
    expect(s.winner!.sort()).toEqual([0, 2]);
  });

  it('rubber: bots play one to the end', () => {
    const s = g.setup(bots, 7, { style: 1 });
    for (let i = 0; i < 40000 && s.phase !== 'gameOver'; i++) {
      const sys = g.system?.(s);
      if (sys) sys.run(s);
      else if (s.phase === 'roundOver') g.apply(s, 0, { type: 'next' });
      else {
        const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
        g.apply(s, seat, g.bot!(s, seat)!);
      }
    }
    expect(s.phase).toBe('gameOver');
    expect(Math.max(...s.data.games!)).toBe(2);
    expect(g.status(s, 0).scoreboard!.columns).toEqual(['Part score', 'Games', 'Total']);
  });

  it('rubber: 2–1 is worth 500', () => {
    const s = g.setup(people, 1, { style: 1 });
    s.data.games = [1, 1];
    expect(deal(s, 1, 5, 'D', 11)).toEqual([0, 100 + 500]);
    expect(s.phase).toBe('gameOver');
  });

  it('rubber: honours held by one player score, and only show when the hand is scored', () => {
    for (let seed = 1; seed < 400; seed++) {
      const s = g.setup(people, seed, { style: 1 });
      // find a dealt hand with four aces, then have that side's player declare no trumps
      const holder = [0, 1, 2, 3].find((i) => ids(s, `hand:${i}`).filter((c) => c[0] === 'A').length === 4);
      if (holder == null) continue;
      while (s.turn !== holder) g.apply(s, s.turn!, { type: 'decline' });
      g.apply(s, holder, { type: 'call', amount: bid(1, 'NT') });
      for (let k = 0; k < 3; k++) g.apply(s, s.turn!, { type: 'decline' });
      expect(s.data.honours).toMatchObject({ seat: holder, pts: 150 });
      expect(g.redactData!(s, holder).honours).toBeNull();
      expect(deal(s, holder, 1, 'NT', 7)[holder % 2]).toBe(40 + 150);
      return;
    }
    throw new Error('no hand with four aces');
  });
});

describe('bridge: duplicate', () => {
  const tg = trickGame(g.config);
  const people = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` }));
  const DUP = { style: 2, deals: 4 };
  /** Boards dealt from a seed (as another table would have them). */
  const boardsFrom = (seed: number, count = 4) => g.setup(people, seed, { ...DUP, deals: count }).data.boards!;
  /** Score the board being played: seat `maker` declared, their side took `won` tricks. */
  function play(s: GameState<TrickData>, maker: number, level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT', won: number, dbl: 0 | 1 | 2 = 0) {
    const d = s.data;
    d.bridge = { level, strain, dbl };
    d.maker = maker;
    d.tricks = [0, 1, 2, 3].map((i) => (i === maker ? won : i === (maker + 1) % 4 ? 13 - won : 0));
    endRound(tg, s);
  }
  const passAll = (s: GameState<TrickData>) => {
    for (let i = 0; i < 4; i++) g.apply(s, s.turn!, { type: 'decline' });
  };

  it('deals each board as given, its dealer and vulnerability from its number', () => {
    const boards = boardsFrom(5, 8);
    const s = g.setup(people, 1, DUP, { boards: boards.slice(1, 7) });
    // board 2: East deals, North–South vulnerable
    expect(s.data.board).toBe(2);
    expect(s.dealer).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.data.vul).toEqual([true, false]);
    for (let i = 0; i < 4; i++) expect(ids(s, `hand:${i}`).sort()).toEqual([...boards[1].hands[i]].sort());
    // board 7: South deals, everyone vulnerable
    s.data.round = 5;
    s.phase = 'roundOver';
    s.data.round--;
    g.apply(s, 0, { type: 'next' });
    expect(s.data.board).toBe(7);
    expect(s.dealer).toBe(2);
    expect(s.data.vul).toEqual([true, true]);
    expect(cardsIn(s)).toBe(52);
  });

  it('scores each board on its own: a game or part score bonus on the board, nothing carried', () => {
    const s = g.setup(people, 1, DUP, { boards: boardsFrom(5) });
    // board 1, nobody vulnerable: North makes 4♠ +1 (450); a part score next doesn't build on anything
    play(s, 0, 4, 'S', 11);
    expect(s.data.scores).toEqual([450, 0]);
    expect(s.data.results).toEqual([{ n: 1, contract: '4S', declarer: 0, tricks: 11, ns: 450 }]);
    g.apply(s, 0, { type: 'next' });
    // board 2, North–South vulnerable: East makes 2♥ (110: 60 and the part score's 50)
    play(s, 1, 2, 'H', 8);
    expect(s.data.scores).toEqual([450, 110]);
    expect(s.data.results![1]).toEqual({ n: 2, contract: '2H', declarer: 1, tricks: 8, ns: -110 });
  });

  it('a board all four pass is passed out: no score, and no new deal', () => {
    const s = g.setup(people, 1, DUP, { boards: boardsFrom(5) });
    passAll(s);
    expect(s.phase).toBe('roundOver');
    expect(s.data.results).toEqual([{ n: 1, contract: null, declarer: null, tricks: null, ns: 0 }]);
    expect(s.data.scores).toEqual([0, 0]);
    g.apply(s, 0, { type: 'next' });
    expect(s.data.board).toBe(2);
  });

  it('ends after the boards: most points wins', () => {
    const s = g.setup(people, 1, { ...DUP, deals: 4 });
    for (let k = 0; k < 4; k++) {
      play(s, 1, 3, 'NT', 9);
      if (k < 3) g.apply(s, 0, { type: 'next' });
    }
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([1, 3]);
    expect(g.report!(s).boards).toHaveLength(4);
  });

  it('nobody sees the boards: not the ones still to come, nor the hands in them', () => {
    const s = g.setup(people, 1, DUP);
    for (const viewer of [-1, 0, 1, 2, 3]) expect(g.redactData!(s, viewer).boards).toBeUndefined();
  });

  it('boards dealt from the same seed are the same; a game again deals new ones', () => {
    expect(boardsFrom(9)).toEqual(boardsFrom(9));
    const s = g.setup(people, 1, { ...DUP, deals: 4 });
    const first = structuredClone(s.data.boards);
    for (let k = 0; k < 4; k++) {
      passAll(s);
      if (k < 3) g.apply(s, 0, { type: 'next' });
    }
    g.apply(s, 0, { type: 'rematch' });
    expect(s.data.boards).not.toEqual(first);
    expect(s.data.results).toEqual([]);
    expect(s.data.board).toBe(1);
  });

  it('bots play a duplicate game through, board by board', () => {
    const s = g.setup(bots, 3, { ...DUP, botLevel: 0 });
    const boards: number[] = [];
    for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
      const sys = g.system?.(s);
      if (sys) {
        sys.run(s);
        continue;
      }
      if (s.phase === 'roundOver') {
        boards.push(s.data.board!);
        g.apply(s, 0, { type: 'next' });
        continue;
      }
      const seat = s.players.findIndex((p) => g.bot!(s, p.seat));
      if (seat < 0) throw new Error(`stuck in ${s.phase}`);
      g.apply(s, seat, g.bot!(s, seat)!);
    }
    expect(s.phase).toBe('gameOver');
    expect([...boards, s.data.board]).toEqual([1, 2, 3, 4]);
    expect(s.data.results!.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    expect(s.data.scores.reduce((a, b) => a + b)).toBe(s.data.results!.reduce((t, r) => t + Math.abs(r.ns), 0));
  });

  it('refuses boards that aren’t a whole deck dealt thirteen a hand', () => {
    const boards = boardsFrom(5);
    boards[0].hands[0][0] = boards[0].hands[1][0];
    expect(() => g.setup(people, 1, DUP, { boards })).toThrow();
  });

  it('compared with another table: each board in IMPs, the game decided on them once the last result is in', () => {
    const s = g.setup(people, 1, { ...DUP, deals: 2 }, { boards: boardsFrom(5, 2), compared: true });
    // board 1 here: 4♠ by North, made (420); there: 4♠ by North, one off (−50): +470 is 10 IMPs
    play(s, 0, 4, 'S', 10);
    const there = { at: 'Bots', declarer: 0 };
    g.compare!(s, [{ ...there, n: 1, contract: '4S', tricks: 9, ns: -50 }]);
    // (a board not yet played here is kept back; a repeat is ignored)
    g.compare!(s, [
      { ...there, n: 1, contract: '4S', tricks: 9, ns: -50 },
      { ...there, n: 2, contract: '3NT', tricks: 10, ns: 430 },
    ]);
    expect(s.data.others).toHaveLength(1);
    const board = g.status(s, 0).scoreboard!;
    expect(board.columns).toEqual(['Here', 'Bots', 'IMPs N–S']);
    // (a thin space keeps a contract from reading as a card)
    expect(board.rows[0]).toEqual({ name: 'Board 1', values: ['4\u2009♠ N = +420', '4\u2009♠ N −1 −50', '+10'] });
    g.apply(s, 0, { type: 'next' });
    // board 2, everyone's last: East–West make 3NT (here 400 to them); the result from there is still to come
    play(s, 1, 3, 'NT', 9);
    expect(s.phase).toBe('roundOver');
    expect(g.actions(s, 0)).toEqual([]);
    expect(g.status(s, 0).headline).toBe('Every board played: waiting for the other table');
    // there, East–West bid and made 6NT (990): North–South lost 400 here rather than 990: +590 is 11 IMPs
    g.compare!(s, [{ ...there, n: 2, contract: '6NT', declarer: 1, tricks: 12, ns: -990 }]);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toEqual([0, 2]);
    expect(g.standings!(s)).toEqual([0, 2, 0, 2]);
    expect(g.status(s, 0).scoreboard!.rows.at(-2)!.values.at(-1)).toBe('+21 IMPs');
  });
});
