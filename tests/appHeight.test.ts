import { describe, expect, it } from 'vitest';
import { fullHeight, heightKeeper } from '../src/ui/appHeight';

// an iPhone 16 Pro Max: 430 × 932
const phone = { screenW: 430, screenH: 932 };

describe('the app’s height on a Home Screen iPhone', () => {
  it('a page shorter than the screen is made as tall as the screen, held either way', () => {
    expect(fullHeight({ standalone: true, innerW: 430, innerH: 870, ...phone })).toBe(932);
    expect(fullHeight({ standalone: true, innerW: 932, innerH: 380, ...phone })).toBe(430);
  });

  it('a page already the screen’s height is left alone', () => {
    expect(fullHeight({ standalone: true, innerW: 430, innerH: 932, ...phone })).toBeNull();
  });

  it('a browser tab keeps its own height (its toolbars take the rest)', () => {
    expect(fullHeight({ innerW: 430, innerH: 780, ...phone })).toBeNull();
    expect(fullHeight({ standalone: false, innerW: 430, innerH: 780, ...phone })).toBeNull();
  });

  it('an iPad app in a window beside another keeps its own height', () => {
    expect(fullHeight({ standalone: true, innerW: 507, innerH: 1000, screenW: 1024, screenH: 1366 })).toBeNull();
  });

  it('stretched, a page iOS then reports as full height stays stretched: no flicking between the two', () => {
    const keep = heightKeeper();
    expect(keep({ standalone: true, innerW: 430, innerH: 870, ...phone })).toBe(932);
    // (the stretch taken, iOS now says the page is the screen's height)
    expect(keep({ standalone: true, innerW: 430, innerH: 932, ...phone })).toBe(932);
    expect(keep({ standalone: true, innerW: 430, innerH: 870, ...phone })).toBe(932);
    // turned: decided afresh for the new way round
    expect(keep({ standalone: true, innerW: 932, innerH: 430, ...phone })).toBeNull();
  });
});
