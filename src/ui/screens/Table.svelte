<script lang="ts">
  import { bugReportLink, SUPPORT_URL } from '../contact';
  import SuitText from '../components/SuitText.svelte';
  import { app, inviteUrl } from '../../app.svelte';
  import type { ActionSpec, ZoneState } from '../../engine/types';
  import { getGame, howToPlay } from '../../games';
  import { REACTIONS, type Frame, type View } from '../../net/protocol';
  import { untrack } from 'svelte';
  import ReplayBar from '../components/ReplayBar.svelte';
  import ActionBar from '../components/ActionBar.svelte';
  import Hand from '../components/Hand.svelte';
  import Seat from '../components/Seat.svelte';
  import Zone from '../components/Zone.svelte';
  import * as size from '../layout/table';
  type Fit = ReturnType<typeof size.fitSizes>;
  import { FULL_HAND, TAP, type Where } from '../layout';
  import { labelMeasure } from '../labelMeasure';
  import { Frames, provideFrames } from '../layout/frames.svelte';
  import Sheet from '../components/Sheet.svelte';
  import LookPicker from '../components/LookPicker.svelte';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import Track from '../components/Track.svelte';
  import NightBoard from '../components/NightBoard.svelte';
  import ScoreChart from '../components/ScoreChart.svelte';
  import { nightTotals } from '../../net/night';
  import { seatRelation } from '../../engine/state';
  import { flight, haptic, play, snapshot } from '../motion';
  import { play as playSound, setSound, soundOn, type Sound } from '../sound';
  import { fourColourOn, setFourColour } from '../suits';
  import { hintsOn, setHints } from '../hints';
  import { arrangeHand, HAND_SORT_LABEL, HAND_SORTS, handSortOn, setHandSort, type HandSort } from '../handOrder';
  import { marquee } from '../marquee';
  import { fade } from 'svelte/transition';
  import { isHidden } from '../../engine/redact';
  import { SCREEN_SOUND, STAND_IN } from '../../net/host';
  import { seatColor } from '../seatColors';
  import { keepAwake } from '../wakeLock';
  import { canNotify, clearTurn, raiseTurn, setTurnAlerts, turnAlertsOn } from '../turnAlert';
  import { EXPORT_ABOUT, EXPORT_FILE, EXPORT_LABEL, recordFormats } from '../../net/exports/formats';
  import TvSheet from '../components/TvSheet.svelte';
  import CardLayer from '../components/CardLayer.svelte';

  /** `replay`: a moment of a finished hand is on screen (the table shows it, quietly). */
  let { view, display = false, replay = null }: { view: View; display?: boolean; replay?: Frame | null } = $props();

  const s = $derived(view.state!);
  const you = $derived(view.you);
  const status = $derived(view.status!);
  const game = $derived(getGame(s.game));
  const n = $derived(s.players.length);
  const rules = $derived(howToPlay(game.config, n));
  const showChips = $derived(!!game.config.chips);

  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  /**
   * Hand mode: a table screen shows the middle of the table, so this phone keeps only what's
   * yours (a bigger hand, your info and actions) plus any pile you can tap right now.
   */
  const handMode = $derived(!display && you >= 0 && !!view.lobby.displays && app.handMode);
  /**
   * A face-down pile of your own instead of a hand (slap games): you only tap it, so it can be
   * small, and the pile in the middle (what you're watching, and slapping) gets the room.
   */
  const pileOnly = $derived(you >= 0 && s.zones[`hand:${you}`]?.layout === 'stack');
  // the heights of what sits above the cards (measured: a headline can take two lines)
  let headerH = $state(0);
  let mainW = $state(0);
  let mainH = $state(0);
  let meOwnH = $state(0);
  /**
   * A phone on its side: height is what's short, so whose turn it is and the last move go in the
   * column on the left, and the race to the target (cribbage) in the one on the right.
   */
  const side = $derived(!display && !handMode && vh <= 500);
  let headH = $state(0);
  /**
   * How wide a face-up hand in the middle (the dummy) may grow before the middle runs out of height.
   * (On a phone only: on a table screen the dummy keeps one size all hand, for everyone watching.)
   */
  let growTo = $state(Infinity);
  /** The table's height inside its padding, and what sits under the middle's piles (measured). */
  let tableH = $state(0);
  let tableClientH = $state(0);
  $effect(() => {
    const el = tableEl;
    if (!el || !tableClientH) return;
    const st = getComputedStyle(el);
    tableH = tableClientH - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
  });
  let recapH = $state(0);
  /** The recap in your column (side mode): the column keeps room for it. */
  let sideRecapH = $state(0);
  /**
   * How tall the buttons' column is (with everyone's melds on the table it sits in your hand's row,
   * at its foot and only as tall as its buttons: the row is as tall as the taller of the two).
   */
  let asideH = $state(0);
  /** The pot, beside the middle's piles (it doesn't change size with the cards). */
  let potW = $state(0);
  let potH = $state(0);
  /** How the table draws a pile's label (measured once per text, see labelMeasure). */
  const labels = labelMeasure();
  /** A zone whose cards you can pick now: they spread out enough to tap (see Zone). */
  const tappable = (z: ZoneState) => z.cards.some((c) => selectable?.has(c.id));
  /** How a zone on the strip (everyone's melds) is laid out at a card width (as the strip's Zones are). */
  const whereStrip = (z: ZoneState, zcw: number): Where => ({
    cw: zcw,
    you,
    players: n,
    style: 'strip',
    maxW: display && mainW ? mainW * 1.2 - 1.6 * tvRem : Infinity,
    rowGap: display ? 0.3 * tvRem : undefined,
    tap: tappable(z) ? TAP : undefined,
  });
  /**
   * How tall the middle stands with its cards `cw` wide: every zone laid out by its own layout,
   * the zones in rows as the page puts them, everyone's melds under them (layout/table.ts).
   */
  function middleAt(cw: number, reserve: boolean = stripRoomShown): number {
    const roomyNow = size.roomy(centerZones, cw, mainW, vw, stripZones.length > 0);
    const kept = stripKeep.cw;
    const whereMiddle = (z: ZoneState, zcw: number): Where => ({
      cw: zcw,
      you,
      players: n,
      style: 'middle',
      maxW: mainW ? mainW - 4 : Infinity,
      roomy: roomyNow,
      tap: tappable(z) ? TAP : undefined,
      dummy: z.faceUpHand ? { cw: zcw, minW: Math.round(zcw * FULL_HAND) } : undefined,
    });
    const stripCwAt = (z: { scale?: number }) => size.stripCw(z, { centerCw: cw, display, kept });
    return size.middleHeight({
      zones: centerZones,
      cwOf: (z) => size.slotCw(z, { centerCw: cw, mainW, rowFit, display }),
      whereOf: whereMiddle,
      mainW,
      vw,
      rem: tvRem,
      labels,
      cross,
      rowFit: rowFit < Infinity,
      steadyLabel: display ? (zcw) => zcw * 1.8 : undefined,
      extras: status.pot && !handMode ? [{ w: potW, h: potH }] : [],
      strip: stripZones.length
        ? { zones: stripZones, cwOf: stripCwAt, whereOf: whereStrip, wrap: display }
        : reserve && !display
          ? { room: Math.round(1.4 * stripCwAt({ scale: stripScale }) + 30) }
          : undefined,
    });
  }
  /** How big the middle's cards and your hand's are (layout/table.ts): the table's height shared out exactly, once it's measured. */
  const fitWith = (reserve: boolean): Fit =>
    size.fitSizes({
      vw,
      vh,
      display,
      side,
      handMode,
      // (before the table's first measured: near enough, and measured a moment later)
      tableH: tableH || vh - 10,
      headerH: headerH || 56,
      headH,
      headlineAbove: !!status.headline && !side,
      meOwnH,
      belowH: recapShown ? recapH : 0,
      sideRecapH: side && recap && !(showBanner && status.banner) ? sideRecapH || 40 : 0,
      middle: (cw: number): number => middleAt(cw, reserve),
      hasMiddle: centerZones.length > 0,
      pileOnly,
      handEmpty,
      big:
        pileOnly || handEmpty || (centerZones.length <= 2 && !(handMode ? stripZones.length > 0 : hasStrip) && centerZones.every((z) => z.layout === 'stack')),
      rowFit: rowFit < Infinity,
      pileLabelH: labels.lineH + 0.35 * 16,
      stripShown: stripZones.length > 0,
      // (with everyone's melds on the table the buttons sit in your hand's row: `.wide-middle`)
      bottomMinH: wideMiddle ? asideH : 0,
    });
  /**
   * The sizes, readable first: if even the smallest cards don't fit with room kept for everyone's
   * melds before the first one (so the piles don't move when it comes), that room gives way.
   */
  const sizing = $derived.by((): { fit: Fit; reserve: boolean } => {
    const kept = fitWith(stripRoom);
    if (!stripRoom || display || kept.fits) return { fit: kept, reserve: stripRoom };
    const without = fitWith(false);
    return without.fits ? { fit: without, reserve: false } : { fit: kept, reserve: true };
  });
  const cardSizes = $derived(sizing.fit);
  // (development builds: what the sizes were worked out from, for tests and debugging)
  $effect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __sizes: unknown }).__sizes = {
      ...sizing.fit,
      reserve: sizing.reserve,
      handCw,
      centerCw,
      side,
      handEmpty,
      fan: fanCards.length,
      tableH,
      headerH,
      headH,
      meOwnH,
      sideRecapH,
      wideMiddle,
      asideH,
    };
  });
  /** Room kept for the strip, unless the table's too short to keep it (see sizing). */
  const stripRoomShown = $derived.by(() => stripRoom && sizing.reserve);
  /** The middle's cards fit across side by side (a Hold'em board on a tablet): no need to overlap them. */
  const roomy = $derived.by(() => size.roomy(centerZones, centerCw, mainW, vw, stripZones.length > 0));
  const MIN_CW = size.MIN_CW;
  // a score track takes some height, so table cards get a little smaller with one
  /** A game with a strip of melds: on a table screen its piles give up some room to everyone's melds. */
  const hasStrip = $derived(Object.values(s.zones).some((z) => z.area === 'strip'));
  const centerCw = $derived.by(() =>
    Math.round(
      display
        ? size.displayCw({ vw, vh, track: !!status.track, hasStrip, stripShown: stripZones.length > 0, gridded, middleRoom, middle: middleAt })
        : Math.max(34, cardSizes.center),
    ),
  );
  /** Room for the piles in a table screen's middle, under the headline (measured: see fitHeight). */
  let middleRoom = $state(0);

  /** Each middle zone's card size (layout/table.ts). */
  const slotCw = (z: ZoneState) => size.slotCw(z, { centerCw, mainW, rowFit, display });

  /**
   * The safety net under the sizes worked out above: if the middle's cards still come out taller
   * than the room under the headline (labels grow during play; a row wraps that wasn't expected),
   * they're drawn smaller to fit. A transform doesn't change the layout, so measuring it can't
   * set off another round.
   */
  /**
   * Whose turn it is, in the short column on the left of a phone: the headline always shows whole;
   * the last move only when there's room for all of it (never half a line).
   */
  function fitSide(el: HTMLElement) {
    let frame = 0;
    const fit = () => {
      // (the last move goes first when the column can't hold everything, then the hand's summary,
      // which the Scores sheet has too)
      const parts = ['.last', '.recap'].map((q) => el.querySelector<HTMLElement>(q)).filter((x) => !!x);
      for (const x of parts) x.style.display = '';
      for (const x of parts) if (el.scrollHeight > el.clientHeight + 1) x.style.display = 'none';
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const ro = new ResizeObserver(later);
    ro.observe(el);
    // (and when the column itself grows: with something hidden, this box is only as tall as what's
    // left in it, so it wouldn't change size by itself to show it again)
    if (el.parentElement) ro.observe(el.parentElement);
    const mo = new MutationObserver(later);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    later();
    return {
      destroy: () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        mo.disconnect();
      },
    };
  }
  function fitHeight(el: HTMLElement) {
    const main = el.parentElement!;
    // The content's own size, from where its piles sit in the layout (offset sizes: a card in
    // flight is drawn transformed, outside its pile, and must not count, or the middle shrinks
    // for the length of every move and springs back). The box itself may be squeezed to the room
    // while its piles spill out of it, so it's the children that are measured.
    const extent = () => {
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (const c of [...el.children] as HTMLElement[]) {
        if (c.dataset.pinned || !c.offsetWidth) continue;
        top = Math.min(top, c.offsetTop);
        bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
        // (a table screen's strip may reach past the middle's sides on purpose: its height counts, not its width)
        if (c.dataset.wide) continue;
        left = Math.min(left, c.offsetLeft);
        right = Math.max(right, c.offsetLeft + c.offsetWidth);
      }
      // (offsets are from the middle (main), as is the box's own top)
      return Number.isFinite(top) ? { h: bottom - Math.min(top, el.offsetTop), w: right - left } : { h: 0, w: 0 };
    };
    const fit = () => {
      // (anything below the piles in the middle, the hand's summary say, keeps its room)
      let below = 0;
      for (let c = el.nextElementSibling as HTMLElement | null; c; c = c.nextElementSibling as HTMLElement | null)
        if (c.offsetHeight && getComputedStyle(c).position !== 'absolute') below += c.offsetHeight + 6;
      const room = main.clientHeight - el.offsetTop - below;
      // (a table screen sizes its cards to this room: see displayCw)
      if (display && Math.abs(room - middleRoom) >= 4) middleRoom = room;
      const { h, w } = extent();
      // (too tall, or too wide: a showdown's two seven-card hands side by side on a phone)
      const k = Math.min(1, room / Math.max(1, h), main.clientWidth / Math.max(1, w, el.offsetWidth));
      // (a table screen lets the middle run a few percent past its box into the oval, rather than
      // shrink everything by a hair and back as melds land)
      const want = display && k >= 0.96 ? 1 : Math.max(0.6, Math.min(1, k));
      // (a table screen's strip of melds: the height from its top to the foot of the middle, which
      // stripFit sizes the melds to fill; read at full size, as the scale would shrink it)
      const strip = el.querySelector<HTMLElement>(':scope > .strip, :scope > .strip-room');
      if (strip && display) {
        const now = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
        const space = Math.floor(main.clientHeight - (strip.getBoundingClientRect().top - main.getBoundingClientRect().top) / now - 8);
        if (Math.abs(space - stripSpace) >= 4) stripSpace = space;
      }
      // the dummy's cards grow as it empties: only into the height that's spare, not past it
      const card = el.querySelector<HTMLElement>('.handdown .scard');
      if (card?.offsetHeight) {
        const max = Math.floor((card.offsetWidth * (card.offsetHeight + room - h)) / card.offsetHeight);
        if (Math.abs(max - growTo) >= 1) growTo = max;
      }
      // (back to full size at once; smaller only once it's lasted a moment, so the brief overflow
      // as a meld lands, before the sizes catch up, doesn't make the middle twitch. A pile that
      // has just appeared, bridge's dummy, is drawn at its size from the start.)
      clearTimeout(settle);
      const set = () => (el.style.transform = want < 0.999 ? `scale(${want.toFixed(3)})` : '');
      const now = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
      const piles = el.children.length;
      if (want >= now || piles !== seen) set();
      else settle = window.setTimeout(set, 250);
      seen = piles;
    };
    let settle = 0;
    let frame = 0;
    let seen = el.children.length;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const ro = new ResizeObserver(later);
    ro.observe(el);
    ro.observe(main);
    // (a card or a longer label changes what's inside without changing the box)
    const mo = new MutationObserver(later);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    // (and what comes and goes below it: the hand's summary)
    mo.observe(main, { childList: true });
    return {
      destroy: () => {
        cancelAnimationFrame(frame);
        clearTimeout(settle);
        ro.disconnect();
        mo.disconnect();
      },
    };
  }
  /**
   * A row that scrolls sideways (everyone's melds, face-up cards) fades out at an edge with more
   * beyond it, so a third player's cards past the edge aren't simply missing.
   */
  function edgeFade(el: HTMLElement) {
    const update = () => {
      el.classList.toggle('more-left', el.scrollLeft > 2);
      el.classList.toggle('more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener('scroll', update, { passive: true });
    return {
      destroy() {
        ro.disconnect();
        mo.disconnect();
        el.removeEventListener('scroll', update);
      },
    };
  }

  /** Opponents in turn order starting to your left. */
  const others = $derived.by(() => {
    if (you < 0) return s.players.map((_, i) => i);
    return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
  });

  const myHandZone = $derived(you >= 0 ? s.zones[`hand:${you}`] : undefined);
  const dealtHand = $derived(you >= 0 ? (s.zones[`hand:${you}`]?.cards ?? []) : []);
  /** How this device sorts your hand, and where you've dragged cards to (by id; see arrangeHand). */
  let handSort = $state<HandSort>(handSortOn());
  /** A notification when it's your turn and you're elsewhere (see turnAlert.ts). */
  let turnAlerts = $state(turnAlertsOn());
  let handOrder = $state<string[]>([]);
  const myHand = $derived(arrangeHand(dealtHand, handSort, handOrder));
  /**
   * Hands turned over at a showdown (poker), laid out in the middle beside the board, labelled with
   * who and what they hold: the cards move there from the seat (which shows none meanwhile).
   */
  const showdownZones = $derived(
    (status.showdown ?? [])
      .map(({ seat, label, zones }): ZoneState => ({
        id: `showdown:${seat}`,
        base: 'showdown',
        owner: seat,
        label,
        visibility: 'all',
        layout: 'spread',
        area: 'center',
        cards: zones.flatMap((id) => s.zones[id]?.cards ?? []),
      }))
      .filter((z) => z.cards.length),
  );
  const shownDownSeats = $derived(new Set(showdownZones.map((z) => z.owner)));
  /** The zones whose cards are on show in the middle: not shown elsewhere meanwhile. */
  const shownDownZones = $derived(new Set((status.showdown ?? []).flatMap((x) => x.zones)));
  /**
   * A hand laid face up on the table (bridge's dummy) that has emptied keeps its room until the
   * middle is clear: its last card goes to the last trick, which would otherwise jump up into its
   * place and grow, for that one trick.
   */
  let keptRoom = $state<string[]>([]);
  $effect(() => {
    const centre = Object.values(s.zones).filter((z) => z.area === 'center');
    const down = centre.filter((z) => z.faceUpHand && z.cards.length && !keptRoom.includes(z.id)).map((z) => z.id);
    if (down.length) keptRoom = [...keptRoom, ...down];
    else if (keptRoom.length && centre.every((z) => !z.cards.length)) keptRoom = [];
  });
  const allCenterZones = $derived([
    ...Object.values(s.zones).filter((z) => z.area === 'center' && !(z.hideEmpty && !z.cards.length && !keptRoom.includes(z.id))),
    ...showdownZones,
  ]);
  /** Zones on the compact strip along the bottom of the table (e.g. everyone's melds). */
  const allStripZones = $derived(Object.values(s.zones).filter((z) => z.area === 'strip' && !(z.hideEmpty && !z.cards.length) && !shownDownZones.has(z.id)));
  const seatZone = (seat: number) => (shownDownSeats.has(seat) ? [] : (s.zones[`hand:${seat}`]?.cards ?? []));

  // ---- selection --------------------------------------------------------------------------
  let selected = $state<string[]>([]);
  const selecting = $derived(view.actions.filter((a) => a.select));
  const selectable = $derived(selecting.length ? new Set(selecting.flatMap((a) => a.select!.cards)) : null);
  const quick = $derived(view.actions.find((a) => a.quick && a.select));
  const maxSelect = $derived(Math.max(0, ...selecting.map((a) => a.select!.max)));

  // drop selections that are no longer valid after each update
  $effect(() => {
    const valid = selectable;
    const keep = selected.filter((id) => valid?.has(id));
    if (keep.length !== selected.length) selected = keep;
  });

  /** Whose move it is (the declarer moves for the dummy in bridge). */
  const actor = $derived(status.actor ?? s.turn);
  // nudge when it becomes your turn
  let lastTurn = -1;
  let lastActor = -1;
  $effect(() => {
    if (actor === you && (lastActor !== you || s.turn !== lastTurn) && you >= 0 && !replay) {
      haptic(18);
      sound('turn');
      raiseTurn(game.config.name);
    } else if (actor !== you) clearTurn();
    lastTurn = s.turn ?? -1;
    lastActor = actor ?? -1;
  });

  function tap(id: string) {
    if (!selectable?.has(id)) {
      // (with the hints off nothing looks unplayable, so a tap on such a card says why nothing happens)
      if (!hints && selectable && fanCards.some((c) => c.id === id)) app.say('That card can’t be played right now');
      return;
    }
    if (selected.includes(id)) {
      // tapping a lone selected card plays it, unless the action is swipe-only
      if (quick?.quick === true && selected.length === 1 && quick.select!.cards.includes(id)) return run(quick);
      selected = selected.filter((x) => x !== id);
    } else if (maxSelect === 1) {
      selected = [id];
    } else if (selected.length < maxSelect) {
      selected = [...selected, id];
    }
    haptic(5);
  }

  function swipe(id: string) {
    if (!quick || !quick.select!.cards.includes(id)) return tap(id);
    const sel = selected.includes(id) && selected.length <= quick.select!.max ? selected : [id];
    run(quick, undefined, sel);
  }

  // ---- real-time games: how quickly you reacted, timed on this device ----------------------
  /** When the current `status.race` first showed on this screen (after it was drawn). */
  let raceSeen = { race: -1, at: 0 };
  $effect(() => {
    const race = status.race;
    if (race === undefined || race === raceSeen.race) return;
    const at = performance.now();
    raceSeen = { race, at };
    // count from when it was painted, not from when the message arrived
    requestAnimationFrame(() => {
      if (raceSeen.race === race) raceSeen.at = Math.max(at, performance.now());
    });
  });

  /** The space bar slaps (on a laptop at the table). */
  const slapSpec = $derived(view.actions.find((a) => a.react && !a.select && !a.target && !a.choose));
  function onkey(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat || !slapSpec || display) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select')) return;
    e.preventDefault();
    run(slapSpec);
  }

  /**
   * Cards that came into your hand (drawn, picked up, passed to you) stay marked until you next
   * act, so you can see what you got. Not a whole new hand being dealt: every card is new then.
   * (Worked out here from your hand, before and after: no game has to say.)
   */
  let freshIds = $state<string[]>([]);
  let handBefore: string[] | null = null;
  $effect(() => {
    const now = myHand.map((c) => c.id);
    const before = handBefore;
    handBefore = now;
    if (replay || !before) return;
    const had = new Set(before);
    const gained = now.filter((id) => !had.has(id) && !isHidden(id));
    // (a new deal: none of the old hand is left, or a few cards at most beside a lot of new ones)
    const kept = now.length - gained.length;
    if (gained.length && (kept === 0 || (gained.length >= 5 && kept <= 2))) {
      freshIds = [];
      return;
    }
    const still = freshIds.filter((id) => now.includes(id));
    if (gained.length) freshIds = [...still, ...gained];
    else if (still.length !== freshIds.length) freshIds = still;
  });
  function run(spec: ActionSpec, amount?: number, cards = selected, seat?: number) {
    freshIds = [];
    const timing = spec.react && status.race !== undefined ? { race: status.race, rt: Math.round(Math.max(0, performance.now() - raceSeen.at)) } : {};
    app.act({ type: spec.type, cards: spec.select ? [...cards] : undefined, amount, seat, ...timing });
    if (spec.select) selected = [];
    haptic(spec.react ? 25 : 10);
  }

  /** Actions triggered by tapping a pile (draw from the deck, take the discard…). */
  /** Tapping a pile: its action (draw, take…), or, with cards selected, putting them there (Kings Corners). */
  const zoneAction = (zoneId: string) =>
    view.actions.find(
      (a) =>
        a.zone === zoneId &&
        (!a.select || (selected.length >= a.select.min && selected.length <= a.select.max && selected.every((c) => a.select!.cards.includes(c)))),
    );
  /** In hand mode only piles you can use right now stay on the phone (e.g. the deck to draw from, a bridge dummy). */
  const usable = (z: (typeof allCenterZones)[number]) => !!zoneAction(z.id) || z.cards.some((c) => selectable?.has(c.id));
  // (in a real-time game you react to the piles, so they stay put on the phone: watching the TV
  // instead would also time your reaction from the wrong screen)
  const centerZones = $derived(handMode && !game.realtime ? allCenterZones.filter(usable) : allCenterZones);
  /**
   * The strip scrolls sideways, so what's yours to play from comes first, then your own, then
   * everyone else's around from your left: in Palace your face-up and face-down cards (all you
   * have left to play) never sit past the edge.
   */
  /**
   * Piles with places on the table (Kings Corners' cross): a big screen lays them out so; a phone on
   * its side, short of height, puts them in one row in reading order, as wide as fits.
   */
  const gridded = $derived(size.isGridded(centerZones));
  const cross = $derived(gridded && !side);
  const shownCenter = $derived(gridded ? [...centerZones].sort((a, b) => a.grid![0] - b.grid![0] || a.grid![1] - b.grid![1]) : centerZones);
  /** One row of placed piles on a phone: the widest card that lets them all fit across (with a little over for a wider label). */
  const rowFit = $derived(size.rowFit(centerZones, mainW, side));
  /**
   * A whole hand face up on the table that you're playing from now (bridge's dummy, for its
   * declarer): it takes your hand's place at the bottom, full size, and your own hand sits small in
   * its place in the middle until it's your own turn again.
   */
  const playFrom = $derived(display || you < 0 ? null : (centerZones.find((z) => z.faceUpHand && z.cards.some((c) => selectable?.has(c.id))) ?? null));
  const fanCards = $derived(playFrom ? playFrom.cards : myHand);
  /**
   * Every card on the table is drawn by one layer (CardLayer.svelte): each zone and your hand lay
   * their cards out in frames, which register here. When your hand and the dummy trade places,
   * their cards trade quietly rather than flying past each other.
   */
  const frames = new Frames();
  provideFrames(frames);
  $effect(() => {
    frames.calm = playFrom?.id ?? 'own';
  });
  /** How long the two hands take to trade places (none, for reduced motion). */
  const swapMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
  /**
   * The buttons sit beside the middle, so your hand has the whole width; when there are more of
   * them than fit there (poker's fold, call, raise, all in on a phone) they run down beside your
   * hand as well. (Counted, not measured: where they go mustn't change how many fit.)
   */
  const tallActions = $derived(
    size.tallActions({
      mainH,
      buttons: view.actions.filter((a) => !a.menu).length,
      menu: view.actions.some((a) => a.menu),
      track: !!status.track,
      handDone: !!view.handDone,
    }),
  );
  /**
   * …and once they've needed to in this part of the game (bridge's auction, say) on this screen,
   * they stay there till it moves on: the hand doesn't slide about from one turn to the next as
   * the buttons come and go, and is back to the full width for the play.
   */
  let tallFor = $state('');
  const tallKey = $derived(`${s.game}|${s.phase}|${vw}x${vh}`);
  // (only once they've not fitted for a moment: not for a frame mid-change between stages)
  $effect(() => {
    if (!tallActions || tallFor === tallKey) return;
    const key = tallKey;
    const t = setTimeout(() => (tallFor = key), 400);
    return () => clearTimeout(t);
  });
  const actionsBesideHand = $derived(tallActions || tallFor === tallKey);
  /**
   * Your hand is empty at a hand's end (all laid down, say): the middle gets its room. (Only once
   * the hand is over: in a trick game your hand empties as you play your last card, and the last
   * trick would grow for that one trick. Someone watching has no hand: the middle is theirs all along.)
   */
  const handEmpty = $derived(!display && myHandZone?.layout !== 'stack' && !fanCards.length && (!myHandZone || !!view.handDone));
  const stripZones = $derived.by(() => {
    const list = handMode ? allStripZones.filter(usable) : allStripZones;
    const rank = (z: (typeof list)[number]) => (usable(z) ? -2 : z.owner === you && you >= 0 ? -1 : z.owner == null ? n : (z.owner - Math.max(0, you) + n) % n);
    return list
      .map((z, i) => ({ z, i, r: rank(z) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.z);
  });
  /**
   * A table screen can't be scrolled, so there the strip (everyone's melds) wraps into rows across
   * the middle, with cards small enough that the longest set of melds fits a row. Through a hand
   * they only get smaller (once, as melds outgrow the row), never back and forth.
   */
  /** The height a table screen's strip of melds has, measured (see fitHeight). */
  let stripSpace = $state(0);
  const stripFit = $derived.by(() =>
    size.stripFit({ display, zones: stripZones, mainW, mainH, rem: tvRem, vw, stripSpace, centerCw, labels, whereOf: whereStrip }),
  );
  const stripCards = $derived(stripZones.reduce((t, z) => t + z.cards.length, 0));
  let stripKeep = $state({ cards: 0, cw: Infinity });
  $effect(() => {
    const cards = stripCards;
    const fit = stripFit;
    // (fewer cards in the melds than before: a new hand, so start afresh)
    if (cards < stripKeep.cards) stripKeep = { cards, cw: fit };
    else if (fit < stripKeep.cw) stripKeep = { cards, cw: fit };
    else if (cards !== stripKeep.cards) stripKeep.cards = cards;
  });
  /** The strip's cards' size against the middle's (its zones', or before the first meld, the game's). */
  const stripScale = $derived(
    Math.max(...(stripZones.length ? stripZones : Object.values(s.zones).filter((z) => z.area === 'strip')).map((z) => z.scale ?? 1), 0),
  );
  const stripCw = (z: { scale?: number }) => size.stripCw(z, { centerCw, display, kept: stripKeep.cw });
  /**
   * A place kept for the strip from the deal: the piles don't jump when the first meld goes down.
   * (A table screen's middle fills from the top and the strip grows downwards; a phone's strip is
   * one row, kept at its height.)
   */
  const stripRoom = $derived(!stripZones.length && hasStrip && (display || !handMode));

  // ---- table screen -----------------------------------------------------------------------
  /** On a table screen everything sized in rem grows with the screen (1rem = this many px). */
  // (a little smaller with lots of players, so seats don't collide around the oval)
  const tvRem = $derived(display ? Math.round(Math.max(16, Math.min(56, vw * (n > 6 ? 0.014 : 0.0175), vh * 0.031))) : 16);
  $effect(() => {
    if (!display) return;
    document.documentElement.style.fontSize = `${tvRem}px`;
    return () => {
      document.documentElement.style.fontSize = '';
    };
  });
  /** Seats sit around an oval in turn order, seat 0 at the bottom (matching where trick cards land). */
  // each seat's measured size, so a wide one is kept fully on screen instead of centred off the edge
  let slotW = $state<Record<number, number>>({});
  let slotH = $state<Record<number, number>>({});
  function tvSeatPos(seat: number) {
    const a = Math.PI / 2 + (seat * 2 * Math.PI) / n;
    const keep = (pct: number, size = 0) => `clamp(${size / 2 + 8}px, ${pct}%, calc(100% - ${size / 2 + 8}px))`;
    return { left: keep(50 + Math.cos(a) * 40, slotW[seat]), top: keep(50 + Math.sin(a) * 39, slotH[seat]) };
  }
  const handCw = $derived(size.handCw({ hand: cardSizes.hand, handMode, stripShown: stripZones.length > 0, pileOnly }));
  /**
   * Everyone's melds on the table (rummy games, stud's face-up cards): the middle runs to the
   * right-hand edge and the buttons sit beside your hand, two across when there are three or more,
   * so they're no taller than the hand.
   */
  // (from the deal, in a game with melds: the middle widening at the first meld would slide every pile across)
  const wideMiddle = $derived(!display && !handMode && !replay && (stripZones.length > 0 || hasStrip));
  const manyButtons = $derived(view.actions.filter((a) => !a.menu).length > 2);

  // ---- chrome -----------------------------------------------------------------------------
  let sheet = $state<'menu' | 'scores' | 'tv' | 'look' | 'save' | 'spread' | null>(null);
  /** The room the full-screen melds have (above your hand), measured. */
  let spreadW = $state(0);
  let spreadH = $state(0);
  /**
   * Everyone's melds full screen: the biggest cards that let them all fit the room, so a few melds
   * fill the screen; only past a readable smallest size does the page scroll.
   */
  const spreadCw = $derived(
    sheet === 'spread'
      ? size.spreadCw({
          zones: allStripZones,
          w: spreadW,
          h: spreadH,
          labels,
          whereOf: (z, cw) => ({
            cw,
            you,
            players: n,
            style: 'sheet',
            maxW: spreadW ? spreadW - 20 : Infinity,
            rowGap: 4.8,
            tap: tappable(z) ? TAP : undefined,
          }),
        })
      : 44,
  );
  // (your hand under them stays small: the melds are what you're looking at)
  const spreadHandCw = $derived(Math.max(MIN_CW, Math.min(52, Math.round(vh * 0.1))));
  // (nothing left to show: the full-screen view of the melds closes itself, e.g. at a new hand)
  $effect(() => {
    if (sheet === 'spread' && !allStripZones.length) sheet = null;
  });
  let bannerHidden = $state<number | null>(null);
  const showBanner = $derived(!!status.banner && bannerHidden !== s.v);
  // (remembered for the visit, so a new table doesn't ask again)
  const remembered = (key: string) => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const remember = (key: string) => {
    try {
      sessionStorage.setItem(key, '1');
    } catch {
      /* private mode: just this table */
    }
    return true;
  };
  let portraitOk = $state(remembered('cards.portraitOk'));
  let fullscreen = $state(!!document.fullscreenElement);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as any).lock?.('landscape').catch(() => {});
      }
    } catch {
      // (Safari on iPhone has no full screen for websites; an app added to the Home Screen does)
      app.say('Full screen isn’t available here — on iPhone, tap Share, then Add to Home Screen');
    }
  }

  // keep the screen awake while at the table
  $effect(() => keepAwake());
  // (leaving the table: no "your turn" left behind in the title)
  $effect(() => () => clearTurn());

  // ---- what just happened ------------------------------------------------------------------
  const lastEntry = $derived(s.log.at(-1));
  /** Latest player move, shown under the headline (unless the headline already says it). */
  // (not when the headline already says it, or the start of it: "Dash wins the pot (1213)" over
  // "Dash wins the pot (1213) with two pair")
  const lastMove = $derived(
    lastEntry &&
      !(status.headline ?? '').includes(lastEntry.text) &&
      !(status.headline ?? '').split(' · ').some((part) => part && lastEntry.text.startsWith(part))
      ? lastEntry
      : null,
  );

  /**
   * What a screen reader hears as the game goes on: each move, and when it's your turn. One region
   * that stays put (a region that's replaced each time is often not read at all).
   */
  const SUIT_WORDS: Record<string, string> = { '♠': ' spades', '♥': ' hearts', '♦': ' diamonds', '♣': ' clubs' };
  const announce = $derived(
    replay || display
      ? ''
      : [lastEntry?.text, you >= 0 && (actor === you || (actor == null && !game.realtime && view.actions.some((a) => !a.menu))) ? 'Your turn.' : '']
          .filter(Boolean)
          .join('. ')
          .replace(/[♠♥♦♣]/g, (x) => SUIT_WORDS[x]),
  );

  // ---- sounds: each new move on the table (on the big screen, when there is one), and the end
  let soundsOn = $state(soundOn());
  let fourColour = $state(fourColourOn());
  let hints = $state(hintsOn());
  // a table screen stays quiet when someone at the table has muted it (a Chromecast has no menu)
  const sound = (x: Sound) => (replay || (display && view.lobby.screenSound === false) ? undefined : playSound(x));
  const screenSoundOn = $derived(view.lobby.screenSound !== false);
  let heard = -1;
  function soundFor(e: { text: string; fromZone?: string; toZone?: string }): Sound | null {
    const t = e.text.toLowerCase();
    if (/\b(deals?|shuffles?)\b/.test(t)) return 'deal';
    if (showChips && /\b(bets?|raises?|calls?|all in|antes?|blinds?|wins?|splits?|doubles?|insures?|pays?)\b/.test(t)) return 'chips';
    if (e.toZone || e.fromZone || /\b(plays?|leads?|discards?|draws?|lays?|melds?|turns? (?:over|up)|slaps?|passes \d)\b/.test(t)) return 'card';
    return null;
  }
  $effect(() => {
    const e = lastEntry;
    if (!e || e.t === heard) return;
    const first = heard === -1;
    heard = e.t;
    // (not for what was already on the table when we arrived; in hand mode the big screen plays them)
    if (first || handMode) return;
    const snd = soundFor(e);
    if (snd) sound(snd);
  });
  let lastPhase: string | null = null;
  $effect(() => {
    if (s.phase === 'gameOver' && lastPhase != null && lastPhase !== 'gameOver') sound(display || s.winner?.includes(you) ? 'win' : 'end');
    lastPhase = s.phase;
  });
  /** Reactions showing on seats just now, by game seat (see REACTIONS). */
  let reacts = $state<Record<number, { text: string; key: number }>>({});
  $effect(() => {
    const r = app.reaction;
    if (!r || replay) return;
    const seat = (view.lobby.playing ?? []).indexOf(r.id);
    if (seat < 0) return;
    untrack(() => (reacts = { ...reacts, [seat]: { text: REACTIONS[r.e], key: r.at } }));
    setTimeout(() => {
      if (reacts[seat]?.key !== r.at) return;
      const rest = { ...reacts };
      delete rest[seat];
      reacts = rest;
    }, 3600);
  });
  let reacting = $state(false);
  const REACTION_NAMES = ['Thumbs up', 'Applause', 'Laughing', 'Wow', 'Yikes', 'On fire'];
  const saidBy = (seat: number) => reacts[seat] ?? (lastEntry?.seat === seat && lastEntry.short ? { text: lastEntry.short, key: lastEntry.t } : null);

  // Before the DOM updates, note where the acting player sits so cards fly to/from them.
  let tableEl: HTMLElement;
  let shownPlayFrom: string | null = null;
  $effect.pre(() => {
    const entry = s.log.at(-1);
    if (!tableEl) return;
    const rect = (seat: number | undefined) => {
      if (seat == null) return null;
      const el = seat === you ? tableEl.querySelector('.hand-wrap') : tableEl.querySelector(`[data-seat="${seat}"]`);
      return el?.getBoundingClientRect() ?? null;
    };
    // in hand mode the table is on the big screen: your own moves fly up toward it
    const anchor = () => {
      const h = tableEl.querySelector('.headline')?.getBoundingClientRect();
      return h ? new DOMRect(h.left + h.width / 2 - 24, h.top, 48, 67) : null;
    };
    flight.actor = handMode && entry?.seat === you ? anchor() : rect(entry?.seat);
    flight.to = rect(entry?.to);
    const pile = (id: string | undefined) => {
      if (!id) return null;
      const el = tableEl.querySelector(`[data-zone="${id}"] .stack`) ?? tableEl.querySelector(`[data-zone="${id}"]`);
      return el?.getBoundingClientRect() ?? (handMode ? anchor() : null);
    };
    flight.fromZone = pile(entry?.fromZone);
    flight.toZone = pile(entry?.toZone);
    // (the dummy and your hand about to trade places: the hands move as wholes, see the fan)
    const swapping = (playFrom?.id ?? null) !== shownPlayFrom;
    flight.quiet = swapping;
    shownPlayFrom = playFrom?.id ?? null;
    snapshot(tableEl);
  });
  // …and after it, slide whatever merely shifted into its new place: at once, before the screen
  // is next drawn (waiting for the next animation frame let a frame show the new places with no
  // slide, a jump and then the glide), and again on that frame, for anything that moved a beat
  // later (leaving cards being lifted out of their row, which Safari does after Chrome; what
  // already slides is where it was, so it isn't slid twice).
  $effect(() => {
    void s.v;
    const el = tableEl;
    if (!el) return;
    play(el);
    const frame = requestAnimationFrame(() => play(el));
    return () => cancelAnimationFrame(frame);
  });

  // ---- the players row (phones): scrolls sideways, and slides to whoever's turn it is ----------
  let seatsEl = $state<HTMLElement>();
  let moreLeft = $state(false);
  let moreRight = $state(false);
  function edges() {
    const el = seatsEl;
    if (!el) return;
    moreLeft = el.scrollLeft > 4;
    moreRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
  }
  $effect(() => {
    const el = seatsEl;
    const turn = actor;
    void [others.length, vw]; // (re-measure when these change)
    if (!el || display) return;
    const frame = requestAnimationFrame(() => {
      edges();
      const slot = turn == null ? null : (el.querySelector(`[data-seat="${turn}"]`)?.parentElement as HTMLElement | null);
      if (!slot || el.scrollWidth <= el.clientWidth) return;
      // centre the player whose turn it is
      const box = el.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const left = el.scrollLeft + r.left - box.left - (box.width - r.width) / 2;
      el.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  });

  /** The table seat (name, avatar, connection) of each player in the game, by game seat. */
  const lobbySeat = (seat: number) => {
    const id = view.lobby.playing?.[seat];
    return id ? view.lobby.seats.find((x) => x.id === id) : view.lobby.seats[seat];
  };
  /** Round-trip times come by table seat. */
  const pingOf = (seat: number) => {
    const at = view.lobby.seats.indexOf(lobbySeat(seat)!);
    return at >= 0 ? app.pings[at] : null;
  };
  const me = $derived(you >= 0 ? s.players[you] : null);
  /** Players who have dropped out mid-game with nobody playing for them: a bot can, until they're back. */
  const dropped = $derived(
    game.bot && !display && !replay
      ? s.players.flatMap((p, seat) => {
          const ls = lobbySeat(seat);
          return ls && !ls.bot && !ls.connected && !ls.standIn ? [{ seat, name: p.name }] : [];
        })
      : [],
  );
  /** The game hand by hand (see Lobby.scores): worth a chart once a hand or two is in. */
  const history = $derived(view.lobby.scores && view.lobby.scores.totals.length >= 2 ? view.lobby.scores : null);
  /**
   * What each player (or team) made or lost in the hand just finished, from the score history:
   * shown when the game's own result doesn't already say (poker's chips, mostly).
   */
  const recap = $derived.by(() => {
    if (!history || !view.handDone || replay) return null;
    if (status.banner?.lines.some((l) => l.includes('→'))) return null;
    const [prev, now] = history.totals.slice(-2);
    const parts = history.names.flatMap((name, j) => {
      const d = now[j] - prev[j];
      return d ? [`${name} ${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`] : [];
    });
    return parts.length ? parts.join(' · ') : null;
  });
  /** The hand's summary under the middle's piles (on a phone on its side it's in the column instead). */
  const recapShown = $derived(!!recap && !side && !(showBanner && status.banner));
  /** Game night standings, shown when a game ends. */
  const tonight = $derived(nightTotals(view.lobby.night));
  const myInfo = $derived(you >= 0 ? status.seats[you] : undefined);
</script>

<svelte:window onkeydown={onkey} bind:innerWidth={vw} bind:innerHeight={vh} onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<!-- whose turn it is and the last move: above the middle, or (a phone on its side) in the column on the left -->
{#snippet tableStatus()}
  {#if status.headline}<div class="headline" class:mine={actor === you && you >= 0} bind:clientHeight={headH}>
      {#if side}<span class="tip" use:marquee><span class="run"><SuitText text={status.headline} /></span></span>{:else}<SuitText text={status.headline} />{/if}
    </div>
  {:else if display}
    <!-- (a table screen keeps the headline's room too, between tricks say: the piles below stay put) -->
    <div class="headline" aria-hidden="true" style:visibility="hidden">&nbsp;</div>{/if}
  {#if lastMove && cardSizes.lastFits}
    {#key lastMove.t}
      <div class="last">
        {#if lastMove.seat != null}
          <AvatarBadge avatar={lobbySeat(lastMove.seat)?.avatar} name={s.players[lastMove.seat]?.name ?? ''} seat={lastMove.seat} size={16} />
        {/if}
        <span><SuitText text={lastMove.text} /></span>
      </div>
    {/key}
  {:else if display}
    <!-- (a table screen keeps the line's room when there's no last move: the piles below stay put) -->
    <div class="last" aria-hidden="true" style:visibility="hidden">&nbsp;</div>
  {/if}
{/snippet}

<div class="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>

<div
  class="table"
  class:display
  class:handmode={handMode}
  class:tall-actions={!!replay || actionsBesideHand}
  class:wide-middle={wideMiddle}
  class:many-buttons={wideMiddle && manyButtons}
  bind:this={tableEl}
  bind:clientHeight={tableClientH}
>
  <!-- top: menu + opponents + scores -->
  <header bind:clientHeight={headerH}>
    <button class="icon" onclick={() => (sheet = 'menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <div class="seats" class:more-left={moreLeft} class:more-right={moreRight} bind:this={seatsEl} onscroll={edges}>
      {#each others as seat (seat)}
        {@const pos = display ? tvSeatPos(seat) : null}
        <div class="seat-slot" style:left={pos?.left} style:top={pos?.top} bind:clientWidth={slotW[seat]} bind:clientHeight={slotH[seat]}>
          <Seat
            player={s.players[seat]}
            info={status.seats[seat]}
            cards={seatZone(seat)}
            turn={s.turn === seat}
            connected={lobbySeat(seat)?.connected ?? true}
            {showChips}
            compact={others.length > 4 || (others.length >= 3 && vw < 940 && !display)}
            avatar={lobbySeat(seat)?.avatar}
            relation={display ? null : seatRelation(you, seat, n)}
            said={saidBy(seat)}
            ping={lobbySeat(seat)?.host ? null : pingOf(seat)}
            scale={tvRem / 16}
            turnLabel={display}
          />
        </div>
      {/each}
    </div>
    {#if !display && !replay && view.lobby.seats.some((x) => x.id === app.cid)}
      <button class="icon" onclick={() => (reacting = !reacting)} aria-label="React" aria-expanded={reacting}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
          ><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" /><circle cx="9.2" cy="10" r=".6" fill="currentColor" /><circle
            cx="14.8"
            cy="10"
            r=".6"
            fill="currentColor"
          /></svg
        >
      </button>
      {#if reacting}
        <div class="reactbar panel" role="group" aria-label="Reactions">
          {#each REACTIONS as e, i (e)}
            <button
              onclick={() => {
                app.react(i);
                reacting = false;
              }}
              aria-label={REACTION_NAMES[i]}>{e}</button
            >
          {/each}
        </div>
      {/if}
    {/if}
    <button class="icon" onclick={() => (sheet = 'scores')} aria-label="Scores and log">
      <svg viewBox="0 0 24 24" width="20" height="20"
        ><path
          d="M7 4h10v3a5 5 0 0 1-10 0V4Zm5 8v4m-4 4h8m-4-4v4M7 6H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3"
          stroke="currentColor"
          stroke-width="1.8"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </button>
  </header>

  <!-- centre: shared zones, pot, headline -->
  <!-- tapping empty felt clears the selection (a touch shortcut; the Clear button is the accessible path) -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <main bind:clientWidth={mainW} bind:clientHeight={mainH} onclick={(e) => !(e.target as Element).closest('button, .card') && (selected = [])}>
    {#if status.track && display}<div class="track-wrap">
        <Track track={status.track} avatars={s.players.map((_, i) => lobbySeat(i)?.avatar)} />
      </div>{/if}
    {#if !side}{@render tableStatus()}{/if}
    {#if dropped.length}
      <div class="dropped" role="status">
        <span>{dropped.map((d) => d.name).join(' and ')} {dropped.length > 1 ? 'have' : 'has'} dropped out.</span>
        <button class="btn" onclick={() => dropped.forEach((d) => app.act({ type: STAND_IN, seat: d.seat }))}>
          {dropped.length > 1 ? 'Let bots play' : 'Let a bot play'}
        </button>
      </div>
    {/if}
    <!-- (data-middle-h: how tall the sizes reckoned the piles would stand, for tests and debugging: see layout/table.ts) -->
    <div
      class="zones"
      class:has-strip={stripZones.length > 0 || stripRoomShown}
      class:cross
      class:row-fit={rowFit < Infinity}
      use:fitHeight
      data-middle-h={mainW ? Math.round(middleAt(centerCw)) : undefined}
    >
      {#each shownCenter as z (playFrom?.id === z.id ? `mine:${z.id}` : z.id)}
        <div
          class="zone-slot"
          in:fade={{ duration: z.faceUpHand || z.id === `hand:${you}` ? swapMs : 0, delay: z.faceUpHand || z.id === `hand:${you}` ? swapMs * 0.6 : 0 }}
          style:grid-row={cross ? z.grid![0] + 1 : undefined}
          style:grid-column={cross ? z.grid![1] + 1 : undefined}
          style:min-width={z.faceUpHand ? `${Math.round(slotCw(z) * FULL_HAND)}px` : undefined}
        >
          <Zone
            zone={playFrom?.id === z.id ? { ...z, id: `hand:${you}`, label: 'Your hand', cards: myHand } : z}
            cw={slotCw(z)}
            {you}
            players={n}
            {selected}
            {selectable}
            ontap={tap}
            zoneActive={!!zoneAction(z.id)}
            place={!!zoneAction(z.id)?.select}
            onzone={zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined}
            fast={!!zoneAction(z.id)?.react}
            {roomy}
            growTo={display ? 0 : growTo}
            steady={display}
            room={mainW ? mainW - 4 : Infinity}
          />
        </div>
      {/each}
      {#if status.pot && !handMode}
        <div class="pot" data-flip bind:offsetWidth={potW} bind:offsetHeight={potH}>
          <div class="chipstack" aria-hidden="true">
            {#each { length: Math.min(6, Math.ceil(Math.log2(status.pot + 1))) } as _, i (i)}
              <span style:bottom="{i * 4}px" style:--c={seatColor(i * 3)}></span>
            {/each}
          </div>
          <div>
            <div class="eyebrow">Pot</div>
            <b>{status.pot.toLocaleString()}</b>
          </div>
        </div>
      {/if}
      {#if stripRoomShown}
        <!-- (where everyone's melds will go, kept from the deal) -->
        <div class="strip-room" aria-hidden="true" style:height={display ? undefined : `${Math.round(1.4 * stripCw({ scale: stripScale }) + 30)}px`}></div>
      {:else if stripZones.length}
        <div class="strip" data-wide={display || undefined} use:edgeFade>
          {#if !display && !replay}
            <!-- (a phone's strip is a sliver: everyone's melds full screen, to browse and play onto) -->
            <button class="spread-open" onclick={() => (sheet = 'spread')} aria-label="See it all, full screen" title="See it all, full screen">⤢</button>
          {/if}
          {#each stripZones as z (z.id)}
            <Zone
              zone={z}
              cw={stripCw(z)}
              style="strip"
              room={display && mainW ? mainW * 1.2 - 1.6 * tvRem : Infinity}
              rowGap={display ? 0.3 * tvRem : undefined}
              {you}
              players={n}
              {selected}
              {selectable}
              ontap={tap}
              zoneActive={!!zoneAction(z.id)}
              place={!!zoneAction(z.id)?.select}
              onzone={zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined}
              fast={!!zoneAction(z.id)?.react}
            />
          {/each}
        </div>
      {/if}
    </div>

    {#if recapShown}
      <p class="recap" aria-label="This hand: {recap}" bind:clientHeight={recapH}>This hand: {recap}</p>
    {/if}
    {#if showBanner && status.banner}
      <div class="banner panel">
        <button class="close" onclick={() => (bannerHidden = s.v)} aria-label="Hide">×</button>
        <h2>{status.banner.title}</h2>
        <div class="lines" class:cols={status.banner.lines.length > 5}>
          {#each status.banner.lines as line, k (k)}<p><SuitText text={line} /></p>{/each}
        </div>
        {#if recap}<p class="recap-line">This hand: {recap}</p>{/if}
        {#if (view.handDone || (s.phase === 'gameOver' && history)) && !display && !replay}
          <div class="banner-btns">
            {#if view.handDone}<button class="btn small-btn" onclick={() => app.showReplay(0, 0)}>Replay this hand</button>{/if}
            {#if s.phase === 'gameOver' && history}<button class="btn small-btn" onclick={() => (sheet = 'scores')}>How it went</button>{/if}
          </div>
        {/if}
        {#if s.phase === 'gameOver' && tonight.length}
          <!-- top four, so a nine-player night still fits -->
          <p class="tonight">
            Tonight: {tonight
              .slice(0, 4)
              .map((r) => `${r.name} ${r.points}`)
              .join(' · ')}{tonight.length > 4 ? ` · +${tonight.length - 4} more` : ''}
          </p>
        {/if}
        {#if s.phase === 'gameOver' && !display}
          <!-- one quiet line, only when a game is over (never during play) -->
          <p class="support">Enjoyed that? Lamplight is free and ad-free — <a href={SUPPORT_URL} target="_blank" rel="noreferrer">buy us a beer 🍺</a></p>
        {/if}
      </div>
    {/if}
  </main>

  <!-- you: a column of your own beside the middle, above your hand, so your hand has the whole width -->
  {#if !display}
    <section class="me" class:side aria-label="You">
      {#if side}
        <div class="side-status" use:fitSide>
          {@render tableStatus()}
          <!-- (the hand's summary: here on a phone held sideways, where the column is free once the hand
               is over, rather than under the middle, where a big showdown needs every bit of the height) -->
          {#if recap && !(showBanner && status.banner)}<p class="recap" aria-label="This hand: {recap}" bind:clientHeight={sideRecapH}>
              This hand: {recap}
            </p>{/if}
        </div>
      {/if}
      <div class="me-own" bind:clientHeight={meOwnH}>
        {#if me}
          <div class="me-name">
            {#if reacts[you]}{#key reacts[you].key}<span class="my-react" aria-hidden="true">{reacts[you].text}</span>{/key}{/if}
            <AvatarBadge avatar={lobbySeat(you)?.avatar} name={me.name} seat={you} size={24} /><span class="mn">{me.name}</span>
            {#if myInfo?.tag}<span class="mytag">{myInfo.tag}</span>{/if}
          </div>
          <div class="me-sub">
            {#if showChips}<span><b>{me.chips.toLocaleString()}</b> chips</span>{/if}
            {#if myInfo?.badge}<span class="gold"><SuitText text={myInfo.badge} /></span>{/if}
          </div>
          {#if status.hint}<div class="hint"><SuitText text={status.hint} /></div>{/if}
        {:else}
          <!-- (at the table but not in this game: you're in the next one) -->
          <div class="me-sub">{view.lobby.seats.some((x) => x.id === app.cid) ? 'Sitting this one out — you’re in the next game' : 'Watching'}</div>
        {/if}
      </div>
    </section>
  {/if}

  {#if !display}
    <!-- bottom: my hand, info and actions -->
    <footer>
      <!-- bigger fanned cards tip further past the ends: keep them clear of the buttons -->
      <div class="hand-wrap" style:padding-inline={handMode ? `${Math.round(handCw * 0.3)}px` : undefined}>
        {#if myHandZone?.layout === 'stack'}
          <!-- a face-down pile instead of a hand (slap games): tap it to turn up your top card -->
          <Zone
            zone={myHandZone}
            cw={handCw}
            {you}
            players={n}
            {selected}
            {selectable}
            ontap={tap}
            zoneActive={!!zoneAction(myHandZone.id)}
            onzone={zoneAction(myHandZone.id) ? () => run(zoneAction(myHandZone.id)!) : undefined}
            fast={!!zoneAction(myHandZone.id)?.react}
          />
        {:else}
          <!-- (your hand and the dummy trade places quietly: see frames.calm) -->
          <div class="fan">
            {#if playFrom?.label}<div class="fan-label eyebrow">{playFrom.label}</div>{/if}
            <Hand
              cards={fanCards}
              cw={handCw}
              zone={playFrom?.id ?? `hand:${you}`}
              {selected}
              {selectable}
              fresh={playFrom ? [] : freshIds}
              {hints}
              ontap={tap}
              onswipe={swipe}
              onreorder={playFrom ? undefined : (ids) => (handOrder = ids)}
            />
          </div>
        {/if}
      </div>
    </footer>
    <aside bind:offsetHeight={asideH}>
      {#if status.track && !display}
        <!-- (the board is on a TV, and in the scores: here just the numbers, in the race to the target) -->
        <div class="race" aria-label="Score">
          <div class="eyebrow">To {status.track.target}</div>
          {#each status.track.lanes as lane (lane.label)}
            {@const lead = lane.score === Math.max(...status.track.lanes.map((l) => l.score)) && lane.score > 0}
            <div class="race-lane" class:lead style:--c={lobbySeat(lane.seat)?.avatar?.color ?? seatColor(lane.seat)}>
              <span class="ln">{lane.label}</span><b>{lane.score}</b>
            </div>
          {/each}
        </div>
      {/if}
      <!-- (a hand over without a result banner, e.g. everyone folded: offer the replay here) -->
      {#if view.handDone && !(showBanner && status.banner) && !replay}
        <button class="btn quiet small-btn replay-quick" onclick={() => app.showReplay(0, 0)}>Replay hand</button>
      {/if}
      <!-- (in a replay there's nothing to do but watch: the replay's controls get the whole column) -->
      {#if replay}<ReplayBar frame={replay} />{:else}<ActionBar
          actions={view.actions}
          {selected}
          pot={status.pot}
          onact={(spec, amount, seat) => run(spec, amount, selected, seat)}
          onclear={() => (selected = [])}
          seatInfo={(seat) => ({
            name: s.players[seat]?.name ?? '',
            avatar: lobbySeat(seat)?.avatar,
            relation: seatRelation(you, seat, n),
          })}
        />{/if}
    </aside>
  {/if}
  <CardLayer {frames} {you} entry={s.log.at(-1)} />
</div>

{#if !portraitOk && !display}
  <div class="rotate">
    <div class="phone"></div>
    <p>Turn your phone sideways for the best view</p>
    <button class="btn quiet" onclick={() => (portraitOk = remember('cards.portraitOk'))}>Continue anyway</button>
  </div>
{/if}

{#if sheet === 'spread'}
  <Sheet title="On the table" full onclose={() => (sheet = null)}>
    <div class="spread-all" bind:clientWidth={spreadW} bind:clientHeight={spreadH}>
      {#each allStripZones as z (z.id)}
        <Zone
          zone={z}
          cw={spreadCw}
          inline
          style="sheet"
          room={spreadW ? spreadW - 20 : Infinity}
          rowGap={4.8}
          {you}
          players={n}
          {selected}
          {selectable}
          ontap={tap}
          zoneActive={!!zoneAction(z.id)}
          place={!!zoneAction(z.id)?.select}
          onzone={zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined}
          fast={!!zoneAction(z.id)?.react}
        />
      {/each}
    </div>
    <!-- (your hand and your moves, so you can meld and lay off from here) -->
    <div class="spread-dock">
      <div class="spread-hand">
        <Hand cards={myHand} cw={spreadHandCw} inline {selected} {selectable} {hints} ontap={tap} onswipe={swipe} onreorder={(ids) => (handOrder = ids)} />
      </div>
      <div class="spread-acts">
        <ActionBar
          actions={view.actions}
          {selected}
          pot={status.pot}
          onact={(spec, amount, seat) => run(spec, amount, selected, seat)}
          onclear={() => (selected = [])}
          seatInfo={(seat) => ({
            name: s.players[seat]?.name ?? '',
            avatar: lobbySeat(seat)?.avatar,
            relation: seatRelation(you, seat, n),
          })}
        />
      </div>
    </div>
  </Sheet>
{:else if sheet === 'tv'}
  <TvSheet table={view.lobby.code} onclose={() => (sheet = null)} />
{/if}

{#if sheet === 'menu'}
  <Sheet title="Table {view.lobby.code}" onclose={() => (sheet = null)}>
    <div class="menu-list">
      <button class="btn" onclick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
      <button
        class="btn"
        onclick={() => {
          soundsOn = !soundsOn;
          setSound(soundsOn);
        }}>{display ? (soundsOn ? 'Sound here: on' : 'Sound here: off') : soundsOn ? 'Sound: on' : 'Sound: off'}</button
      >
      {#if !display}
        <button
          class="btn"
          onclick={() => {
            fourColour = !fourColour;
            setFourColour(fourColour);
          }}>{fourColour ? 'Four-colour suits: on' : 'Four-colour suits: off'}</button
        >
        <button
          class="btn"
          onclick={() => {
            hints = !hints;
            setHints(hints);
          }}>{hints ? 'Show playable cards: on' : 'Show playable cards: off'}</button
        >
        {#if canNotify()}
          <button class="btn" onclick={async () => (turnAlerts = await setTurnAlerts(!turnAlerts))}
            >{turnAlerts ? 'Turn notifications: on' : 'Turn notifications: off'}</button
          >
        {/if}
        <button
          class="btn"
          onclick={() => {
            handSort = HAND_SORTS[(HAND_SORTS.indexOf(handSort) + 1) % HAND_SORTS.length];
            setHandSort(handSort);
            handOrder = [];
          }}>Hand: {HAND_SORT_LABEL[handSort]}</button
        >
      {/if}
      {#if view.lobby.displays && !display}
        <button class="btn" onclick={() => app.act({ type: SCREEN_SOUND, amount: screenSoundOn ? 0 : 1 })}
          >{screenSoundOn ? 'TV sound: on' : 'TV sound: off'}</button
        >
      {/if}
      {#if view.lobby.displays && !display}
        <button
          class="btn"
          onclick={() => {
            app.setHandMode(!app.handMode);
            sheet = null;
          }}
        >
          {app.handMode ? 'Show whole table' : 'Just my hand'}
        </button>
      {/if}
      {#if view.replays && !display && !replay}
        <button
          class="btn"
          onclick={() => {
            app.showReplay(0, 0);
            sheet = null;
          }}>Replay the last hand</button
        >
      {/if}
      {#if !display && !game.realtime}<button class="btn" onclick={() => (sheet = 'save')}>Save this game</button>{/if}
      {#if !display}<button class="btn" onclick={() => (sheet = 'tv')}>Show on a TV</button>{/if}
      {#if app.controls}<button class="btn" onclick={() => (sheet = 'look')}>Card backs & cloth</button>{/if}
      <button
        class="btn"
        onclick={() => {
          navigator.clipboard?.writeText(inviteUrl(view.lobby.code));
          app.say('Invite link copied');
        }}>Copy invite link</button
      >
      {#if app.controls}
        <button
          class="btn good"
          onclick={() => {
            app.controls?.endGame();
            sheet = null;
          }}>Back to lobby</button
        >
      {/if}
      <a class="btn" href={bugReportLink({ game: game.config.name, table: view.lobby.code })}>Report a problem</a>
      <button
        class="btn danger"
        onclick={() => {
          app.leave();
          app.go('/');
        }}>{app.isHost ? 'Close table' : 'Leave table'}</button
      >
    </div>
    {#if rules.length}
      <div class="eyebrow">How to play {game.config.name}</div>
      <ul class="rules">
        {#each rules as r, k (k)}<li>{r}</li>{/each}
      </ul>
    {/if}
  </Sheet>
{:else if sheet === 'save'}
  <Sheet title="Save this game" onclose={() => (sheet = null)}>
    <!-- the spreadsheet for every game; bridge and poker have their own standard records too -->
    <div class="save-list">
      {#each ['csv' as const, ...recordFormats(game.config)] as format (format)}
        <button
          class="btn save"
          onclick={() => {
            app.exportGame(format);
            sheet = null;
          }}
        >
          <b>{EXPORT_LABEL[format]} <span class="ext">.{EXPORT_FILE[format].ext}</span></b>
          <span class="about">{EXPORT_ABOUT[format]}</span>
        </button>
      {/each}
    </div>
    <p class="save-note">Only your own cards are in it, and the cards everyone saw.</p>
  </Sheet>
{:else if sheet === 'look'}
  <Sheet title="The table's look" onclose={() => (sheet = null)}>
    <LookPicker look={view.lobby.look} onpick={app.controls ? (l) => app.controls?.setLook(l) : undefined} />
  </Sheet>
{:else if sheet === 'scores'}
  <Sheet title="Scores" onclose={() => (sheet = null)}>
    {#if status.track}<div class="sheet-track"><Track track={status.track} avatars={s.players.map((_, i) => lobbySeat(i)?.avatar)} /></div>{/if}
    {#if status.scoreboard}
      <table class="scores">
        <thead
          ><tr
            ><th></th>{#each status.scoreboard.columns as c, k (k)}<th>{c}</th>{/each}</tr
          ></thead
        >
        <tbody>
          {#each status.scoreboard.rows as r, k (k)}
            <tr class:hl={r.highlight}
              ><td>{r.name}</td>{#each r.values as v, j (j)}<td><SuitText text={v} /></td>{/each}</tr
            >
          {/each}
        </tbody>
      </table>
    {:else if showChips}
      <table class="scores">
        <tbody>
          {#each [...s.players].sort((a, b) => b.chips - a.chips) as p (p.seat)}
            <tr><td>{p.name}</td><td>{p.chips.toLocaleString()}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if history}
      <div class="eyebrow">Hand by hand</div>
      <ScoreChart {history} />
    {/if}
    {#if view.lobby.night?.games.length}
      <div class="eyebrow">Game night</div>
      <NightBoard night={view.lobby.night} seats={view.lobby.seats} />
      <div style:height="1rem"></div>
    {/if}
    <div class="eyebrow">Recent</div>
    <ol class="log">
      {#each [...s.log].reverse().slice(0, 14) as l, k (k)}<li><SuitText text={l.text} /></li>{/each}
    </ol>
  </Sheet>
{/if}

<style>
  .table {
    position: absolute;
    inset: 0;
    display: grid;
    /* (minmax: a long row of cards scrolls inside the middle instead of widening the screen) */
    grid-template-columns: auto minmax(0, 1fr) auto;
    /* (minmax: the middle's cards fit its room rather than pushing the rows apart) */
    grid-template-rows: auto minmax(0, 1fr) auto;
    /* (you beside the middle, not beside your hand: the hand gets the whole width) */
    grid-template-areas:
      'top top top'
      'me center actions'
      'hand hand hand';
    padding: calc(6px + var(--safe-t)) calc(10px + var(--safe-r)) calc(4px + var(--safe-b)) calc(10px + var(--safe-l));
    gap: 4px 10px;
    /* clip, not hidden: nothing (a focused button, a card scrolled into view) can shift the table sideways */
    overflow: clip;
  }
  /* hand mode: the middle shrinks to the headline (and any pile you can tap); the hand grows */
  /* the buttons beside the middle (mirroring you on the left), so your hand has the whole width;
     but down beside the hand too when they don't fit there, in a replay (its controls are tall,
     and there's nothing to play) and in hand mode (the middle is only a line tall) */
  .table.tall-actions,
  .table.handmode {
    grid-template-areas:
      'top top top'
      'me center actions'
      'hand hand actions';
  }
  /* everyone's melds on the table (rummy games): they're what you play onto, so the middle runs
     to the right-hand edge and the buttons sit in line with your hand */
  .table.wide-middle {
    grid-template-areas:
      'top top top'
      'me center center'
      'hand hand actions';
  }
  /* (at the foot of your hand's row, as tall as its buttons: not stretched to the row, so the
     table's sizes can count on its height: see layout/table.ts) */
  .table.wide-middle aside {
    align-self: end;
  }
  .table.wide-middle aside :global(.bar) {
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .table.wide-middle aside :global(.bar .btn) {
    min-height: 40px;
    padding-block: 0.25em;
  }
  .table.many-buttons aside {
    width: clamp(220px, 34vw, 340px);
  }
  .table.many-buttons aside :global(.bar) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: end;
  }
  .table.handmode {
    grid-template-rows: auto auto 1fr;
  }
  .table.handmode main {
    padding-top: 4px;
  }
  .table.handmode footer {
    align-self: end;
  }
  .table.handmode .me {
    font-size: 0.9rem;
  }
  /* ---- table screen: an oval table filling the screen, players around it ---- */
  .table.display {
    display: block;
    padding: 0;
  }
  .table.display::before {
    content: '';
    position: absolute;
    inset: 9% 7%;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 45%, rgba(255, 214, 140, 0.1), transparent 70%);
    box-shadow:
      inset 0 0 0 0.35rem rgba(0, 0, 0, 0.22),
      inset 0 0 3rem rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .table.display header {
    position: absolute;
    inset: 0;
    display: block;
    pointer-events: none;
  }
  .table.display header > .icon {
    position: absolute;
    top: 1rem;
    left: 1rem;
    width: 2.4rem;
    height: 2.4rem;
    pointer-events: auto;
  }
  .table.display header > .icon :global(svg) {
    width: 1.2rem;
    height: 1.2rem;
  }
  .table.display header > .icon:last-child {
    left: auto;
    right: 1rem;
  }
  .table.display .seats {
    position: absolute;
    inset: 0;
    display: block;
    padding: 0;
    margin: 0;
    overflow: visible;
  }
  /* seats keep their size; a row too long for the screen scrolls (and follows the turn) */
  .seat-slot {
    flex: none;
    display: flex;
  }
  /* fade the edge where more players are scrolled out of view */
  .seats.more-left {
    --fade: linear-gradient(90deg, transparent, #000 28px);
  }
  .seats.more-right {
    --fade: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
  }
  .seats.more-left.more-right {
    --fade: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  }
  .seats.more-left,
  .seats.more-right {
    -webkit-mask-image: var(--fade);
    mask-image: var(--fade);
  }
  .table.display .seat-slot {
    position: absolute;
    transform: translate(-50%, -50%);
  }
  .table.display main {
    position: absolute;
    inset: 17% 21%;
    gap: 0.6rem;
  }
  /* (with a strip of melds that grows through the hand, the middle fills from the top: the piles
     stay put as it grows, instead of the whole middle re-centring) */
  .table.display main:has(.zones.has-strip) {
    justify-content: flex-start;
    padding-top: 1rem;
  }
  .table.display .headline {
    font-size: 1.15rem;
    padding: 0.4rem 1.2rem;
  }
  .table.display .last {
    font-size: 0.95rem;
  }
  header {
    grid-area: top;
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seats {
    flex: 1;
    display: flex;
    /* centred with auto margins (below), so a row too wide to fit scrolls instead of being cut off at both ends */
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    /* extra room below (overlapping the table) so speech bubbles aren't clipped */
    padding: 10px 2px 40px;
    margin-bottom: -34px;
    pointer-events: none;
  }
  .seats > :global(*) {
    pointer-events: auto;
  }
  .seats > :global(:first-child) {
    margin-left: auto;
  }
  .seats > :global(:last-child) {
    margin-right: auto;
  }
  .icon {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--glass);
    border: 1px solid var(--line);
    color: var(--ink-dim);
  }
  main {
    grid-area: center;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 0;
    min-width: 0;
  }
  .reactbar {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
  }
  .reactbar button {
    font-size: 1.35rem;
    line-height: 1;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .reactbar button:hover,
  .reactbar button:focus-visible {
    background: rgba(255, 255, 255, 0.12);
  }
  .my-react {
    position: absolute;
    left: 0;
    bottom: 100%;
    font-size: 1.5rem;
    pointer-events: none;
    animation: my-react 3.6s var(--ease-out) forwards;
  }
  @keyframes my-react {
    0% {
      opacity: 0;
      transform: translateY(6px) scale(0.6);
    }
    10%,
    75% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .my-react {
      animation-name: my-react-still;
    }
    @keyframes my-react-still {
      0%,
      80% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
  }
  /* (over the top of the middle: it's what the table is waiting on) */
  .dropped {
    position: absolute;
    z-index: 6;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: calc(100% - 16px);
    padding: 0.3rem 0.35rem 0.3rem 0.9rem;
    border-radius: 999px;
    background: rgba(201, 154, 46, 0.95);
    color: #2a1d05;
    font-weight: 600;
    font-size: 0.82rem;
  }
  .dropped span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dropped .btn {
    padding: 0.3rem 0.8rem;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .headline {
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.3rem 0.9rem;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.22);
    color: var(--ink-dim);
    transition:
      background 0.3s,
      color 0.3s;
    max-width: 100%;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .last {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin-top: -2px;
    font-size: 0.74rem;
    color: var(--ink-dim);
    animation: lastIn 0.35s var(--ease-out);
  }
  /* (hand mode: the middle is only as tall as it needs, so a long last move wraps rather than being cut) */
  .table.handmode .last span {
    white-space: normal;
    text-align: center;
  }
  .last span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @keyframes lastIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .headline.mine {
    --suit-red: #a8121e;
    --suit-red4: #b54a2b;
    --suit-blue: #07078f;
    --suit-green: #197674;
    background: var(--gold);
    color: #2a1d05;
    box-shadow: 0 0 24px rgba(233, 196, 106, 0.45);
  }
  /* never squash the headline or last move when the middle is short of room */
  .headline,
  .last {
    flex-shrink: 0;
  }
  /* (the score track keeps its own width: the wrapper is only there to measure it) */
  .track-wrap {
    align-self: stretch;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }
  /* (when the safety net shrinks the middle it does so at once: the cards, drawn by the card layer,
     ease to their new places and sizes, which they couldn't find while the middle was still easing) */
  .zones {
    transform-origin: 50% 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* (piles wrapped onto a second row sit close: height is what a phone lacks) */
    gap: 8px clamp(10px, 3vw, 32px);
    flex-wrap: wrap;
    min-height: 0;
  }
  /* everyone's melds: beside the piles, in one row that scrolls sideways when long */
  /* placed piles: a cross on a big screen, one tight row on a phone */
  .zones.cross {
    display: grid;
    grid-auto-columns: auto;
    gap: 6px clamp(14px, 2vw, 28px);
    justify-items: center;
    align-items: end;
  }
  .zones.row-fit {
    flex-wrap: nowrap;
    gap: 6px;
  }
  /* (a label wider than its pile wraps under it, "Stock ·" over "19": the row is as wide as its piles) */
  .zones.row-fit :global(.label) {
    white-space: normal;
    max-width: calc(var(--cw) * 1.5);
    text-align: center;
    line-height: 1.15;
  }
  /* the strip (everyone's melds, face-up cards) gets a row of its own under the piles, the full
     width: beside them it was left a sliver */
  .zones.has-strip {
    max-width: 100%;
    row-gap: 6px;
  }
  .zones.has-strip > .zone-slot {
    flex: none;
  }
  .strip {
    flex: 1 0 100%;
    /* (from the left, not centred: a new meld then moves only those after it, not every one down) */
    justify-content: flex-start;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    gap: clamp(10px, 2.5vw, 24px);
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 4px;
  }
  /* more to scroll to: the row fades out at that edge */
  .strip:global(.more-right) {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .strip:global(.more-left) {
    -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to left, #000 calc(100% - 28px), transparent);
  }
  .strip:global(.more-left.more-right) {
    -webkit-mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  }
  .strip > :global(*) {
    flex: none;
  }
  /* each player's melds (or face-up cards) on a panel of their own, so it's plain whose are whose */
  .strip > :global(.zone) {
    padding: 0.25rem 0.5rem 0.4rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }
  .spread-open {
    position: sticky;
    left: 0;
    z-index: 3;
    align-self: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 1.1rem;
    color: var(--ink);
    background: rgba(8, 26, 20, 0.85);
    background: color-mix(in srgb, var(--felt-3) 85%, transparent);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  /* everyone's melds full screen: panels that wrap, the page scrolling down */
  .spread-all {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 10px;
    padding: 4px 2px 8px;
  }
  .spread-all > :global(.zone) {
    max-width: 100%;
    padding: 0.25rem 0.5rem 0.4rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }
  .spread-dock {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .spread-hand {
    flex: 1;
    min-width: 0;
  }
  .spread-acts {
    flex: none;
    width: min(15rem, 38vw);
    max-height: 7.5rem;
  }
  /* (the moves in a row that wraps, beside the hand, rather than a tall column) */
  .spread-acts :global(.bar) {
    flex-direction: row;
    flex-wrap: wrap;
    align-content: flex-end;
  }
  .spread-acts :global(.bar .btn) {
    flex: 1 1 6rem;
  }
  /* a table screen can't be scrolled: the melds wrap into rows instead (sized to fit: see stripFit) */
  /* (before the first meld: just its place, under the piles) */
  .strip-room {
    flex: 1 0 100%;
  }
  .table.display .strip > :global(.zone) {
    max-width: 100%;
  }
  /* the labels over the piles in the middle (their counts and hints change all game) keep a
     steady width, so the row doesn't re-centre each time one gets longer or shorter */
  .table.display .zones > .zone-slot :global(.zone > .label) {
    min-width: calc(var(--cw) * 1.8);
    text-align: center;
  }
  /* (the headline stays on one line, reaching into the oval if it must, and the pot keeps room
     for a few more digits: neither pushes the piles about as it changes) */
  .table.display .headline {
    white-space: nowrap;
  }
  .table.display .pot {
    min-width: 9rem;
    justify-content: center;
  }
  .table.display .strip {
    flex: 1 0 120%;
    flex-wrap: wrap;
    overflow: visible;
    margin-inline: -10%;
    row-gap: 0.6rem;
    -webkit-mask-image: none;
    mask-image: none;
  }
  .pot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.8rem 0.4rem 0.5rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.22);
  }
  .pot b {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
  }
  .chipstack {
    position: relative;
    width: 26px;
    height: 32px;
  }
  .chipstack span {
    position: absolute;
    left: 0;
    width: 26px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
    box-shadow:
      inset 0 -2px 0 rgba(0, 0, 0, 0.3),
      0 1px 2px rgba(0, 0, 0, 0.4);
    border: 1.5px dashed rgba(255, 255, 255, 0.6);
  }
  .banner p.support {
    margin-top: 0.6rem;
    font-size: 0.75rem;
    color: var(--ink-faint);
  }
  .support a {
    color: var(--gold);
  }
  .tonight {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
    color: var(--gold);
    font-weight: 600;
  }
  /* over the whole screen, not just the middle of the table: on a short screen (a phone in full
     screen with the browser's bars, or a small one) the middle can be only a sliver tall */
  .banner {
    position: fixed;
    z-index: 5;
    background: rgba(8, 26, 20, 0.94);
    background: color-mix(in srgb, var(--felt-3) 94%, transparent);
    top: calc(50% + (var(--safe-t) - var(--safe-b)) / 2);
    left: calc(50% + (var(--safe-l) - var(--safe-r)) / 2);
    transform: translate(-50%, -50%);
    padding: 0.9rem 1.4rem;
    text-align: center;
    min-width: 16rem;
    max-width: 92%;
    max-height: calc(100vh - 16px - var(--safe-t) - var(--safe-b));
    max-height: calc(100dvh - 16px - var(--safe-t) - var(--safe-b));
    overflow: auto;
    animation: rise 0.35s var(--ease-spring);
  }
  .banner h2 {
    margin: 0 0 0.3rem;
    font-family: var(--font-card);
    font-size: 1.35rem;
    color: var(--gold);
  }
  .replay-quick {
    margin-bottom: 0.4rem;
    width: 100%;
  }
  .banner-btns {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .recap {
    position: relative;
    z-index: 3;
    margin: 0;
    max-width: calc(100% - 16px);
    padding: 0.3rem 0.9rem;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.28);
    color: var(--ink);
    font-size: 0.82rem;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .banner .recap-line {
    color: var(--ink);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .banner p {
    margin: 0.15rem 0;
    font-size: 0.85rem;
    color: var(--ink-dim);
  }
  /* (a short screen and a long list of scores: two columns, so the panel fits without scrolling) */
  @media (max-height: 440px) {
    .lines.cols {
      columns: 2;
      column-gap: 1.6rem;
    }
    .lines.cols p {
      break-inside: avoid;
    }
  }
  .close {
    position: absolute;
    top: 4px;
    right: 8px;
    font-size: 1.2rem;
    color: var(--ink-faint);
    width: 32px;
    height: 32px;
  }
  /* (a 44px target around the small ×) */
  .close::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, -40%) scale(0.95);
    }
  }
  footer {
    grid-area: hand;
    /* (its cards stack among themselves, on a layer of their own: over the middle's piles and
       labels as you drag one up to play it, but a card late in a long hand, or one just picked up
       and lit, never comes up over the end-of-hand panel) */
    z-index: 2;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-width: 0;
  }
  .me {
    grid-area: me;
    align-self: end;
    /* (room for a short name and a badge beside it: "Tester ★"; wider for a longer status,
       "0 in hand · 0 up · 3 down", so it takes two lines rather than four) */
    min-width: clamp(90px, 13vw, 140px);
    max-width: clamp(120px, 22vw, 200px);
    padding-bottom: 2px;
    font-size: 0.8rem;
  }
  .sheet-track {
    display: flex;
    justify-content: center;
    margin-bottom: 0.8rem;
  }
  /* a phone on its side: whose turn it is at the top of the column, you at the bottom */
  .me.side {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    min-height: 0;
    /* a set width, not the width of the words in it: a one-line tip that grew and shrank with
       each move would push the middle (and every card in it) about */
    width: clamp(130px, 24vw, 210px);
    max-width: none;
  }
  /* (a short column: the last move gives way first, so nothing runs into your name below) */
  .side-status {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 0;
    overflow: hidden;
  }
  .side-status .last,
  .side-status .recap {
    flex-shrink: 0;
  }
  .side-status .recap {
    max-width: 100%;
    font-size: 0.74rem;
    text-align: left;
    border-radius: 12px;
    padding: 0.3rem 0.6rem;
  }
  .me.side > .me-own {
    flex: none;
  }
  /* one line: a tip too long for the column glides along it (see marquee), never cut short */
  .side-status .headline {
    display: block;
    max-width: 100%;
    text-align: left;
    font-size: 0.78rem;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
  }
  .tip {
    display: block;
    overflow: hidden;
    white-space: nowrap;
  }
  .tip .run {
    display: inline-block;
  }
  .tip:global(.moving) {
    --fade: 14px;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 0.4rem, #000 calc(100% - var(--fade)), transparent);
    mask-image: linear-gradient(to right, transparent, #000 0.4rem, #000 calc(100% - var(--fade)), transparent);
    padding-left: 0.4rem;
    margin-left: -0.4rem;
  }
  .tip:global(.moving) .run {
    /* a few passes then rest (battery); tapping it, or a new tip, plays it again */
    animation: glide var(--cycle) ease-in-out 3;
  }
  @keyframes glide {
    0%,
    15% {
      transform: translateX(0);
    }
    65%,
    80% {
      transform: translateX(var(--over));
    }
    100% {
      transform: translateX(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tip:global(.moving) .run {
      animation: none;
    }
  }
  .side-status .last {
    align-items: flex-start;
    margin-top: 0;
  }
  /* (shown whole, or not at all: see fitSide) */
  .side-status .last span {
    white-space: normal;
  }
  aside > .race {
    flex: none;
  }
  .race {
    margin-bottom: 0.5rem;
    padding: 0.35rem 0.55rem;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.22);
  }
  .race .eyebrow {
    font-size: 0.7rem;
  }
  .race-lane {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink-dim);
  }
  .race-lane::before {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .race-lane .ln {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .race-lane b {
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .race-lane.lead b {
    color: var(--gold);
  }
  .me-name {
    position: relative;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
    min-width: 0;
  }
  /* a long name shortens ("Alexand…"); the dealer badge beside it always shows */
  .me-name .mn {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .me-name > :global(*) {
    flex: none;
  }
  .me-name > .mn {
    flex: 0 1 auto;
  }
  .mytag {
    font-size: 0.7rem;
    background: #fff;
    color: #111;
    border-radius: 6px;
    padding: 0 4px;
  }
  /* (chips and your status on one line where they fit: "1,111 chips · Call 63") */
  .me-sub {
    color: var(--ink-dim);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
  }
  .me-sub b {
    color: var(--ink);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .gold,
  .hint {
    color: var(--gold);
    font-weight: 600;
  }
  /* (a hint, "Melded 0 · holding 57": small, under your score) */
  .hint {
    margin-top: 0.15rem;
    font-size: 0.7rem;
    font-weight: 500;
    opacity: 0.9;
  }
  /* (the old hand leaving and the new one coming in share one spot while they cross) */
  .fan {
    position: relative;
    grid-area: 1 / 1;
  }
  .hand-wrap {
    display: grid;
    position: relative;
    flex: 1;
    min-width: 0;
  }
  /* (whose cards the fan holds when they're not yours: "Dummy") */
  .fan-label {
    position: absolute;
    z-index: 30;
    left: 50%;
    top: 0;
    transform: translate(-50%, -100%);
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--gold);
    color: #2a1d05;
  }
  aside {
    grid-area: actions;
    width: clamp(108px, 17vw, 168px);
    padding-bottom: 8px;
    min-height: 0;
    /* (the action buttons take what's left under a "Replay hand" button, not the whole height) */
    display: flex;
    flex-direction: column;
  }
  aside > :global(.replay) {
    flex: 1;
    min-height: 0;
    height: auto;
  }
  aside > :global(.bar) {
    flex: 1;
    min-height: 0;
    height: auto;
  }
  .rotate {
    display: none;
  }
  @media (orientation: portrait) and (max-width: 600px) {
    .rotate {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      text-align: center;
      padding: 2rem;
      background: rgba(5, 18, 14, 0.96);
    }
    .phone {
      width: 44px;
      height: 78px;
      border: 3px solid var(--ink);
      border-radius: 10px;
      animation: turn 2s var(--ease-out) 3;
    }
  }
  @keyframes turn {
    0%,
    20% {
      transform: rotate(0);
    }
    60%,
    100% {
      transform: rotate(-90deg);
    }
  }
  .menu-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  /* (a label too long for its button wraps rather than spilling over the next one) */
  .menu-list > .btn {
    min-width: 0;
    white-space: normal;
    text-align: center;
  }
  /* (a phone on its side: four across, so the whole menu fits without scrolling) */
  @media (max-height: 440px) and (min-width: 560px) {
    .menu-list {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }
    .menu-list > .btn {
      padding: 0.4em 0.5em;
      font-size: 0.85rem;
    }
  }
  .save-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .btn.save {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding: 0.7rem 1rem;
    border-radius: 16px;
    white-space: normal;
    text-align: left;
    height: auto;
  }
  .btn.save .ext {
    font-weight: 500;
    color: var(--ink-dim);
  }
  .btn.save .about {
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--ink-dim);
  }
  .save-note {
    margin: 0.8rem 0 0;
    font-size: 0.8rem;
    color: var(--ink-dim);
  }
  .rules {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    color: var(--ink-dim);
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .scores {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .scores th {
    text-align: right;
    font-size: 0.7rem;
    color: var(--ink-dim);
    font-weight: 600;
    padding: 0.3rem 0.5rem;
  }
  .scores td {
    padding: 0.45rem 0.5rem;
    border-top: 1px solid var(--line);
    text-align: right;
  }
  .scores td:first-child {
    text-align: left;
    font-weight: 600;
  }
  .scores tr.hl td {
    color: var(--gold);
  }
  .log {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    color: var(--ink-dim);
    font-size: 0.85rem;
    line-height: 1.6;
  }

  /* very short landscape phones */
  @media (max-height: 360px) {
    .headline {
      font-size: 0.74rem;
      padding: 0.2rem 0.7rem;
    }
    .icon {
      width: 34px;
      height: 34px;
    }
  }
</style>
