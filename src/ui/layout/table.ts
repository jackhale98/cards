import type { ZoneState } from '../../engine/types';
import { parseCard } from '../../engine/cards';
import { FULL_HAND } from './spread';

/**
 * How big the table's cards are: the middle's, your hand's, the strip's (everyone's melds), the
 * full-screen melds'. Pure: the screen, what's measured once (the seats' bar, the headline, your
 * column) and the zones in, sizes out. (See docs/ARCHITECTURE_PLAN.md, phase 1: this is where the
 * table's sizing lives; the zones' own layouts, in this folder, say how big a zone is at a size.)
 */

/** No card on the table narrower than this: below it the corner's rank and suit can't be read. */
export const MIN_CW = 30;
/** The last move's line under the headline (px). */
export const LAST_H = 26;

/** The middle: its zones, and the room it has. */
export interface Middle {
  zones: ZoneState[];
  /** The middle's width (measured: the screen less the columns beside it). */
  mainW: number;
  vw: number;
  /** Piles with places on the table (Kings Corners), laid out as a cross (a big screen) or one row. */
  gridded: boolean;
  cross: boolean;
  /** One row of placed piles on a phone: the widest card that lets them all fit across. */
  rowFit: number;
}

/** Piles with places on the table (Kings Corners' cross). */
export const isGridded = (zones: ZoneState[]) => zones.length > 1 && zones.every((z) => z.grid);

/** One row of placed piles on a phone on its side: the widest card that lets them all fit across (with a little over for a wider label). */
export function rowFit(zones: ZoneState[], mainW: number, side: boolean): number {
  return isGridded(zones) && side && mainW ? Math.floor((mainW - (zones.length - 1) * 6 - 30) / zones.length / 1.12) : Infinity;
}

/** The gap between the middle's piles. */
const pileGap = (vw: number) => Math.min(32, Math.max(10, vw * 0.03));
/** A zone's longest label line, in characters. */
const labelLength = (z: ZoneState) => Math.max(0, ...(z.label ?? '').split(z.base === 'showdown' ? ' · ' : '\u0000').map((l) => l.length));

/**
 * How many rows the middle's zones take at card width `cw`: each as wide as its cards or its
 * label (0.7rem capitals), whichever is wider, with the gap between.
 */
export function centerRows(m: Middle, cw: number): number {
  if (m.gridded) return m.cross ? Math.max(...m.zones.map((z) => z.grid![0])) + 1 : 1;
  if (!m.mainW) return 1;
  const gap = pileGap(m.vw);
  const widths = m.zones.map((z) => {
    const w = Math.max(MIN_CW, Math.max(34, cw) * (z.scale ?? 1));
    // (a whole hand face up, bridge's dummy, is measured as full all hand long: it keeps one size as
    // it's played from, rather than growing as it wraps onto fewer rows)
    // (likewise a pile kept room for, as it grows card by card: its `reserve`)
    const n = z.faceUpHand ? Math.max(13, z.cards.length) : Math.max(z.reserve ?? 0, z.cards.length);
    // (a row of cards: side by side up to four, overlapping from five; a trick: three cards wide)
    const cards = z.layout === 'spread' ? (n < 5 ? Math.max(1, n) * 1.1 * w : w + (n - 1) * 0.55 * w) : z.layout === 'trick' ? 3 * w : w;
    return Math.max(cards, (labelLength(z) + 3) * 8.5) + gap;
  });
  let rows = 1;
  let x = 0;
  for (const w of widths) {
    if (x && x + w > m.mainW + gap) {
      rows++;
      x = 0;
    }
    x += w;
  }
  return rows;
}

/**
 * How tall the middle's piles stand at card width `cw`, row by row as they wrap (as in
 * centerRows): a trick 2.25 card widths, a pile or a row of cards 1.4 (a cascade 1.82) and its
 * label, a whole hand face up at the size that fits thirteen across.
 */
