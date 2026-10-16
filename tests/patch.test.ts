import { describe, expect, it } from 'vitest';
import { apply, diff } from '../src/net/patch';

describe('view patches', () => {
  const cases: [string, unknown, unknown][] = [
    ['a changed value', { a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }],
    ['a new and a gone key', { a: 1, b: 2 }, { a: 1, c: 3 }],
    ['a list grown at the end', { log: [1, 2] }, { log: [1, 2, 3] }],
    ['a list trimmed from the front and grown', { log: [{ t: 'a' }, { t: 'b' }, { t: 'c' }] }, { log: [{ t: 'b' }, { t: 'c' }, { t: 'd' }] }],
    ['a list cut short', { cards: [1, 2, 3] }, { cards: [1] }],
    ['null to an object and back', { s: null }, { s: { x: [1] } }],
    ['the whole thing replaced', [1, 2], { a: 1 }],
    ['a key set to undefined is gone, as in JSON', { a: 1, up: true }, { a: 1, up: undefined }],
  ];
  it.each(cases)('rebuilds the next view exactly, over the wire: %s', (_, a, b) => {
    const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x));
    expect(wire(apply(wire(a), wire(diff(a, b))))).toEqual(wire(b));
  });

  it('sends a front-trimmed log as a trim and one new line, not every line again', () => {
    const a = { log: Array.from({ length: 40 }, (_, i) => ({ text: `move ${i}` })) };
    const b = { log: [...a.log.slice(1), { text: 'move 40' }] };
    const ops = diff(a, b);
    expect(ops).toEqual([
      ['t', ['log'], 1],
      ['s', ['log', 39], { text: 'move 40' }],
    ]);
  });

  it('never changes the view it was given', () => {
    const a = { x: [1, 2] };
    apply(a, [['s', ['x', 0], 9]]);
    expect(a).toEqual({ x: [1, 2] });
  });

  it('refuses operations that would reach outside the view or make no sense', () => {
    expect(apply({ a: 1 }, [['s', ['__proto__', 'polluted'], 1]])).toBeNull();
    expect(apply({ a: 1 }, [['s', ['b', 'c'], 1]])).toBeNull();
    expect(apply({ a: 1 }, [['x', ['a'], 1]])).toBeNull();
    expect(apply({ a: 1 }, 'nope')).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
