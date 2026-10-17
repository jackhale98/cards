import { describe, expect, it } from 'vitest';
import type { ActionSpec, ZoneState } from '../src/engine/types';
import { afterSwipe, afterTap, picking, zoneActionOf } from '../src/ui/table/selection.svelte';
import { freshAfter } from '../src/ui/table/fresh';
import { announceText, lastMoveOf, recapOf, soundFor } from '../src/ui/table/events';
import { keptRoomAfter, middleZones, playFromOf, showdownZones, stripOrder, stripZonesOf } from '../src/ui/table/shown';
import { RaceClock } from '../src/ui/table/race';
import { ovalSeat } from '../src/ui/layout/table';

const card = (id: string) => ({ id });
const zone = (id: string, cards: string[], more: Partial<ZoneState> = {}): ZoneState => ({
  id,
  visibility: 'all',
  layout: 'stack',
  area: 'center',
  cards: cards.map(card),
  ...more,
});
const play = (cards: string[], max = 1, quick: ActionSpec['quick'] = true): ActionSpec => ({
  type: 'play',
  label: 'Play',
  select: { min: 1, max, cards },
  quick,
});

describe('picking cards', () => {
  it('a tap picks a card, a second tap on it plays it, and one that can’t be picked does nothing', () => {
    const p = picking([play(['7H', '8H'])]);
    expect(afterTap([], '7H', p)).toEqual({ selected: ['7H'] });
    expect(afterTap(['7H'], '7H', p)).toEqual({ play: p.quick });
    expect(afterTap(['7H'], '8H', p)).toEqual({ selected: ['8H'] });
    expect(afterTap([], '2C', p)).toBeNull();
  });

  it('several cards up to the most an action takes; a second tap puts one back when the action is swipe-only', () => {
    const p = picking([play(['2C', '3C', '4C'], 2, 'swipe')]);
    expect(afterTap(['2C'], '3C', p)).toEqual({ selected: ['2C', '3C'] });
    expect(afterTap(['2C', '3C'], '4C', p)).toEqual({ selected: ['2C', '3C'] });
    expect(afterTap(['2C'], '2C', p)).toEqual({ selected: [] });
  });

  it('a swipe plays the card with those picked along with it, or a tap when there’s no quick move', () => {
    const p = picking([play(['2C', '3C', '4C'], 2)]);
    expect(afterSwipe(['2C', '3C'], '3C', p)).toEqual({ play: p.quick, cards: ['2C', '3C'] });
    expect(afterSwipe(['2C'], '4C', p)).toEqual({ play: p.quick, cards: ['4C'] });
    expect(afterSwipe([], '4C', picking([{ ...play(['4C']), quick: undefined }]))).toBe('tap');
  });

  it('tapping a pile does its action, and one that takes cards only with the right ones picked', () => {
    const draw: ActionSpec = { type: 'draw', label: 'Draw', zone: 'deck' };
    const put: ActionSpec = { type: 'put', label: 'Put', zone: 'pile:1', select: { min: 1, max: 1, cards: ['KH'] } };
    expect(zoneActionOf([draw, put], 'deck', [])).toBe(draw);
    expect(zoneActionOf([draw, put], 'pile:1', [])).toBeUndefined();
    expect(zoneActionOf([draw, put], 'pile:1', ['KH'])).toBe(put);
    expect(zoneActionOf([draw, put], 'pile:1', ['QH'])).toBeUndefined();
  });
});

describe('cards just come into your hand', () => {
  const none = () => false;
  it('are marked until you act; a new deal isn’t', () => {
    expect(freshAfter(['2C', '3C'], ['2C', '3C', '9H'], [], none)).toEqual(['9H']);
    expect(freshAfter(['2C', '3C', '9H'], ['2C', '9H'], ['9H'], none)).toEqual(['9H']);
    expect(freshAfter(['2C', '3C', '9H'], ['2C', '3C'], ['9H'], none)).toEqual([]);
    expect(freshAfter(['2C', '3C'], ['4D', '5D', '6D', '7D', '8D', '2C'], [], none)).toEqual([]);
    // (the first look at the hand: nothing to compare with)
    expect(freshAfter(null, ['2C'], [], none)).toEqual([]);
  });
  it('a card you can’t see isn’t marked', () => {
    expect(freshAfter(['2C'], ['2C', '?1'], [], (id) => id.startsWith('?'))).toEqual([]);
  });
});

