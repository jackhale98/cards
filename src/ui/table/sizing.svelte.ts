import type { ZoneState } from '../../engine/types';
import { FULL_HAND, TAP, type Where } from '../layout';
import * as size from '../layout/table';
import { labelMeasure } from '../labelMeasure';

/** What the table's sizes are worked out from, read live (an object of getters: see Table). */
export interface SizingIn {
  display: boolean;
  handMode: boolean;
  /** A phone on its side (whose turn it is goes in the column on the left). */
  side: boolean;
  vw: number;
  vh: number;
  you: number;
  players: number;
  zones: Record<string, ZoneState>;
  /** The middle's zones, and the strip's (everyone's melds), as shown. */
  center: ZoneState[];
  strip: ZoneState[];
  pot: number | undefined;
  headline: string | undefined;
  track: boolean;
  /** Your own face-down pile instead of a hand (slap games); your hand empty at a hand's end. */
  pileOnly: boolean;
  handEmpty: boolean;
  /** Everyone's melds on the table: the buttons sit in your hand's row (`.wide-middle`). */
  wideMiddle: boolean;
  /** The hand's summary under the middle, or in the side column. */
  recapBelow: boolean;
  recapSide: boolean;
  /** A zone whose cards you can pick now: they spread out enough to tap (see Zone). */
  tappable: (z: ZoneState) => boolean;
}

/**
 * The table's sizes: how big the middle's cards, your hand's and the strip's are, from the screen,
 * the zones, and the few things measured on the page (the seats' bar, the headline, your column:
 * bound straight to the fields below). The arithmetic is layout/table.ts; this keeps the state.
 */
export class TableSizing {
  // ---- measured on the page (bound: `bind:clientHeight={sizing.headH}`)
  headerH = $state(0);
  mainW = $state(0);
  mainH = $state(0);
  meOwnH = $state(0);
  headH = $state(0);
  /** The table's height inside its padding (see `tableEl`). */
  tableH = $state(0);
  /** The hand's summary under the middle, and in the side column. */
  recapH = $state(0);
  sideRecapH = $state(0);
  /** The last move's line (it can wrap), measured when last shown (see TableStatus). */
  lastH = $state(0);
  /** The buttons' column: with everyone's melds on the table it sits in your hand's row, at its foot. */
  asideH = $state(0);
  /** The pot, beside the middle's piles (it doesn't change size with the cards). */
  potW = $state(0);
  potH = $state(0);
  /** Room for the piles in a table screen's middle, under the headline (measured: see fitHeight). */
  middleRoom = $state(0);
  /** How the table draws a pile's label (measured once per text, see labelMeasure). */
  readonly labels = labelMeasure();

