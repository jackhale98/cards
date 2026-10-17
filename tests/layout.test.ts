import { describe, expect, it } from 'vitest';
import type { CardRef, ZoneState } from '../src/engine/types';
import { fan, FULL_HAND, landing, layoutZone, seatRow, type Where } from '../src/ui/layout';
import { overlap, spread } from '../src/ui/layout/spread';
import { stack } from '../src/ui/layout/stack';
import { trick } from '../src/ui/layout/trick';
import { piles } from '../src/ui/layout/piles';

const HAND = ['2C', '5C', '9C', 'KC', '3D', '7D', 'QD', '4H', 'TH', 'AH', '6S', 'JS', 'AS'];
const refs = (ids: string[], extra: Partial<CardRef> = {}): CardRef[] => ids.map((id) => ({ id, ...extra }));
const zone = (layout: ZoneState['layout'], cards: CardRef[], more: Partial<ZoneState> = {}): ZoneState =>
  ({ id: 'z', visibility: 'all', layout, cards, ...more }) as ZoneState;
const MIDDLE: Where = { cw: 60, you: 0, players: 4, style: 'middle', maxW: 800 };
const lefts = (p: { spots: { x: number; w: number }[] }) => p.spots.map((s) => Math.round((s.x - s.w / 2) * 100) / 100);
/** Every card inside the room the zone says it takes (`edge`: a pile's under-card edges peek out a few px). */
function inside(p: { w: number; h: number; spots: { x: number; y: number; w: number; rot: number }[] }, edge = 0.01) {
  for (const s of p.spots) {
    if (s.rot) continue;
    expect(s.x - s.w / 2).toBeGreaterThanOrEqual(-edge);
    expect(s.x + s.w / 2).toBeLessThanOrEqual(p.w + edge);
    expect(s.y - (s.w * 1.4) / 2).toBeGreaterThanOrEqual(-edge);
    expect(s.y + (s.w * 1.4) / 2).toBeLessThanOrEqual(p.h + edge);
  }
}

