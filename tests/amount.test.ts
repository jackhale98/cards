import { describe, expect, it } from 'vitest';
import { parseTyped, quickAdds, sliderToValue, snap, valueToSlider, SLIDER_STEPS } from '../src/ui/amount';

const bet = { min: 20, max: 990, step: 5, default: 20 };

describe('bet amounts', () => {
  it('snaps to the step grid but always allows all in', () => {
    expect(snap(37, bet)).toBe(35);
    expect(snap(38, bet)).toBe(40);
    expect(snap(5, bet)).toBe(20);
    expect(snap(989, bet)).toBe(990);
    expect(snap(5000, bet)).toBe(990);
  });

  it('accepts typed amounts and explains bad ones', () => {
    expect(parseTyped('60', bet)).toEqual({ value: 60 });
    expect(parseTyped('47', bet)).toEqual({ value: 47 }); // typed amounts aren't rounded to the step
    expect(parseTyped('1,000', { ...bet, max: 2000 })).toEqual({ value: 1000 });
    expect(parseTyped('7', bet)).toEqual({ error: 'Minimum 20' });
    expect(parseTyped('5000', bet)).toEqual({ error: 'Maximum 990' });
    expect(parseTyped('', bet)).toEqual({ error: 'Enter an amount' });
  });

  it('uses a curved slider so low bets are easy to pick', () => {
    // the first quarter of the slider covers only a small slice of the range
    expect(sliderToValue(SLIDER_STEPS / 4, bet)).toBeLessThan(60);
    expect(sliderToValue(0, bet)).toBe(20);
    expect(sliderToValue(SLIDER_STEPS, bet)).toBe(990);
    for (const v of [20, 100, 500, 990]) expect(Math.abs(sliderToValue(valueToSlider(v, bet), bet) - v)).toBeLessThanOrEqual(5);
    // narrow ranges stay linear
    const small = { min: 1, max: 20, step: 1, default: 1 };
    expect(sliderToValue(SLIDER_STEPS / 2, small)).toBe(11);
  });

  it('offers quick adds that fit the range', () => {
    expect(quickAdds(bet)).toEqual([50, 100, 250]);
    expect(quickAdds({ min: 2, max: 40, step: 1, default: 2 })).toEqual([1, 5, 10]);
  });
});
