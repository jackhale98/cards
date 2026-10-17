import { fanGap } from '../src/ui/layout/fan';
import { describe, expect, it } from 'vitest';
import type { GameModule, GameState, ZoneState } from '../src/engine/types';
import { FULL_HAND, layoutZone, type Where } from '../src/ui/layout';
import * as size from '../src/ui/layout/table';
import { GAME_LIST } from './games';

/**
 * The table's sizes (src/ui/layout/table.ts) for every game, dealt and a little way in, at the
 * sizes the screen audit uses: what the middle shows, and how big its cards and your hand are.
 */

/** Play on with bots for `moves` moves (system steps run at once). */
function playOn(g: GameModule, s: GameState, moves: number) {
  for (let step = 0, done = 0; step < moves * 4 && done < moves; step++) {
    const sys = g.system?.(s);
    if (sys) {
      sys.run(s);
      continue;
    }
    const seat = s.players.find((p) => g.bot?.(s, p.seat));
    if (!seat) return;
    g.apply(s, seat.seat, g.bot!(s, seat.seat)!);
    done++;
  }
}

/** A moment at a table: the middle's zones and the strip's, as the table shows them. */
interface Moment {
  game: string;
  at: string;
  center: ZoneState[];
  strip: ZoneState[];
  hasStrip: boolean;
}
function momentOf(game: string, at: string, s: GameState): Moment {
  const zones = Object.values(s.zones);
  const shown = (z: ZoneState) => !(z.hideEmpty && !z.cards.length);
  return {
    game,
    at,
    center: zones.filter((z) => z.area === 'center' && shown(z)),
    strip: zones.filter((z) => z.area === 'strip' && shown(z)),
    hasStrip: zones.some((z) => z.area === 'strip'),
  };
}
const MOMENTS: Moment[] = GAME_LIST.filter((g) => g.config.id !== 'freetable' && g.bot).flatMap((g) => {
  const n = g.config.players.recommended ?? Math.max(g.config.players.min, Math.min(4, g.config.players.max));
  const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
  const s = g.setup(players, 11, {});
  const dealt = momentOf(g.config.id, 'dealt', structuredClone(s));
  playOn(g, s, 24);
  return [dealt, momentOf(g.config.id, 'played', s)];
});

/** The screens: a small phone held sideways with the browser's bars, a laptop. (Chrome as measured there.) */
const SCREENS = {
  phone: { vw: 667, vh: 320, headerH: 52, headH: 26, meOwnH: 58, side: true, mainW: 667 - 120 - 140 },
  laptop: { vw: 1280, vh: 800, headerH: 64, headH: 30, meOwnH: 70, side: false, mainW: 1280 - 170 - 170 },
};

/** Labels as the page draws them, near enough: 7px a letter, 14px a line. */
const LABELS: size.Labels = { lineH: 14, width: (t) => t.length * 7 };
const where = (cw: number): Where => ({ cw, you: 0, players: 4, style: 'middle', maxW: 600 });

type Screen = (typeof SCREENS)[keyof typeof SCREENS];
/** How tall a moment's middle stands at card width `cw` on `screen`. */
function middleOf(m: Moment, screen: Screen) {
  const rowFit = size.rowFit(m.center, screen.mainW, screen.side);
  return (cw: number) =>
    size.middleHeight({
      zones: m.center,
      cwOf: (z) => size.slotCw(z, { centerCw: cw, mainW: screen.mainW, rowFit, display: false }),
      whereOf: (_z, zcw) => ({ ...where(zcw), maxW: screen.mainW - 4 }),
      mainW: screen.mainW,
      vw: screen.vw,
      rem: 16,
      labels: LABELS,
      cross: size.isGridded(m.center) && !screen.side,
      rowFit: rowFit < Infinity,
    });
}
/** The table's sizes for a moment on a screen (`vh`: a taller one). */
function sizes(m: Moment, screen: Screen, vh = screen.vh) {
  return size.fitSizes(sizesInput(m, screen, vh));
}
function sizesInput(m: Moment, screen: Screen, vh = screen.vh): size.FitInput {
  return {
    vw: screen.vw,
    vh,
    side: screen.side && vh <= 500,
    handMode: false,
    tableH: vh - 10,
    headerH: screen.headerH,
    headH: screen.headH,
    headlineAbove: !(screen.side && vh <= 500),
    meOwnH: screen.meOwnH,
    belowH: 0,
    middle: middleOf(m, screen),
    hasMiddle: m.center.length > 0,
    pileOnly: false,
    handEmpty: false,
    big: false,
    rowFit: size.rowFit(m.center, screen.mainW, screen.side) < Infinity,
    pileLabelH: 20,
    stripShown: false,
  };
}

