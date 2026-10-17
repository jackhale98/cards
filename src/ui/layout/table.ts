import type { ZoneState } from '../../engine/types';
import { layoutZone, type Where } from './index';
import { fanHeight } from './fan';
import { FULL_HAND } from './spread';

/**
 * How big the table's cards are: the middle's, your hand's, the strip's (everyone's melds), the
 * full-screen melds'. Pure: the screen, what's measured once (the seats' bar, the headline, your
 * column) and the zones in, sizes out. (See docs/ARCHITECTURE_PLAN.md, phase 1: this is where the
 * table's sizing lives; the zones' own layouts, in this folder, say how big a zone is at a size.)
 */

/** No card on the table narrower than this: below it the corner's rank and suit can't be read. */
export const MIN_CW = 30;
/** The last move's line under the headline (px, with the gap over it), until it's been measured. */
export const LAST_H = 26;

/** Piles with places on the table (Kings Corners' cross). */
export const isGridded = (zones: ZoneState[]) => zones.length > 1 && zones.every((z) => z.grid);

/** One row of placed piles on a phone on its side: the widest card that lets them all fit across (with a little over for a wider label). */
export function rowFit(zones: ZoneState[], mainW: number, side: boolean): number {
  return isGridded(zones) && side && mainW ? Math.floor((mainW - (zones.length - 1) * 6 - 30) / zones.length / 1.12) : Infinity;
}

/**
 * A table screen's cards in the middle: as big as the screen suits, but no bigger than lets every
 * row of piles fit the height there is (the dummy on its row and the trick under it, say), so
 * they're drawn at their size from the start rather than shrunk to fit after.
 */
export function displayCw(i: {
  vw: number;
  vh: number;
  track: boolean;
  hasStrip: boolean;
  stripShown: boolean;
  gridded: boolean;
  middleRoom: number;
  /** How tall the middle stands at a card width (middleHeight). */
  middle: (cw: number) => number;
}): number {
  const base = Math.max(60, Math.min(300, i.vh * (i.track ? 0.18 : i.hasStrip ? 0.14 : 0.22), i.vw * (i.hasStrip ? 0.07 : 0.1)));
  if (!i.middleRoom || i.gridded || i.stripShown) return base;
  let cw = base;
  while (cw > 60 && i.middle(cw) > i.middleRoom) cw -= 2;
  return cw;
}

/**
 * Whether the middle's cards fit across side by side (a Hold'em board on a tablet): then a row
 * of five or more needn't overlap. Piles about a card wide; a row of cards a card and a bit each.
 */
export function roomy(zones: ZoneState[], centerCw: number, mainW: number, vw: number, stripShown: boolean): boolean {
  if (!mainW || stripShown) return false;
  const gap = Math.min(32, Math.max(10, vw * 0.03));
  const width = zones.reduce((w, z) => {
    const cw = centerCw * (z.scale ?? 1);
    return w + gap + (z.layout === 'spread' ? (z.faceUpHand ? 13 : z.cards.length) * cw * 1.1 : z.layout === 'trick' ? 3 * cw : 1.2 * cw);
  }, 0);
  return width < mainW - 16;
}

/**
 * Each middle zone's card size. A whole hand face up (bridge's dummy) keeps its thirteen cards'
 * width all hand (its slot holds that much, so it never shares a row with the trick as it
 * empties): no wider than the middle.
 */
export function slotCw(z: ZoneState, i: { centerCw: number; mainW: number; rowFit: number; display: boolean }): number {
  const fit = z.faceUpHand && i.mainW ? Math.floor((i.mainW - 16) / FULL_HAND) : Infinity;
  const size = Math.round(i.centerCw * (z.scale ?? 1) * (z.layout === 'spread' && (z.faceUpHand || z.cards.length >= 10) && !i.display ? 0.82 : 1));
  return Math.max(MIN_CW, Math.min(i.rowFit, fit, size));
}