export function centerHeight(m: Middle, cw: number): number {
  if (!m.mainW) return 0;
  const gap = pileGap(m.vw);
  let height = 0;
  let row = 0;
  let x = 0;
  for (const z of m.zones) {
    const w = Math.max(MIN_CW, Math.max(34, cw) * (z.scale ?? 1));
    const card = z.faceUpHand ? Math.min(w, Math.floor((m.mainW - 16) / FULL_HAND)) : w;
    const n = Math.max(z.reserve ?? 0, z.cards.length);
    const cards =
      z.layout === 'trick'
        ? 3 * w
        : z.faceUpHand
          ? FULL_HAND * card
          : z.layout === 'spread'
            ? n < 5
              ? Math.max(1, n) * 1.1 * card
              : card + (n - 1) * 0.55 * card
            : card;
    const width = Math.max(cards, (labelLength(z) + 3) * 8.5) + gap;
    const tall = z.layout === 'trick' ? 2.25 * w : (z.cascade ? 1.82 : 1.4) * card + (z.label ? 40 : 0);
    if (x && x + width > m.mainW + gap) {
      height += row + 8;
      row = 0;
      x = 0;
    }
    x += width;
    row = Math.max(row, tall);
  }
  return height + row;
}

export interface SizeInput {
  vw: number;
  vh: number;
  display: boolean;
  handMode: boolean;
  /** A phone on its side: whose turn it is and the last move go in the column on the left. */
  side: boolean;
  /** Measured once they're drawn: the seats' bar, the headline, your own part of the column. */
  headerH: number;
  headH: number;
  meOwnH: number;
  /** There's a headline over the middle. */
  headline: boolean;
  middle: Middle;
  /** There's a strip of melds (or room kept for one). */
  strips: boolean;
  /** The strip's cards' size against the middle's. */
  stripScale: number;
  /** Your own face-down pile instead of a hand (slap games). */
  pileOnly: boolean;
  /** Your hand is empty at the end of a hand: the middle gets its room. */
  handEmpty: boolean;
}

/**
 * The table's height shared out between the cards in the middle and your hand, from what's left
 * once the seats, the score track and the headline have theirs. On a short screen (a phone with
 * the browser's bars showing) both shrink together, so neither runs into the other. (Worked out
 * from the screen, not from the sizes they end up, so the layout can't chase itself.)
 */