describe('the table’s sizes', () => {
  it('has a moment of every game to size', () => {
    expect(MOMENTS.length).toBeGreaterThan(40);
  });

  for (const [name, screen] of Object.entries(SCREENS))
    it(`on a ${name}: the middle's cards and your hand both get room, a taller screen never smaller`, () => {
      for (const m of MOMENTS) {
        const a = sizes(m, screen);
        const taller = sizes(m, screen, screen.vh + 120);
        expect(a.center, `${m.game} ${m.at}`).toBeGreaterThan(0);
        expect(a.hand, `${m.game} ${m.at}`).toBeGreaterThan(0);
        expect(taller.center, `${m.game} ${m.at}`).toBeGreaterThanOrEqual(a.center - 0.01);
      }
    });

  it('keeps a whole hand face up (a dummy) inside the middle', () => {
    for (const m of MOMENTS)
      for (const z of m.center.filter((x) => x.faceUpHand))
        for (const screen of Object.values(SCREENS)) {
          const cw = size.slotCw(z, { centerCw: 200, mainW: screen.mainW, rowFit: Infinity, display: false });
          expect(cw * FULL_HAND).toBeLessThanOrEqual(screen.mainW);
        }
  });

  it('packs everyone’s melds into rows that stand lower when the cards are smaller', () => {
    const melds = (i: number): ZoneState =>
      ({
        id: `melds:${i}`,
        label: `P${i}`,
        visibility: 'all',
        layout: 'spread',
        area: 'strip',
        cards: [3, 4, 5, 6].map((r) => ({ id: `${r}H`, group: 0 })),
      }) as ZoneState;
    const zones = [0, 1, 2, 3].map(melds);
    const at = (cw: number) =>
      size.panelsHeight(
        zones,
        () => cw,
        (_z, c) => ({ ...where(c), style: 'strip', maxW: Infinity }),
        { labels: LABELS, rem: 16, across: 600, gap: 10, rowGap: 10 },
      );
    expect(at(30)).toBeLessThan(at(60));
    // (one row of four panels at 30px; at 60px they wrap)
    expect(at(30)).toBeCloseTo(30 * 1.4 + 14 + 0.35 * 16 + 0.65 * 16);
  });

  it('puts the buttons beside your hand only when they don’t fit beside the middle', () => {
    expect(size.tallActions({ mainH: 300, buttons: 2, menu: false, track: false, replayHand: false })).toBe(false);
    expect(size.tallActions({ mainH: 180, buttons: 4, menu: true, track: false, replayHand: false })).toBe(true);
  });
});