  readonly #in: SizingIn;
  constructor(i: SizingIn) {
    this.#in = i;
    // a table screen: everything sized in rem grows with the screen
    $effect(() => {
      if (!this.#in.display) return;
      document.documentElement.style.fontSize = `${this.tvRem}px`;
      return () => {
        document.documentElement.style.fontSize = '';
      };
    });
    // the strip's hold (see stripKeep)
    $effect(() => {
      const cards = this.#stripCards;
      const fit = this.stripFit;
      // (fewer cards in the melds than before: a new hand, so start afresh)
      if (cards < this.#stripKeep.cards) this.#stripKeep = { cards, cw: fit };
      else if (fit < this.#stripKeep.cw) this.#stripKeep = { cards, cw: fit };
      else if (cards !== this.#stripKeep.cards) this.#stripKeep.cards = cards;
    });
  }
  /** The room under a table screen's headline, as measured (see fitHeight): only a real change counts. */
  noteRoom(room: number) {
    if (Math.abs(room - this.middleRoom) >= 4) this.middleRoom = room;
  }
  /** The table element's inner height, from its client height and padding. */
  measureTable(el: HTMLElement, clientH: number) {
    const st = getComputedStyle(el);
    this.tableH = clientH - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
  }

  /** On a table screen everything sized in rem grows with the screen (1rem = this many px); a little smaller with lots of players, so seats don't collide round the oval. */
  readonly tvRem = $derived.by(() => {
    const i = this.#in;
    return i.display ? Math.round(Math.max(16, Math.min(56, i.vw * (i.players > 6 ? 0.014 : 0.0175), i.vh * 0.031))) : 16;
  });
  /** A game with a strip of melds (whether or not there are any yet). */
  readonly hasStrip = $derived.by(() => Object.values(this.#in.zones).some((z) => z.area === 'strip'));
  /** Piles with places on the table (Kings Corners): a cross on a big screen, one row in reading order on a phone on its side. */
  readonly gridded = $derived.by(() => size.isGridded(this.#in.center));
  readonly cross = $derived.by(() => this.gridded && !this.#in.side);
  /** That one row: the widest card that lets them all fit across. */
  readonly rowFit = $derived.by(() => size.rowFit(this.#in.center, this.mainW, this.#in.side));

  /** How a zone on the strip (everyone's melds) is laid out at a card width (as the strip's Zones are). */
  whereStrip = (z: ZoneState, zcw: number): Where => ({
    cw: zcw,
    you: this.#in.you,
    players: this.#in.players,
    style: 'strip',
    maxW: this.#in.display && this.mainW ? this.mainW * 1.2 - 1.6 * this.tvRem : Infinity,
    rowGap: this.#in.display ? 0.3 * this.tvRem : undefined,
    tap: this.#in.tappable(z) ? TAP : undefined,
  });

  /**
   * How tall the middle stands with its cards `cw` wide: every zone laid out by its own layout,
   * the zones in rows as the page puts them, everyone's melds under them (`withStrip`), or the
   * room kept for them (`reserve`).
   */
  middleAt = (cw: number, reserve: boolean = this.stripRoomShown, withStrip = true): number => {
    const i = this.#in;
    const roomyNow = size.roomy(i.center, cw, this.mainW, i.vw, i.strip.length > 0);
    const kept = this.#stripKeep.cw;
    const whereMiddle = (z: ZoneState, zcw: number): Where => ({
      cw: zcw,
      you: i.you,
      players: i.players,
      style: 'middle',
      maxW: this.mainW ? this.mainW - 4 : Infinity,
      roomy: roomyNow,
      tap: i.tappable(z) ? TAP : undefined,
      dummy: z.faceUpHand ? { cw: zcw, minW: Math.round(zcw * FULL_HAND) } : undefined,
    });
    const stripCwAt = (z: { scale?: number }) => size.stripCw(z, { centerCw: cw, display: i.display, kept });
    return size.middleHeight({
      zones: i.center,
      cwOf: (z) => size.slotCw(z, { centerCw: cw, mainW: this.mainW, rowFit: this.rowFit, display: i.display }),
      whereOf: whereMiddle,
      mainW: this.mainW,
      vw: i.vw,
      rem: this.tvRem,
      labels: this.labels,
      cross: this.cross,
      rowFit: this.rowFit < Infinity,
      steadyLabel: i.display ? (zcw) => zcw * 1.8 : undefined,
      extras: i.pot && !i.handMode ? [{ w: this.potW, h: this.potH }] : [],
      strip: !withStrip
        ? undefined
        : i.strip.length
          ? { zones: i.strip, cwOf: stripCwAt, whereOf: this.whereStrip, wrap: i.display }
          : reserve && !i.display
            ? { room: Math.round(1.4 * stripCwAt({ scale: this.stripScale }) + 30) }
            : undefined,
    });
  };

  /** How big the middle's cards and your hand's are: the table's height shared out exactly, once it's measured. */
  #fitWith(reserve: boolean) {
    const i = this.#in;
    return size.fitSizes({
      vw: i.vw,
      vh: i.vh,
      display: i.display,
      side: i.side,
      handMode: i.handMode,
      // (before the table's first measured: near enough, and measured a moment later)
      tableH: this.tableH || i.vh - 10,
      headerH: this.headerH || 56,
      headH: this.headH,
      headlineAbove: !!i.headline && !i.side,
      lastH: this.lastH,
      meOwnH: this.meOwnH,
      belowH: i.recapBelow ? this.recapH : 0,
      sideRecapH: i.side && i.recapSide ? this.sideRecapH || 40 : 0,
      middle: (cw: number): number => this.middleAt(cw, reserve),
      hasMiddle: i.center.length > 0,
      pileOnly: i.pileOnly,
      handEmpty: i.handEmpty,
      big:
        i.pileOnly ||
        i.handEmpty ||
        (i.center.length <= 2 && !(i.handMode ? i.strip.length > 0 : this.hasStrip) && i.center.every((z) => z.layout === 'stack')),
      rowFit: this.rowFit < Infinity,
      pileLabelH: this.labels.lineH + 0.35 * 16,
      stripShown: i.strip.length > 0,
      bottomMinH: i.wideMiddle ? this.asideH : 0,
    });
  }
  /**
   * The sizes, readable first: if even the smallest cards don't fit with room kept for everyone's
   * melds before the first one (so the piles don't move when it comes), that room gives way.
   */
  readonly #sizing = $derived.by(() => {
    const room = this.stripRoom;
    const kept = this.#fitWith(room);
    if (!room || this.#in.display || kept.fits) return { fit: kept, reserve: room };
    const without = this.#fitWith(false);
    return without.fits ? { fit: without, reserve: false } : { fit: kept, reserve: true };
  });
  readonly fit = $derived(this.#sizing.fit);
  /** A place kept for the strip from the deal: the piles don't jump when the first meld goes down (a phone's strip is one row, kept at its height). */
  readonly stripRoom = $derived.by(() => !this.#in.strip.length && this.hasStrip && (this.#in.display || !this.#in.handMode));
  /** …unless the table's too short to keep it (see the sizes). */
  readonly stripRoomShown = $derived(this.stripRoom && this.#sizing.reserve);

  /** The middle's cards' width. */
  readonly centerCw = $derived.by(() => {
    const i = this.#in;
    return Math.round(
      i.display
        ? size.displayCw({
            vw: i.vw,
            vh: i.vh,
            track: i.track,
            hasStrip: this.hasStrip,
            stripShown: i.strip.length > 0,
            gridded: this.gridded,
            middleRoom: this.middleRoom,
            middle: this.middleAt,
          })
        : Math.max(34, this.fit.center),
    );
  });
  /** The middle's cards fit across side by side (a Hold'em board on a tablet): no need to overlap them. */
  readonly roomy = $derived.by(() => size.roomy(this.#in.center, this.centerCw, this.mainW, this.#in.vw, this.#in.strip.length > 0));
  /** Each middle zone's card width. */
  slotCw = (z: ZoneState) => size.slotCw(z, { centerCw: this.centerCw, mainW: this.mainW, rowFit: this.rowFit, display: this.#in.display });
  /**
   * How wide a face-up hand in the middle (the dummy, a row of cards) may grow: its cards as much
   * taller as the height that's spare (the sizes leave it spare for this). On a table screen the
   * dummy keeps one size all hand, for everyone watching.
   */
  readonly growTo = $derived.by(() => {
    const dummy = this.#in.center.find((z) => z.faceUpHand);
    if (this.#in.display || !dummy) return 0;
    return this.slotCw(dummy) + Math.floor(this.fit.spare / 1.4);
  });
  /** Your hand's card width. */
  readonly handCw = $derived.by(() =>
    size.handCw({ hand: this.fit.hand, handMode: this.#in.handMode, stripShown: this.#in.strip.length > 0, pileOnly: this.#in.pileOnly }),
  );

  // ---- the strip (everyone's melds)
  /** The strip's cards' size against the middle's (its zones', or before the first meld, the game's). */
  readonly stripScale = $derived.by(() =>
    Math.max(...(this.#in.strip.length ? this.#in.strip : Object.values(this.#in.zones).filter((z) => z.area === 'strip')).map((z) => z.scale ?? 1), 0),
  );
  /** The height a table screen's strip has: the room under the headline less the piles' row over it (6px between), clear of the seat at the bottom. */
  readonly #stripSpace = $derived.by(() =>
    this.#in.display && this.middleRoom ? Math.floor(this.middleRoom - this.middleAt(this.centerCw, false, false) - 6 - 8) : 0,
  );
  /** A table screen can't be scrolled: its strip wraps into rows across the middle, with cards small enough to fit. */
  readonly stripFit = $derived.by(() => {
    const i = this.#in;
    return size.stripFit({
      display: i.display,
      zones: i.strip,
      mainW: this.mainW,
      mainH: this.mainH,
      rem: this.tvRem,
      vw: i.vw,
      stripSpace: this.#stripSpace,
      centerCw: this.centerCw,
      labels: this.labels,
      whereOf: this.whereStrip,
    });
  });
  readonly #stripCards = $derived.by(() => this.#in.strip.reduce((t, z) => t + z.cards.length, 0));
  /** Through a hand the strip's cards only get smaller (once, as melds outgrow the row), never back and forth. */
  #stripKeep = $state({ cards: 0, cw: Infinity });
  /** A strip zone's card width. */
  stripCw = (z: { scale?: number }) => size.stripCw(z, { centerCw: this.centerCw, display: this.#in.display, kept: this.#stripKeep.cw });

  /** What the sizes were worked out from (development builds: for tests and debugging). */
  get debug() {
    return {
      ...this.fit,
      reserve: this.#sizing.reserve,
      handCw: this.handCw,
      centerCw: this.centerCw,
      side: this.#in.side,
      handEmpty: this.#in.handEmpty,
      tableH: this.tableH,
      headerH: this.headerH,
      headH: this.headH,
      meOwnH: this.meOwnH,
      sideRecapH: this.sideRecapH,
      wideMiddle: this.#in.wideMiddle,
      asideH: this.asideH,
    };
  }
}
