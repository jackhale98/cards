import { describe, expect, it } from 'vitest';
import { fan, landing, layout, offstage, travel, trick, type Box } from '../src/ui/layout/cardLayout';

const HAND: Box = { x: 0, y: 300, w: 800, h: 110 };
const TRICK: Box = { x: 300, y: 100, w: 180, h: 135 };
const ids = (n: number) => ['2C', '5C', '9C', 'KC', '3D', '7D', 'QD', '4H', 'TH', 'AH', '6S', 'JS', 'AS'].slice(0, n);

describe('the card layout', () => {
  it('fans a hand across the middle of its strip, inside it', () => {
    const spots = fan(ids(13), HAND, 60);
    const xs = spots.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // centred: the middle card is at the middle
    expect(spots[6].x).toBeCloseTo(HAND.x + HAND.w / 2, 0);
    expect(spots[6].rot).toBe(0);
    // the outer cards lean out, and no card's centre is outside the strip
    expect(spots[0].rot).toBeLessThan(0);
    expect(spots[12].rot).toBeGreaterThan(0);
    for (const p of spots) {
      expect(p.x - p.w / 2).toBeGreaterThanOrEqual(HAND.x - 1);
      expect(p.x + p.w / 2).toBeLessThanOrEqual(HAND.x + HAND.w + 1);
    }
  });

  it('closes the fan up as it empties: the cards still overlap', () => {
    const few = fan(ids(3), HAND, 60);
    expect(few[1].x - few[0].x).toBeLessThan(60);
    expect(few[1].x).toBeCloseTo(HAND.x + HAND.w / 2, 0);
  });

  it('puts each trick card toward the seat that played it, wherever it comes in the trick', () => {
    const first = trick([{ id: '2C', by: 1 }], TRICK, 0, 4);
    const all = trick(
      [
        { id: '2C', by: 1 },
        { id: '5C', by: 2 },
        { id: '9C', by: 3 },
        { id: 'KC', by: 0 },
      ],
      TRICK,
      0,
      4,
    );
    expect(all[0].x).toBe(first[0].x);
    expect(all[0].y).toBe(first[0].y);
    // yours is below the middle, the player across's above, the left's to the left
    const mid = TRICK.y + TRICK.h / 2;
    expect(all[3].y).toBeGreaterThan(mid);
    expect(all[1].y).toBeLessThan(mid);
    expect(all[0].x).toBeLessThan(TRICK.x + TRICK.w / 2);
    // later cards lie on top, and the trick over the hand
    expect(all.map((p) => p.z)).toEqual([...all.map((p) => p.z)].sort((a, b) => a - b));
    expect(all[0].z).toBeGreaterThan(Math.max(...fan(ids(13), HAND, 60).map((p) => p.z)));
  });

  it('gives the same places for the same table', () => {
    const t = { hand: { ids: ids(8), box: HAND, cw: 60 }, trick: { cards: [{ id: 'AS', by: 2 }], box: TRICK }, you: 0, players: 4 };
    expect(layout(t)).toEqual(layout(structuredClone(t)));
    expect(layout(t).map((p) => p.id)).toEqual(['AS', ...ids(8)]);
  });

  it('brings a card in from a seat small and faded, and from a pile card-sized', () => {
    const [p] = trick([{ id: 'QS', by: 2 }], TRICK, 0, 4);
    const seat: Box = { x: 400, y: 0, w: 120, h: 40 };
    const fromSeat = offstage(p, seat, { arriving: true });
    expect([fromSeat.x, fromSeat.y]).toEqual([460, 20]);
    expect(fromSeat.w).toBeLessThan(p.w);
    expect(fromSeat.opacity).toBe(0);
    const fromPile = offstage(p, { x: 10, y: 10, w: 50, h: 70 }, { arriving: true, pile: true });
    expect(fromPile.w).toBe(50);
    expect(fromPile.opacity).toBe(1);
    // with nowhere to come from it rises into place as it fades in
    const rise = offstage(p, null, { arriving: true });
    expect(rise.x).toBe(p.x);
    expect(rise.y).toBeGreaterThan(p.y);
    expect(rise.opacity).toBe(0);
  });

  it('takes longer to go further, within limits', () => {
    const a = { x: 0, y: 0 };
    expect(travel(a, a)).toBe(240);
    expect(travel(a, { x: 300, y: 0 })).toBeGreaterThan(travel(a, { x: 100, y: 0 }));
    expect(travel(a, { x: 5000, y: 0 })).toBe(520);
  });

  it('drops a card dragged along the hand into the nearest slot', () => {
    const spots = fan(ids(5), HAND, 60);
    expect(landing(spots, spots[3].x + 4)).toBe(3);
    expect(landing(spots, -1000)).toBe(0);
    expect(landing(spots, 5000)).toBe(4);
  });
});