describe('what the table says', () => {
  const e = (text: string) => ({ t: 1, text });
  it('the last move, unless the headline already says it', () => {
    expect(lastMoveOf(e('Ann plays 7♥'), 'Bo to play')).toEqual(e('Ann plays 7♥'));
    expect(lastMoveOf(e('Dash wins the pot (1213) with two pair'), 'Dash wins the pot (1213)')).toBeNull();
    expect(lastMoveOf(e('Ann folds'), 'Ann folds · Bo to play')).toBeNull();
  });
  it('a screen reader hears suits as words, and when it’s your turn', () => {
    expect(announceText(e('Ann plays 7♥'), true)).toBe('Ann plays 7 hearts. Your turn.');
    expect(announceText(undefined, false)).toBe('');
  });
  it('a move’s sound: dealing, chips in a chips game, cards moving', () => {
    expect(soundFor({ text: 'Bo deals' }, false)).toBe('deal');
    expect(soundFor({ text: 'Bo raises to 40' }, true)).toBe('chips');
    expect(soundFor({ text: 'Bo raises to 40' }, false)).toBeNull();
    expect(soundFor({ text: 'Bo takes it', fromZone: 'discard' }, false)).toBe('card');
  });
  it('the hand’s summary: who made or lost what, unless the result already shows the totals', () => {
    const history = {
      names: ['Ann', 'Bo', 'Cy'],
      totals: [
        [0, 0, 0],
        [40, -1200, 0],
      ],
    };
    expect(recapOf(history, undefined)).toBe(`Ann +40 · Bo −${(1200).toLocaleString()}`);
    expect(recapOf(history, ['Ann 0 → 40'])).toBeNull();
    expect(recapOf({ names: ['Ann'], totals: [[0], [0]] }, undefined)).toBeNull();
  });
});

describe('which zones show where', () => {
  it('hands turned over at a showdown go in the middle, labelled, with the cards of the zones they name', () => {
    const zones = { 'hand:1': zone('hand:1', ['AS', 'AH']) };
    const [z] = showdownZones([{ seat: 1, label: 'Bo · two aces', zones: ['hand:1'] }], zones);
    expect(z).toMatchObject({ id: 'showdown:1', owner: 1, label: 'Bo · two aces', layout: 'spread', area: 'center' });
    expect(z.cards.map((c) => c.id)).toEqual(['AS', 'AH']);
    expect(showdownZones([{ seat: 2, label: 'Cy', zones: ['hand:2'] }], zones)).toEqual([]);
  });
  it('a dummy keeps its room once it has emptied, until the middle is clear', () => {
    const dummy = (cards: string[], trick: string[]) => ({
      dummy: zone('dummy', cards, { faceUpHand: true, hideEmpty: true }),
      trick: zone('trick', trick, { layout: 'trick' }),
    });
    let kept = keptRoomAfter([], dummy(['2C'], []));
    expect(kept).toEqual(['dummy']);
    kept = keptRoomAfter(kept, dummy([], ['2C']));
    expect(kept).toEqual(['dummy']);
    expect(middleZones(dummy([], ['2C']), kept, []).map((z) => z.id)).toEqual(['dummy', 'trick']);
    expect(middleZones(dummy([], ['2C']), [], []).map((z) => z.id)).toEqual(['trick']);
    expect(keptRoomAfter(kept, dummy([], []))).toEqual([]);
  });
  it('the strip: yours to play from first, then yours, then everyone’s from your left; none on show at a showdown', () => {
    const melds = [0, 1, 2, 3].map((p) => zone(`melds:${p}`, ['2C'], { area: 'strip', owner: p }));
    const order = (you: number, usable = (_z: ZoneState) => false) => stripOrder(melds, usable, you, 4).map((z) => z.owner);
    expect(order(2)).toEqual([2, 3, 0, 1]);
    expect(order(2, (z) => z.owner === 0)).toEqual([0, 2, 3, 1]);
    const all = Object.fromEntries(melds.map((z) => [z.id, z]));
    expect(stripZonesOf(all, new Set(['melds:1'])).map((z) => z.owner)).toEqual([0, 2, 3]);
  });
  it('the dummy you play from is the face-up hand with a card you can pick', () => {
    const d = zone('dummy', ['2C'], { faceUpHand: true });
    expect(playFromOf([d], new Set(['2C']))).toBe(d);
    expect(playFromOf([d], new Set(['3C']))).toBeNull();
  });
});

describe('a reaction’s time', () => {
  it('counts from when the race was drawn on screen, not when it arrived', () => {
    let now = 1000;
    const clock = new RaceClock(() => now);
    let painted = () => {};
    clock.saw(3, (f) => (painted = f));
    now = 1050;
    painted();
    now = 1300;
    expect(clock.timing(3)).toEqual({ race: 3, rt: 250 });
    // (the same race seen again doesn't restart the clock)
    clock.saw(3, (f) => f());
    expect(clock.timing(3)).toEqual({ race: 3, rt: 250 });
    expect(clock.timing(undefined)).toEqual({});
  });
});

describe('a table screen’s seats', () => {
  it('go round an oval from the bottom, kept clear of the edges by their size', () => {
    expect(ovalSeat(0, 4, 100, 40)).toEqual({ left: 'clamp(58px, 50%, calc(100% - 58px))', top: 'clamp(28px, 89%, calc(100% - 28px))' });
    expect(ovalSeat(1, 4).left).toBe('clamp(8px, 10%, calc(100% - 8px))');
  });
});