describe('the middle, laid out exactly', () => {
  const pile = (id: string, label?: string): ZoneState => ({ id, label, visibility: 'all', layout: 'stack', cards: [{ id: '5C' }] }) as ZoneState;

  it('is a pile’s frame and its label (with its count) over it', () => {
    const z = pile('deck', 'Stock');
    const h = size.middleHeight({
      zones: [z],
      cwOf: () => 60,
      whereOf: (_z, cw) => where(cw),
      mainW: 600,
      vw: 800,
      rem: 16,
      labels: LABELS,
      cross: false,
      rowFit: false,
    });
    expect(h).toBeCloseTo(layoutZone(z, where(60)).h + 14 + 0.35 * 16);
    expect(size.labelLines(z)).toEqual(['Stock · 1']);
  });

  it('in one tight row (Kings Corners on a phone), a label wraps as the page wraps it: each line measured whole', () => {
    // (as with letter spacing: a whole line measures a little less than its words one by one, and
    // that little decided a break in a wider font)
    const spaced: size.Labels = { lineH: 14, width: (t) => t.length * 7 + 6 };
    const z = { ...pile('deck', 'Stock'), cards: Array.from({ length: 20 }, (_, i) => ({ id: `?d.${i}` })) } as ZoneState;
    const h = size.middleHeight({
      zones: [z],
      // (a label at most 1.5 cards wide: 36px)
      cwOf: () => 24,
      whereOf: (_z, cw) => where(cw),
      mainW: 600,
      vw: 800,
      rem: 16,
      labels: spaced,
      cross: false,
      rowFit: true,
    });
    // "Stock" over "· 20" (34px whole, though its words add up to 40): two lines, not three
    expect(h).toBeCloseTo(layoutZone(z, where(24)).h + 2 * 0.7 * 16 * 1.15 + 0.35 * 16);
  });

  it('wraps piles that don’t fit across onto another row', () => {
    const zones = Array.from({ length: 6 }, (_, i) => pile(`p${i}`));
    const one = size.middleHeight({
      zones,
      cwOf: () => 60,
      whereOf: (_z, cw) => where(cw),
      mainW: 2000,
      vw: 800,
      rem: 16,
      labels: LABELS,
      cross: false,
      rowFit: false,
    });
    const two = size.middleHeight({
      zones,
      cwOf: () => 60,
      whereOf: (_z, cw) => where(cw),
      mainW: 250,
      vw: 800,
      rem: 16,
      labels: LABELS,
      cross: false,
      rowFit: false,
    });
    expect(one).toBeCloseTo(84);
    expect(two).toBeGreaterThan(2 * 84);
  });

  it('puts everyone’s melds on a row of their own underneath', () => {
    const melds: ZoneState = {
      id: 'melds:0',
      label: 'Ada',
      visibility: 'all',
      layout: 'spread',
      area: 'strip',
      cards: [{ id: '5C' }, { id: '5D' }, { id: '5H' }],
    } as ZoneState;
    const base = {
      zones: [pile('deck')],
      cwOf: () => 60,
      whereOf: (_z: ZoneState, cw: number) => where(cw),
      mainW: 600,
      vw: 800,
      rem: 16,
      labels: LABELS,
      cross: false,
      rowFit: false,
    };
    const without = size.middleHeight(base);
    const withStrip = size.middleHeight({
      ...base,
      strip: { zones: [melds], cwOf: () => 40, whereOf: (_z, cw) => ({ ...where(cw), style: 'strip', maxW: Infinity }), wrap: false },
    });
    // (its panel: the label, the cards, a little padding)
    expect(withStrip - without).toBeCloseTo(6 + 40 * 1.4 + 14 + 0.35 * 16 + 0.65 * 16);
  });
});

describe('the table’s height shared out exactly', () => {
  for (const [name, screen] of Object.entries(SCREENS))
    it(`on a ${name}: the middle and your hand fit under the seats, every game, when they can`, () => {
      for (const m of MOMENTS) {
        const fit = sizes(m, screen);
        const middle = middleOf(m, screen);
        const hand = size.handCw({ hand: fit.hand, handMode: false, stripShown: false, pileOnly: false });
        const used =
          screen.headerH +
          8 +
          size.handHeight(hand, { pileOnly: false, handEmpty: false, pileLabelH: 20 }) +
          middle(Math.max(34, Math.round(fit.center))) +
          (screen.side ? 0 : screen.headH + (fit.lastFits ? size.LAST_H : 0) + 6);
        // (when even the smallest cards can't fit, the middle is scaled to fit: phase 1c makes that rarer)
        if (fit.center > 92 * 0.36) expect(used, `${m.game} ${m.at}`).toBeLessThanOrEqual(screen.vh - 10 + 0.5);
      }
    });
});