/** A strip zone's card size: its scale of the middle's, and on a table screen no bigger than its melds fit. */
export function stripCw(z: { scale?: number }, i: { centerCw: number; display: boolean; kept: number }): number {
  return Math.max(MIN_CW, Math.min(Math.round(i.centerCw * (z.scale ?? 1)), i.display ? i.kept : Infinity));
}

/**
 * A table screen's strip (everyone's melds): it can't scroll, so it wraps into rows across the
 * middle (a little wider than it: lower down, the oval is wider), with the biggest cards that let
 * every set of melds pack into the height left. (Each panel laid out by its own layout.)
 */
export function stripFit(i: {
  display: boolean;
  zones: ZoneState[];
  mainW: number;
  mainH: number;
  rem: number;
  vw: number;
  stripSpace: number;
  centerCw: number;
  labels: Labels;
  /** How a strip zone is laid out at a card width. */
  whereOf: (z: ZoneState, cw: number) => Where;
}): number {
  if (!i.display || !i.zones.length || !i.mainW || !i.mainH) return Infinity;
  // the height left under the headline and the row of piles (and clear of the seat at the bottom)
  // (measured once it's on screen; until then, a fair guess)
  const room = i.stripSpace > 0 ? i.stripSpace : i.mainH - (i.centerCw * 1.4 + 2 * i.rem) - 5 * i.rem;
  if (room < 60) return Infinity;
  const largest = Math.round(i.centerCw * Math.max(...i.zones.map((z) => z.scale ?? 1)));
  const at = (cw: number) => (z: ZoneState) => Math.max(MIN_CW, Math.min(Math.round(i.centerCw * (z.scale ?? 1)), cw));
  for (let cw = largest; cw > MIN_CW; cw -= 2) if (stripHeight({ zones: i.zones, cwOf: at(cw), whereOf: i.whereOf, wrap: true }, i) <= room) return cw;
  return MIN_CW;
}

/**
 * Everyone's melds full screen: the biggest cards that let them all fit the room, so a few melds
 * fill the screen; only past a readable smallest size does the page scroll. (`.spread-all`: panels
 * wrapping with 10px between, each laid out by its own layout.)
 */
export function spreadCw(i: { zones: ZoneState[]; w: number; h: number; labels: Labels; whereOf: (z: ZoneState, cw: number) => Where }): number {
  if (!i.w || !i.h || !i.zones.length) return 44;
  const room = i.h - 12;
  for (let cw = Math.min(140, Math.round(room / 1.4 - 30)); cw > 40; cw -= 2)
    if (panelsHeight(i.zones, () => cw, i.whereOf, { labels: i.labels, rem: 16, across: i.w - 4, gap: 10, rowGap: 10 }) <= room) return cw;
  return 40;
}

/** Your hand's card width. */
export function handCw(i: { hand: number; handMode: boolean; stripShown: boolean; pileOnly: boolean }): number {
  return Math.round(Math.max(i.handMode && !i.stripShown ? 56 : i.pileOnly ? 36 : 44, i.hand));
}

/**
 * The buttons sit beside the middle, so your hand has the whole width; when there are more of
 * them than fit there (poker's fold, call, raise, all in on a phone) they run down beside your
 * hand as well. (Counted, not measured: where they go mustn't change how many fit.)
 */
export function tallActions(i: { mainH: number; buttons: number; menu: boolean; track: boolean; handDone: boolean }): boolean {
  if (!i.mainH) return false;
  const buttons = Math.min(i.buttons, 4) + (i.menu || i.buttons > 4 ? 1 : 0);
  const extra = (i.track ? 64 : 0) + (i.handDone ? 48 : 0);
  return buttons * 52 + extra > i.mainH;
}

// ---- the middle, exactly as the page lays it out ------------------------------------------

/** How the page draws a zone's label (`.label.eyebrow`, small capitals on one line): measured once, by the table. */
export interface Labels {
  /** One line's height (px). */
  lineH: number;
  /** A line's width (px). */
  width: (text: string) => number;
}