describe('your hand as a fan', () => {
  it('spreads across the middle of its width, the outer cards leaning out, none past the edge', () => {
    const p = fan(HAND, 800, 60);
    const xs = p.spots.map((s) => s.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(p.spots[6].x).toBeCloseTo(400, 0);
    expect(p.spots[6].rot).toBe(0);
    expect(p.spots[0].rot).toBeLessThan(0);
    expect(p.spots[12].rot).toBeGreaterThan(0);
    for (const s of p.spots) expect(s.x - s.w / 2).toBeGreaterThanOrEqual(-1);
    for (const s of p.spots) expect(s.x + s.w / 2).toBeLessThanOrEqual(801);
  });

  it('closes up as it empties: the cards still overlap', () => {
    const p = fan(HAND.slice(0, 3), 800, 60);
    expect(p.spots[1].x - p.spots[0].x).toBeLessThan(60);
  });

  it('drops a card dragged along it into the nearest place', () => {
    const p = fan(HAND.slice(0, 5), 800, 60);
    expect(landing(p, p.spots[3].x + 4)).toBe(3);
    expect(landing(p, -1000)).toBe(0);
    expect(landing(p, 5000)).toBe(4);
  });

  it('takes no room when empty', () => {
    expect(fan([], 800, 60).h).toBe(0);
  });
});

describe('the trick', () => {
  it('puts each card toward the seat that played it, wherever it comes in the trick', () => {
    const first = trick([{ id: '2C', by: 1 }], 60, 0, 4);
    const all = trick(
      [
        { id: '2C', by: 1 },
        { id: '5C', by: 2 },
        { id: '9C', by: 3 },
        { id: 'KC', by: 0 },
      ],
      60,
      0,
      4,
    );
    // (about three cards wide, two and a quarter tall: a little more, to take in the turned corners)
    expect(all.w).toBeGreaterThanOrEqual(180);
    expect(all.w).toBeLessThan(200);
    expect(all.h).toBeGreaterThanOrEqual(135);
    expect(all.spots[0]).toEqual(first.spots[0]);
    expect(all.spots[3].y).toBeGreaterThan(all.h / 2);
    expect(all.spots[1].y).toBeLessThan(all.h / 2);
    expect(all.spots[0].x).toBeLessThan(all.w / 2);
    expect(all.spots.map((s) => s.z)).toEqual([1, 2, 3, 4]);
  });

  it('takes in every card whole, turned corners and all, however many play (big cards needn’t reach past it)', () => {
    for (const players of [2, 3, 4, 5, 6, 7, 8]) {
      const cards = Array.from({ length: players }, (_, by) => ({ id: `${by + 2}C`, by }));
      const t = trick(cards, 100, 0, players);
      for (const s of t.spots) {
        const a = (Math.abs(s.rot) * Math.PI) / 180;
        const rx = (s.w * Math.cos(a) + s.w * 1.4 * Math.sin(a)) / 2;
        const ry = (s.w * 1.4 * Math.cos(a) + s.w * Math.sin(a)) / 2;
        expect(s.x - rx, `${players}`).toBeGreaterThanOrEqual(-0.01);
        expect(s.x + rx, `${players}`).toBeLessThanOrEqual(t.w + 0.01);
        expect(s.y - ry, `${players}`).toBeGreaterThanOrEqual(-0.01);
        expect(s.y + ry, `${players}`).toBeLessThanOrEqual(t.h + 0.01);
      }
    }
  });
});

describe('a pile', () => {
  it('is one card big, its top face up and the edge of the next one showing', () => {
    const p = stack(zone('stack', refs(['3H', '9S'])), 60);
    expect([p.w, p.h]).toEqual([60, 84]);
    const top = p.spots.at(-1)!;
    expect([top.id, top.x, top.y]).toEqual(['9S', 30, 42]);
    // the card under it as itself (it stays in sight while a new card covers it)
    expect(p.spots.find((s) => s.id === '3H')).toMatchObject({ x: 32, y: 44 });
    expect(top.z).toBeGreaterThan(p.spots[0].z);
  });

  it('names the cards nobody can see by their place in it, so a draw leaves the pile where it was', () => {
    const p = stack(zone('stack', refs(['?deck.0', '?deck.1', '?deck.2'], { up: false }), { id: 'deck' }), 60);
    expect(p.spots.map((s) => s.key)).toEqual(['deck#under', '?deck.2']);
    expect(p.spots.every((s) => s.down)).toBe(true);
    // past eight cards, a second edge
    const big = stack(
      zone(
        'stack',
        refs(
          Array.from({ length: 9 }, (_, i) => `?deck.${i}`),
          { up: false },
        ),
        { id: 'deck' },
      ),
      60,
    );
    expect(big.spots.map((s) => s.key)).toContain('deck#under2');
  });

  it('keeps room above for a cascade’s bottom card from the start', () => {
    const one = stack(zone('stack', refs(['KH']), { cascade: true }), 60);
    const three = stack(zone('stack', refs(['KH', 'QS', 'JH']), { cascade: true }), 60);
    expect(one.h).toBe(three.h);
    expect(three.spots[0]).toMatchObject({ id: 'KH', y: 42 });
    expect(three.spots.at(-1)).toMatchObject({ id: 'JH', y: 42 + 0.42 * 60 });
  });

  it('fans the cards under the top out to its left when it peeks', () => {
    const p = stack(zone('stack', refs(['2C', '3C', '4C', '5C']), { peek: 3 }), 60);
    const top = p.spots.at(-1)!;
    const peeked = p.spots.filter((s) => s.rot);
    expect(peeked.map((s) => s.id)).toEqual(['3C', '4C']);
    for (const s of peeked) expect(s.x).toBeLessThan(top.x);
    inside(p, 4);
  });
});

describe('a row of cards', () => {
  it('in the middle: up to four side by side, overlapped from five, tighter for a whole hand', () => {
    expect(spread(refs(['2C', '3C', '4C']), 60, { style: 'middle', maxW: 1e4 }).w).toBeCloseTo(3 * 60 + 2 * 6);
    expect(spread(refs(HAND.slice(0, 5)), 60, { style: 'middle', maxW: 1e4 }).w).toBeCloseTo(60 + 4 * 0.65 * 60);
    expect(spread(refs(HAND), 60, { style: 'middle', maxW: 1e4 }).w).toBeCloseTo(60 + 12 * 0.44 * 60);
    // (with room to spare, side by side)
    expect(spread(refs(HAND.slice(0, 5)), 60, { style: 'middle', maxW: 1e4, roomy: true }).w).toBeCloseTo(5 * 66 - 6);
  });

  it('sets each new group apart', () => {
    const cards = [...refs(['2C', '3C'], { group: 0 }), ...refs(['4H', '5H'], { group: 1 })];
    const p = spread(cards, 60, { style: 'middle', maxW: 1e4 });
    const l = lefts(p);
    expect(l[2] - l[1]).toBeCloseTo(66 + 0.22 * 60);
    expect(l[1] - l[0]).toBeCloseTo(66);
  });

  it('wraps onto more rows inside its width, and is as tall as its rows', () => {
    const p = spread(refs(HAND.slice(0, 8)), 60, { style: 'middle', maxW: 200 });
    expect(p.w).toBeLessThanOrEqual(200);
    const rows = new Set(p.spots.map((s) => s.y));
    expect(rows.size).toBeGreaterThan(1);
    expect(p.h).toBeCloseTo(rows.size * 84 + (rows.size - 1) * 6);
    inside(p);
  });

  it('keeps room for a growing pile and fills it from the left', () => {
    const one = spread(refs(['7H']), 60, { style: 'middle', maxW: 1e4, reserve: 4 });
    const three = spread(refs(['7H', '8H', '9H']), 60, { style: 'middle', maxW: 1e4, reserve: 4 });
    expect(one.w).toBeCloseTo(60 * (1 + 3 * 0.65));
    expect(three.w).toBe(one.w);
    expect(one.spots[0].x).toBe(three.spots[0].x);
    expect(one.spots[0].x).toBe(30);
  });

  it('on the strip: always overlapped, one row however long', () => {
    const p = spread(refs(HAND), 40, { style: 'strip', maxW: Infinity });
    expect(new Set(p.spots.map((s) => s.y)).size).toBe(1);
    expect(overlap({ style: 'strip' }, 3, false)).toBe(-0.45);
  });

  it('a whole hand face up keeps the width of thirteen cards as it empties', () => {
    const full = layoutZone(zone('spread', refs(HAND), { faceUpHand: true }), { ...MIDDLE, dummy: { cw: 50, minW: 50 * FULL_HAND } });
    const few = layoutZone(zone('spread', refs(HAND.slice(0, 4)), { faceUpHand: true }), { ...MIDDLE, dummy: { cw: 50, minW: 50 * FULL_HAND } });
    expect(few.w).toBe(full.w);
    expect(full.w).toBeGreaterThanOrEqual(50 * FULL_HAND - 0.01);
    inside(full);
  });

  it('draws face-down and marked cards so', () => {
    const p = spread(
      [
        { id: '?t~1', up: false },
        { id: '9H', dim: true },
      ],
      60,
      { style: 'middle', maxW: 1e4 },
    );
    expect(p.spots.map((s) => [s.down, s.dim])).toEqual([
      [true, undefined],
      [false, true],
    ]);
  });

  it('an empty row keeps a place two cards wide', () => {
    expect(spread([], 60, { style: 'middle', maxW: 1e4 })).toEqual({ w: 120, h: 84, spots: [] });
  });
});

describe('melds as piles', () => {
  const meld = (ids: string[], group: number) => refs(ids, { group });
  it('squares each meld’s cards into a pile with its count, wild cards beside it', () => {
    const p = piles([...meld(['7H', '7S', '7D', '2C'], 0), ...meld(['KH', 'KS', 'KD'], 1)], 50, { maxW: 1e4 });
    const top7 = p.spots.find((s) => s.id === '7D')!;
    expect(top7.count).toBe(3);
    expect(p.spots.find((s) => s.id === '7H')!.count).toBeUndefined();
    const wild = p.spots.find((s) => s.id === '2C')!;
    expect(wild.x).toBeGreaterThan(top7.x);
    // the squared cards a little up and along, each on the one before
    const sevens = ['7H', '7S', '7D'].map((id) => p.spots.find((s) => s.id === id)!);
    expect(sevens[1].x - sevens[0].x).toBe(2);
    expect(sevens[1].y - sevens[0].y).toBe(-2);
    inside(p);
  });

  it('wraps the piles into rows that stand on a common line', () => {
    const many = Array.from({ length: 6 }, (_, g) => meld([`${g + 3}H`, `${g + 3}S`], g)).flat();
    const p = piles(many, 50, { maxW: 200 });
    expect(p.w).toBeLessThanOrEqual(200);
    expect(new Set(p.spots.filter((s) => s.count).map((s) => Math.round(s.y))).size).toBeGreaterThan(1);
    inside(p);
  });
});

describe('a zone by its layout', () => {
  it('lays out each kind the way its layout says', () => {
    expect(layoutZone(zone('trick', []), MIDDLE).w).toBeCloseTo(trick([], 60, 0, 4).w);
    expect(layoutZone(zone('stack', refs(['5C'])), MIDDLE).w).toBe(60);
    expect(layoutZone(zone('spread', refs(['5C', '6C'])), MIDDLE).w).toBeCloseTo(126);
    expect(layoutZone(zone('spread', refs(['5C', '5D'], { group: 0 }), { piles: true }), MIDDLE).spots.at(-1)!.count).toBe(2);
  });

  it('gives the same places for the same zone', () => {
    const z = zone('spread', refs(HAND.slice(0, 7)));
    expect(layoutZone(z, MIDDLE)).toEqual(layoutZone(structuredClone(z), MIDDLE));
  });
});

describe('cards you can pick', () => {
  it('spread out enough to tap each one', () => {
    const tight = spread(refs(HAND.slice(0, 6)), 34, { style: 'strip', maxW: Infinity });
    const picking = spread(refs(HAND.slice(0, 6)), 34, { style: 'strip', maxW: Infinity, tap: 30 });
    const shows = (p: typeof tight) => Math.min(...p.spots.slice(1).map((s, i) => s.x - p.spots[i].x));
    expect(shows(tight)).toBeLessThan(30);
    expect(shows(picking)).toBeGreaterThanOrEqual(30);
  });
});

describe('a seat’s cards', () => {
  const at = (cards: CardRef[], crowded = false) => seatRow(cards, { seat: 2, up: 30, back: 22, crowded });
  const hidden = (n: number): CardRef[] => Array.from({ length: n }, (_, i) => ({ id: `?hand:2.${i}` }));

  it('face up first, then up to four backs named by the seat (one in a crowded row), in one overlapped row', () => {
    const p = at([{ id: 'AS' }, { id: 'KH' }, ...hidden(9)]);
    expect(p.spots.map((s) => s.key)).toEqual(['AS', 'KH', 'seat:2:0', 'seat:2:1', 'seat:2:2', 'seat:2:3']);
    expect(p.spots.map((s) => s.down ?? false)).toEqual([false, false, true, true, true, true]);
    expect(p.spots.map((s) => s.w)).toEqual([30, 30, 22, 22, 22, 22]);
    // (face up cards show more of each, so their corners can be read)
    expect(p.spots[1].x - p.spots[0].x).toBeCloseTo(30 * 0.45);
    expect(p.spots[3].x - p.spots[2].x).toBeCloseTo(22 * 0.3);
    expect(p.h).toBeCloseTo(42);
    expect(p.spots.every((s) => s.y === p.h / 2)).toBe(true);
    expect(at(hidden(9), true).spots.map((s) => s.key)).toEqual(['seat:2:0']);
    expect(at(hidden(2)).spots).toHaveLength(2);
    expect(at([])).toEqual({ w: 0, h: 0, spots: [] });
  });

  it('with a trick: the front card is theirs in it, face up and readable, or a back the same size till they play', () => {
    const before = at(hidden(9), true);
    const none = seatRow(hidden(9), { seat: 2, up: 30, back: 22, crowded: true, played: null });
    const played = seatRow(hidden(8), { seat: 2, up: 30, back: 22, crowded: true, played: { id: 'QS' } });
    expect(none.spots.map((s) => [s.key, s.w, s.down])).toEqual([['seat:2:front', 30, true]]);
    expect(played.spots.map((s) => [s.key, s.id, s.w, s.down])).toEqual([['seat:2:played', 'QS', 30, false]]);
    // (the seat keeps its width as they play)
    expect(played.w).toBe(none.w);
    expect(none.w).toBeGreaterThan(before.w);
    // (a roomy row: the other backs behind it, a strip of each showing)
    const roomy = seatRow(hidden(8), { seat: 2, up: 30, back: 22, crowded: false, played: { id: 'QS' } });
    expect(roomy.spots.map((s) => s.key)).toEqual(['seat:2:0', 'seat:2:1', 'seat:2:2', 'seat:2:played']);
    expect(roomy.spots[3].x - roomy.spots[2].x).toBeCloseTo(22 * 0.3 + (30 - 22) / 2);
    // (no taller than the seat: the readable card overhangs it evenly, so the seat keeps its height
    // with cards or without)
    const kept = seatRow(hidden(8), { seat: 2, up: 30, back: 22, crowded: true, played: { id: 'QS' }, room: 34 });
    expect(kept.h).toBe(34);
    expect(kept.spots[0].y).toBe(17);
  });
});