export function cardSizes(i: SizeInput): { center: number; hand: number; lastFits: boolean } {
  const zones = i.middle.zones;
  // (a pile or two in the middle and nothing else there, as in Cheat, Spit or the slap games:
  // they're what everyone watches, so they get the room; so does everything laid down at a
  // hand's end, when your own hand is empty)
  // (a game with a strip of melds counts it from the deal, before the first meld: the first book
  // in Go Fish would otherwise shrink the pond for the rest of the game, all at once)
  const big = i.pileOnly || i.handEmpty || (zones.length <= 2 && !i.strips && zones.every((z) => z.layout === 'stack'));
  const wantCenter = Math.min(big ? 120 : 92, i.vh * (big ? 0.24 : 0.15), i.vw * (big ? 0.12 : 0.09));
  const wantHand = i.handEmpty
    ? 0
    : i.handMode
      ? // (hand mode: the middle is a pile or two at most, so the hand is bigger)
        Math.min(168, i.vh * (zones.length ? 0.27 : 0.34), i.vw * 0.15)
      : Math.min(112, i.vh * (i.pileOnly ? 0.14 : 0.2), i.vw * 0.11);
  if (i.display || !i.headerH) return { center: wantCenter, hand: wantHand, lastFits: true };
  const above = i.headline && !i.side ? i.headH + 6 : 0;
  // (the table's padding and gaps, the middle's labels, and the hand's own: about 70px, the rest is cards;
  // a pile is about 1.6 card widths tall with its label, a fanned hand 1.45 with its arc)
  let room = i.vh - i.headerH - above - 70;
  // the last move under the headline only when there's room for it: the cards come first
  let lastFits = i.side || room - LAST_H >= 1.6 * 36 + 1.45 * 48;
  if (lastFits && !i.side) room -= LAST_H;
  // the largest share of the room that fits, both shrinking together (in small steps: a pile can't
  // go below its smallest readable size, and the piles may wrap onto more rows as they shrink)
  const scale = Math.max(0.3, ...zones.map((z) => z.scale ?? 1));
  const need = (k: number) => {
    const c = wantCenter * k;
    // (everyone's melds on a row of their own, their cards smaller, with a label: counted even
    // when there are no piles above it, as in hand mode with a TV showing them)
    const strip = i.strips ? 1.4 * Math.max(MIN_CW, c * i.stripScale) + 30 : 0;
    if (!zones.length) return strip + 1.45 * wantHand * k;
    // (a pile's card as drawn: never under the smallest readable width)
    const zw = Math.max(MIN_CW, Math.min(i.middle.rowFit, Math.max(34, c) * scale));
    // (each row: a pile and its label; between rows, a gap)
    const rows = centerRows(i.middle, c);
    // (a cascade's bottom card peeks out above it)
    const pile = (zones.some((z) => z.cascade) ? 1.82 : 1.4) * zw;
    return Math.max(i.middle.rowFit < Infinity ? 0 : 1.6 * c, pile + 22) + (rows - 1) * (pile + 30) + strip + 1.45 * wantHand * k;
  };
  let k = 1;
  while (k > 0.35 && need(k) > room) k -= 0.02;
  // still too tall at the smallest sizes (Kings Corners' eight piles, six players, a phone):
  // the last move's line gives its room to the cards
  if (lastFits && !i.side && need(k) > room) {
    lastFits = false;
    room += LAST_H;
    while (k < 1 && need(k + 0.02) <= room) k += 0.02;
  }
  // room left over once everything fits (a small middle, a short hand): most of it to your hand,
  // up to a ceiling (some margin kept: the middle's height is an estimate)
  let hand = wantHand * k;
  // (not when the piles are one row as wide as fits, Kings Corners on a phone: they can't use the
  // height, and the hand needn't be bigger than the piles it's played onto)
  if (k >= 1 && wantHand && !i.handMode && i.middle.rowFit === Infinity) {
    const spare = room - need(1);
    if (spare > 0) hand = Math.min(Math.max(hand, Math.min(160, i.vh * 0.3, i.vw * 0.15)), hand + (0.8 * spare) / 1.45);
  }
  // a phone on its side: the column on the left (whose turn it is, then you) is only as tall as
  // the middle, so the hand stops short of squeezing it: the middle is what's left of the screen
  // under the seats once the hand (1.4 card heights and its arc) has its share
  if (i.side && i.meOwnH) {
    const column = i.headH + 6 + i.meOwnH + 8;
    // (12px to spare: fonts differ a little from phone to phone)
    hand = Math.max(0, Math.min(hand, (i.vh - i.headerH - 56 - column) / 1.4));
  }
  return { center: wantCenter * k, hand, lastFits };
}

/**
 * A table screen's cards in the middle: as big as the screen suits, but no bigger than lets every
 * row of piles fit the height there is (the dummy on its row and the trick under it, say), so
 * they're drawn at their size from the start rather than shrunk to fit after.
 */