/** The lines a zone's label shows: a pile's count after its name; a hand shown down on two lines (who, then what). */
export function labelLines(z: ZoneState): string[] {
  if (!z.label || z.layout === 'trick') return [];
  if (z.base === 'showdown') return z.label.split(' · ');
  return [z.layout === 'stack' && !z.cascade ? `${z.label} · ${z.cards.length}` : z.label];
}

/** How many lines `text` takes wrapped at spaces within `maxW`. */
function wrapped(text: string, maxW: number, labels: Labels): number {
  const words = text.split(' ');
  const space = labels.width('a b') - labels.width('ab');
  let lines = 1;
  let w = 0;
  for (const word of words) {
    const ww = labels.width(word);
    if (w && w + space + ww > maxW) {
      lines++;
      w = ww;
    } else w += (w ? space : 0) + ww;
  }
  return lines;
}

/** A zone's box in the middle: its label over its frame, as wide as the wider. */
export function zoneBox(z: ZoneState, where: Where, labels: Labels, rem = 16, labelMinW = 0): { w: number; h: number } {
  const frame = layoutZone(z, where);
  const lines = labelLines(z);
  if (!lines.length) return { w: frame.w, h: frame.h };
  // (`.zone` stacks the label over the frame with a 0.35rem gap)
  const labelW = Math.max(labelMinW, ...lines.map((l) => labels.width(l)));
  return { w: Math.max(frame.w, labelW), h: frame.h + lines.length * labels.lineH + 0.35 * rem };
}

/** What sizes the middle's zones need, and where they sit (as the table lays them out). */
export interface MiddleShape {
  zones: ZoneState[];
  /** Each zone's card width (slotCw). */
  cwOf: (z: ZoneState) => number;
  /** How each zone is laid out at that size (layout/index.ts). */
  whereOf: (z: ZoneState, cw: number) => Where;
  mainW: number;
  vw: number;
  rem: number;
  labels: Labels;
  /** Kings Corners' piles: a cross (big screen) or one row as wide as fits (a phone). */
  cross: boolean;
  rowFit: boolean;
  /** A table screen keeps each pile's label at least this wide (its count changes all game). */
  steadyLabel?: (cw: number) => number;
  /** Other things in the middle's row beside the piles (the pot), measured. */
  extras?: { w: number; h: number }[];
  /** Everyone's melds, on a row of their own under the piles. */
  strip?: { zones: ZoneState[]; cwOf: (z: ZoneState) => number; whereOf: (z: ZoneState, cw: number) => Where; wrap: boolean } | { room: number };
}

/**
 * Kings Corners' piles in one tight row on a phone (`.zones.row-fit`): the row doesn't wrap, so
 * when the piles and their labels are wider than the middle, each pile's place shrinks (as flex
 * items do: in proportion to its width, never under its card or its longest word), and a label
 * wider than its place wraps under it, a line at a time (`.label`: at most 1.5 cards wide, 1.15 lines).
 */
function rowFitHeight(m: MiddleShape): number {
  const lineH = 0.7 * m.rem * 1.15;
  const items = m.zones.map((z) => {
    const cw = m.cwOf(z);
    const frame = layoutZone(z, m.whereOf(z, cw));
    const lines = labelLines(z);
    const longest = Math.max(0, ...lines.flatMap((l) => l.split(' ').map((w) => m.labels.width(w))));
    const label = Math.min(cw * 1.5, Math.max(0, ...lines.map((l) => m.labels.width(l))));
    return { cw, frame, lines, basis: Math.max(frame.w, label), min: Math.max(frame.w, Math.min(cw * 1.5, longest)) };
  });
  const gap = 6;
  const total = items.reduce((t, i) => t + i.basis, 0) + gap * Math.max(0, items.length - 1);
  const over = Math.max(0, total - m.mainW);
  const sum = items.reduce((t, i) => t + i.basis, 0) || 1;
  return Math.max(
    0,
    ...items.map((i) => {
      const w = Math.max(i.min, i.basis - (over * i.basis) / sum);
      const n = i.lines.reduce((t, l) => t + wrapped(l, Math.min(w, i.cw * 1.5), m.labels), 0);
      return i.frame.h + (i.lines.length ? n * lineH + 0.35 * m.rem : 0);
    }),
  );
}