describe('the last move’s line', () => {
  it('when it wraps onto two lines, the middle and your hand make room for both', () => {
    // (the headline's over the middle: not a phone on its side, where it's in the column)
    const screen = SCREENS.laptop;
    let gave = 0;
    for (const m of MOMENTS) {
      const one = sizes(m, screen);
      const two = size.fitSizes({ ...sizesInput(m, screen), lastH: 40 });
      if (!one.lastFits || !two.lastFits) continue;
      // (a taller line: never bigger cards, and smaller ones whenever the room was already tight)
      expect(two.center + two.hand, `${m.game} ${m.at}`).toBeLessThanOrEqual(one.center + one.hand);
      // (the same cards: less room left over; smaller ones may leave a little more, what's less than a step)
      if (two.center + two.hand === one.center + one.hand) expect(two.spare, `${m.game} ${m.at}`).toBeLessThanOrEqual(one.spare);
      if (two.center + two.hand < one.center + one.hand || two.spare < one.spare) gave++;
    }
    expect(gave).toBeGreaterThan(0);
  });
});

describe('a tall screen', () => {
  it('gives the height your hand has no use for to the middle’s cards, as far as it fits, never past your hand’s size', () => {
    // (a tablet: 1180 × 820, the middle a trick)
    const screen = { ...SCREENS.laptop, vw: 1180, vh: 820, mainW: 1180 - 170 - 170 };
    const m = MOMENTS.find((x) => x.game === 'hearts' && x.at !== 'dealt')!;
    const fit = sizes(m, screen);
    // (what the middle asks for on its own: 92px)
    expect(fit.center).toBeGreaterThan(92);
    expect(fit.center).toBeLessThanOrEqual(size.handCw({ hand: fit.hand, handMode: false, stripShown: false, pileOnly: false }));
    expect(fit.fits).toBe(true);
    // (a phone's spare height is a few pixels: its cards stay as they were)
    expect(sizes(m, SCREENS.phone).center).toBeLessThanOrEqual(92);
  });
});

describe('your hand, to tap', () => {
  it('its cards grow only as far as leaves each one a strip to tap, never under the smallest hand', () => {
    const m = MOMENTS[0];
    const free = size.fitSizes(sizesInput(m, SCREENS.laptop));
    const cw = (h: number) => size.handCw({ hand: h, handMode: false, stripShown: false, pileOnly: false });
    for (const [n, width] of [
      [8, 900],
      [13, 520],
      [18, 460],
      [26, 300],
    ]) {
      const fit = size.fitSizes({ ...sizesInput(m, SCREENS.laptop), fan: { n, width: () => width } });
      expect(fit.hand, `${n} in ${width}`).toBeLessThanOrEqual(free.hand);
      const gap = fanGap(n, width, cw(fit.hand));
      // (a strip to tap, or the smallest hand there is: a long hand on a narrow screen)
      expect(gap >= size.TOUCH || cw(fit.hand) === cw(0), `${n} in ${width}: ${gap}px at ${cw(fit.hand)}`).toBe(true);
    }
    // (a few cards with room to spare: as big as before)
    expect(size.fitSizes({ ...sizesInput(m, SCREENS.laptop), fan: { n: 5, width: () => 1000 } }).hand).toBe(free.hand);
  });

  it('the buttons count a Replay hand button only when there is one (no result panel offering it)', () => {
    expect(size.tallActions({ mainH: 98, buttons: 1, menu: false, track: false, replayHand: false })).toBe(false);
    expect(size.tallActions({ mainH: 98, buttons: 1, menu: false, track: false, replayHand: true })).toBe(true);
  });
});
