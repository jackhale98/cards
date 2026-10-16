import { describe, expect, it } from 'vitest';
import type { GameModule, GameState, ZoneState } from '../src/engine/types';
import { FULL_HAND } from '../src/ui/layout';
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

function sizes(m: Moment, screen: (typeof SCREENS)[keyof typeof SCREENS], vh = screen.vh) {
  const middle: size.Middle = {
    zones: m.center,
    mainW: screen.mainW,
    vw: screen.vw,
    gridded: size.isGridded(m.center),
    cross: size.isGridded(m.center) && !screen.side,
    rowFit: size.rowFit(m.center, screen.mainW, screen.side),
  };
  const pileOnly = false;
  return size.cardSizes({
    vw: screen.vw,
    vh,
    display: false,
    handMode: false,
    side: screen.side && vh <= 500,
    headerH: screen.headerH,
    headH: screen.headH,
    meOwnH: screen.meOwnH,
    headline: true,
    middle,
    strips: m.hasStrip,
    stripScale: Math.max(0, ...m.strip.map((z) => z.scale ?? 1)),
    pileOnly,
    handEmpty: false,
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