/** The gap between two piles side by side in the middle (`.zones`' column gap). */
export const pileGap = (vw: number) => Math.min(32, Math.max(10, vw * 0.03));

/**
 * How tall the middle's piles stand, row by row, as the page will lay them out (`.zones`: a row
 * that wraps, or Kings Corners' cross, or one tight row), with everyone's melds on a row of their
 * own under them. From the zones' own layouts: the same sizes the page gives their frames.
 */
export function middleHeight(m: MiddleShape): number {
  if (m.rowFit && !m.cross) return rowFitHeight(m);
  const boxes = m.zones.map((z) => {
    const cw = m.cwOf(z);
    return zoneBox(z, m.whereOf(z, cw), m.labels, m.rem, m.steadyLabel?.(cw) ?? 0);
  });
  if (!m.cross) boxes.push(...(m.extras ?? []).filter((b) => b.w && b.h));
  let h: number;
  if (m.cross) {
    // a grid: each row as tall as its tallest pile, 6px between
    const rows = new Map<number, number>();
    m.zones.forEach((z, i) => rows.set(z.grid![0], Math.max(rows.get(z.grid![0]) ?? 0, boxes[i].h)));
    h = [...rows.values()].reduce((a, b) => a + b, 0) + 6 * Math.max(0, rows.size - 1);
  } else {
    // a row that wraps: piles side by side with a gap, 8px between rows
    const gap = pileGap(m.vw);
    let rowW = 0;
    let rowH = 0;
    h = 0;
    let rows = 0;
    for (const b of boxes) {
      if (rowW && rowW + gap + b.w > m.mainW) {
        h += rowH;
        rows++;
        rowW = 0;
        rowH = 0;
      }
      rowW += (rowW ? gap : 0) + b.w;
      rowH = Math.max(rowH, b.h);
    }
    if (boxes.length) {
      h += rowH;
      rows++;
    }
    h += 8 * Math.max(0, rows - 1);
  }
  if (m.strip) {
    const strip = 'room' in m.strip ? m.strip.room : stripHeight(m.strip, m);
    // (the strip is a row of its own, 6px under the piles)
    h += (h ? 6 : 0) + strip;
  }
  return h;
}

/**
 * How tall the strip stands: each player's melds on a panel (a label over the cards, a little
 * padding), the panels in one row that scrolls sideways, or on a table screen wrapping into rows
 * across the middle (a little wider than it: the oval is wider lower down).
 */
export function stripHeight(
  s: { zones: ZoneState[]; cwOf: (z: ZoneState) => number; whereOf: (z: ZoneState, cw: number) => Where; wrap: boolean },
  m: { mainW: number; vw: number; rem: number; labels: Labels },
): number {
  return panelsHeight(s.zones, s.cwOf, s.whereOf, {
    labels: m.labels,
    rem: m.rem,
    across: s.wrap ? m.mainW * 1.2 : Infinity,
    gap: Math.min(24, Math.max(10, m.vw * 0.025)),
    rowGap: 0.6 * m.rem,
  });
}

/**
 * How tall a set of panels stands (each zone's label over its cards, with a little padding:
 * `.strip > .zone`, `.spread-all > .zone`), packed into rows `across` wide (Infinity: one row).
 */
