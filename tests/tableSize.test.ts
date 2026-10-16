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
  return size.fitSizes({
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
  });
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

  it('packs melds into fewer rows when the cards are smaller', () => {
    const units = [3, 4.2, 2.5, 5];
    const labels = [40, 40, 40, 40];
    const at = (cw: number) => size.packedHeight(units, labels, cw, 600, 16, { gap: 10, pad: 18, extra: 32 });
    expect(at(30)).toBeLessThan(at(60));
  });

  it('puts the buttons beside your hand only when they don’t fit beside the middle', () => {
    expect(size.tallActions({ mainH: 300, buttons: 2, menu: false, track: false, handDone: false })).toBe(false);
    expect(size.tallActions({ mainH: 180, buttons: 4, menu: true, track: false, handDone: false })).toBe(true);
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