export function displayCw(i: { vw: number; vh: number; track: boolean; hasStrip: boolean; stripShown: boolean; middleRoom: number; middle: Middle }): number {
  const base = Math.max(60, Math.min(300, i.vh * (i.track ? 0.18 : i.hasStrip ? 0.14 : 0.22), i.vw * (i.hasStrip ? 0.07 : 0.1)));
  if (!i.middleRoom || i.middle.gridded || i.stripShown) return base;
  let cw = base;
  while (cw > 60 && centerHeight(i.middle, cw) > i.middleRoom) cw -= 2;
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

/** How wide a zone's melds are, in card widths. */
export function unitsOf(z: { piles?: boolean; cards: { id: string; group?: number; square?: boolean }[] }): number {
  const starts = z.cards.filter((c, i) => i > 0 && c.group != null && c.group !== z.cards[i - 1].group).length;
  // (as piles: one card's width a meld, and half a card for each of another rank fanned beside it)
  if (z.piles) {
    let odd = 0;
    z.cards.forEach((c, i) => {
      const first = z.cards.findIndex((x) => x.group === c.group);
      if (i !== first && !c.square && parseCard(c.id).rank !== parseCard(z.cards[first].id).rank) odd++;
    });
    return 1 + starts * 1.22 + odd * 0.45;
  }
  // (in the strip each card past the first shows 0.65 of a card; a new meld starts 0.67 further on)
  return 1 + Math.max(0, z.cards.length - 1) * 0.65 + starts * 0.67;
}

/**
 * How tall everyone's melds stand with cards `cw` wide, each set on its own panel, the panels
 * packed into rows `across` wide (a long run of melds wraps onto more lines of its own).
 */
export function packedHeight(
  units: number[],
  labelW: number[],
  cw: number,
  across: number,
  rem: number,
  { gap, pad, extra }: { gap: number; pad: number; extra: number },
): number {
  // (each set of melds sits on its own panel, a little wider (`pad`) and taller (`extra`, its label
  // and padding) than its cards)
  let height = 0;
  let rowH = 0;
  let x = 0;
  for (const [i, u] of units.entries()) {
    const w = Math.max(u * cw, labelW[i]) + pad;
    const lines = Math.ceil(w / across);
    const h = lines * cw * 1.4 + (lines - 1) * 0.3 * rem + extra;
    if (lines > 1 || (x && x + gap + w > across)) {
      height += rowH ? rowH + 0.6 * rem : 0;
      rowH = 0;
      x = 0;
    }
    rowH = Math.max(rowH, h);
    x = lines > 1 ? across : x + (x ? gap : 0) + w;
  }
  return height + rowH;
}

/**
 * A table screen's strip (everyone's melds): it can't scroll, so it wraps into rows across the
 * middle, with cards small enough that every set of melds packs into the height left.
 */
export function stripFit(i: { display: boolean; zones: ZoneState[]; mainW: number; mainH: number; rem: number; stripSpace: number; centerCw: number }): number {
  if (!i.display || !i.zones.length || !i.mainW || !i.mainH) return Infinity;
  const rem = i.rem;
  // (the strip may reach a little past the middle's sides: lower down, the oval is wider)
  const across = i.mainW * 1.2;
  // the height left under the headline and the row of piles (and clear of the seat at the bottom)
  // (measured once it's on screen; until then, a fair guess)
  const room = i.stripSpace > 0 ? i.stripSpace : i.mainH - (i.centerCw * 1.4 + 2 * rem) - 5 * rem;
  if (room < 60) return Infinity;
  const units = i.zones.map(unitsOf);
  // (a panel is at least as wide as its label: small capitals, about half a rem a letter)
  const labelW = i.zones.map((z) => (z.label?.length ?? 0) * 0.56 * rem);
  const largest = Math.round(i.centerCw * Math.max(...i.zones.map((z) => z.scale ?? 1)));
  // the biggest cards that let everyone's melds pack into rows that fit across and down; a long
  // run of melds (a team's in Hand and Foot) wraps onto more lines of its own
  for (let cw = largest; cw > MIN_CW; cw -= 2)
    if (packedHeight(units, labelW, cw, across, rem, { gap: 24, pad: 1.6 * rem, extra: 2.5 * rem }) <= room) return cw;
  return MIN_CW;
}

/**
 * Everyone's melds full screen: the biggest cards that let them all fit the room, so a few melds
 * fill the screen; only past a readable smallest size does the page scroll.
 */
export function spreadCw(i: { zones: ZoneState[]; w: number; h: number }): number {
  if (!i.w || !i.h || !i.zones.length) return 44;
  const units = i.zones.map(unitsOf);
  const labelW = i.zones.map((z) => (z.label?.length ?? 0) * 0.56 * 16);
  const room = i.h - 12;
  // (a pile stands up to 12px taller than one card, its count badge hanging a little below)
  const extra = 32 + (i.zones.some((z) => z.piles) ? 16 : 0);
  for (let cw = Math.min(140, Math.round(room / 1.4 - 30)); cw > 40; cw -= 2)
    if (packedHeight(units, labelW, cw, i.w - 4, 16, { gap: 10, pad: 18, extra }) <= room) return cw;
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