export function panelsHeight(
  zones: ZoneState[],
  cwOf: (z: ZoneState) => number,
  whereOf: (z: ZoneState, cw: number) => Where,
  o: { labels: Labels; rem: number; across: number; gap: number; rowGap: number },
): number {
  const panels = zones.map((z) => {
    const b = zoneBox(z, whereOf(z, cwOf(z)), o.labels, o.rem);
    // (padding 0.25rem 0.5rem 0.4rem)
    return { w: b.w + o.rem, h: b.h + 0.65 * o.rem };
  });
  let h = 0;
  let rowW = 0;
  let rowH = 0;
  let rows = 0;
  for (const p of panels) {
    if (rowW && rowW + o.gap + p.w > o.across) {
      h += rowH;
      rows++;
      rowW = 0;
      rowH = 0;
    }
    rowW += (rowW ? o.gap : 0) + p.w;
    rowH = Math.max(rowH, p.h);
  }
  if (panels.length) {
    h += rowH;
    rows++;
  }
  return h + o.rowGap * Math.max(0, rows - 1);
}

// ---- the table's height shared out, exactly ---------------------------------------------

export interface FitInput {
  vw: number;
  vh: number;
  /** A table screen: the middle's size is its own (displayCw), and there's no hand. */
  display?: boolean;
  /** A phone on its side: whose turn it is goes in the column on the left. */
  side: boolean;
  handMode: boolean;
  /** The table's own height (inside its padding), and the seats' bar. */
  tableH: number;
  headerH: number;
  /** Whose turn it is (the headline, measured), and whether it's over the middle (not in the column on the left). */
  headH: number;
  headlineAbove: boolean;
  /** The last move's line, measured when last shown (it can wrap onto two lines). */
  lastH?: number;
  /** Your own part of the column (name, chips), on a phone on its side… */
  meOwnH: number;
  /** …and the hand's summary there too, at a hand's end (it shows there when the column has room). */
  sideRecapH?: number;
  /** A whole hand face up in the middle (the dummy) grows into height that's spare: leave it there, not to your hand. */
  growing?: boolean;
  /** Under the middle's piles (the hand's summary). */
  belowH: number;
  /** The middle at a given card size (its zones' card widths follow from it: see slotCw). */
  middle: (centerCw: number) => number;
  /** There are zones in the middle at all. */
  hasMiddle: boolean;
  /** Your own face-down pile (slap games) instead of a hand; your hand empty at a hand's end. */
  pileOnly: boolean;
  handEmpty: boolean;
  /** Something big to watch in the middle (a pile or two and nothing else, or everything laid down). */
  big: boolean;
  /** The piles are one row as wide as fits (Kings Corners on a phone): they can't use more height. */
  rowFit: boolean;
  /** Your face-down pile's label (its height over the pile). */
  pileLabelH: number;
  /** Everyone's melds are on the table: your hand keeps its smallest size for them. */
  stripShown: boolean;
  /** Something else in your hand's row (the buttons, beside it): the row is at least this tall. */
  bottomMinH?: number;
}

/** Between the table's rows (seats, middle, hand) and between what's stacked in the middle. */
const ROW_GAP = 4;
const MAIN_GAP = 6;
/** Over the last move's line: the middle's gap, less the line's -2px margin. */
const LAST_GAP = MAIN_GAP - 2;

/** How tall your hand stands at card width `cw`: a fan (its arc and a picked card's rise), or your own pile with its label. */
export function handHeight(cw: number, i: Pick<FitInput, 'pileOnly' | 'handEmpty' | 'pileLabelH'>): number {
  if (i.handEmpty || !cw) return 0;
  return i.pileOnly ? cw * 1.4 + i.pileLabelH : fanHeight(cw);
}

/**
 * The table's height shared out between the middle's cards and your hand: the largest share of
 * what each would like that lets the middle (laid out exactly as the page will: middleHeight)
 * and your hand fit under the seats, both shrinking together. The last move's line under the
 * headline gives its room first if they still don't fit. Any height left over goes to your hand.
 */
export function fitSizes(i: FitInput): { center: number; hand: number; lastFits: boolean; spare: number; fits: boolean } {
  const wantCenter = Math.min(i.big ? 120 : 92, i.vh * (i.big ? 0.24 : 0.15), i.vw * (i.big ? 0.12 : 0.09));
  const wantHand = i.handEmpty
    ? 0
    : i.handMode
      ? Math.min(168, i.vh * (i.hasMiddle ? 0.27 : 0.34), i.vw * 0.15)
      : Math.min(112, i.vh * (i.pileOnly ? 0.14 : 0.2), i.vw * 0.11);
  if (i.display) return { center: wantCenter, hand: wantHand, lastFits: true, spare: 0, fits: true };
  const handOf = (h: number) => (i.handEmpty ? 0 : handCw({ hand: h, handMode: i.handMode, stripShown: i.stripShown, pileOnly: i.pileOnly }));
  // the room left for the middle's piles, with your hand at `hand` and the last move's line or not
  const room = (hand: number, last: boolean) => {
    const main = i.tableH - i.headerH - 2 * ROW_GAP - Math.max(handHeight(handOf(hand), i), i.bottomMinH ?? 0);
    const above = i.headlineAbove ? i.headH + (last ? (i.lastH ? i.lastH + LAST_GAP : LAST_H) : 0) + MAIN_GAP : 0;
    const below = i.belowH ? i.belowH + MAIN_GAP : 0;
    return main - above - below;
  };
  const fits = (k: number, last: boolean) => i.middle(Math.max(34, Math.round(wantCenter * k))) <= room(wantHand * k, last);
  let lastFits = i.headlineAbove;
  let k = 1;
  while (k > 0.35 && !fits(k, lastFits)) k -= 0.02;
  // still too tall at the smallest sizes: the last move's line gives its room to the cards
  if (lastFits && !fits(k, true)) {
    lastFits = false;
    while (k < 1 && fits(k + 0.02, false)) k += 0.02;
  }
  if (!i.headlineAbove) lastFits = i.side;
  const center = wantCenter * k;
  let hand = wantHand * k;
  const spare = Math.max(0, room(hand, lastFits) - i.middle(Math.max(34, Math.round(center))));
  // room left over once everything fits (a small middle, a short hand): most of it to your hand,
  // up to a ceiling (not when the piles are one row as wide as fits: the hand needn't be bigger
  // than the piles it's played onto)
  if (k >= 1 && wantHand && !i.handMode && !i.rowFit && !i.growing && spare > 0)
    hand = Math.min(Math.max(hand, Math.min(160, i.vh * 0.3, i.vw * 0.15)), hand + (0.8 * spare) / 1.45);
  // a phone on its side: the column on the left (whose turn it is, the hand's summary at a hand's
  // end, then you) is only as tall as the middle's row, so your hand's row stops short of squeezing it
  if (i.side && i.meOwnH) {
    const column = i.headH + 6 + (i.sideRecapH ? i.sideRecapH + 6 : 0) + i.meOwnH + 8;
    const row = i.tableH - i.headerH - 2 * ROW_GAP - column;
    hand = Math.max(0, Math.min(hand, (row - (fanHeight(1) - 1.4)) / 1.4));
  }
  const left = room(hand, lastFits) - i.middle(Math.max(34, Math.round(center)));
  // (`fits`: false when even the smallest cards don't, and the middle will be scaled to fit)
  return { center, hand, lastFits, spare: Math.max(0, left), fits: left >= -0.5 };
}

/**
 * A table screen's seats round an oval in turn order, seat 0 at the bottom (where its trick cards
 * land), each kept wholly on screen by its measured size (`w`, `h`) rather than centred off the edge.
 * CSS positions, as percentages of the table.
 */
export function ovalSeat(seat: number, players: number, w = 0, h = 0): { left: string; top: string } {
  const a = Math.PI / 2 + (seat * 2 * Math.PI) / players;
  const keep = (pct: number, size: number) => `clamp(${size / 2 + 8}px, ${pct}%, calc(100% - ${size / 2 + 8}px))`;
  return { left: keep(50 + Math.cos(a) * 40, w), top: keep(50 + Math.sin(a) * 39, h) };
}
