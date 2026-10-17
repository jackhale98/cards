<script lang="ts">
  import { app } from '../../app.svelte';
  import type { ActionSpec, ZoneState } from '../../engine/types';
  import { getGame, howToPlay } from '../../games';
  import { REACTIONS, type Frame, type View } from '../../net/protocol';
  import { untrack } from 'svelte';
  import Hand from '../components/Hand.svelte';
  import Zone from '../components/Zone.svelte';
  import * as size from '../layout/table';
  type Fit = ReturnType<typeof size.fitSizes>;
  import { FULL_HAND, TAP, type Where } from '../layout';
  import { labelMeasure } from '../labelMeasure';
  import { Frames, provideFrames } from '../layout/frames.svelte';
  import Sheet from '../components/Sheet.svelte';
  import LookPicker from '../components/LookPicker.svelte';
  import Track from '../components/Track.svelte';
  import { nightTotals } from '../../net/night';
  import { seatRelation } from '../../engine/state';
  import { flight, haptic, play, snapshot } from '../motion';
  import { play as playSound, type Sound } from '../sound';
  import { arrangeHand } from '../handOrder';
  import { fade } from 'svelte/transition';
  import { isHidden } from '../../engine/redact';
  import { STAND_IN } from '../../net/host';
  import { seatColor } from '../seatColors';
  import { keepAwake } from '../wakeLock';
  import { clearTurn, raiseTurn } from '../turnAlert';
  import TvSheet from '../components/TvSheet.svelte';
  import MenuSheet from '../table/MenuSheet.svelte';
  import ScoresSheet from '../table/ScoresSheet.svelte';
  import SaveSheet from '../table/SaveSheet.svelte';
  import ResultBanner from '../table/ResultBanner.svelte';
  import RotatePrompt from '../table/RotatePrompt.svelte';
  import { TableSettings } from '../table/settings.svelte';
  import * as shown from '../table/shown';
  import { afterSwipe, afterTap, Selection } from '../table/selection.svelte';
  import { RaceClock } from '../table/race';
  import { freshAfter } from '../table/fresh';
  import { announceText, lastMoveOf, recapOf, soundFor } from '../table/events';
  import { REACTION_NAMES, Reactions } from '../table/reactions.svelte';
  import TableStatus from '../table/TableStatus.svelte';
  import Recap from '../table/Recap.svelte';
  import MeColumn from '../table/MeColumn.svelte';
  import SeatsBar from '../table/SeatsBar.svelte';
  import ActionsColumn from '../table/ActionsColumn.svelte';
  import MeldsSheet from '../table/MeldsSheet.svelte';
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
  /** The last move's line (it can wrap), measured when last shown (see TableStatus). */
  let lastH = $state(0);
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
  function middleAt(cw: number, reserve: boolean = stripRoomShown, withStrip = true): number {
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
      strip: !withStrip
        ? undefined
        : stripZones.length
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
      lastH,
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
   * How wide a face-up hand in the middle (the dummy, a row of cards) may grow: its cards as much
   * taller as the height that's spare (fitSizes leaves it spare for this). On a table screen the
   * dummy keeps one size all hand, for everyone watching.
   */
  const growTo = $derived.by(() => {
    const dummy = shownCenter.find((z) => z.faceUpHand);
    if (display || !dummy) return 0;
    return slotCw(dummy) + Math.floor(cardSizes.spare / 1.4);
  });

  /**
   * The safety net under the sizes worked out above: if the middle's cards still come out taller
   * than the room under the headline (labels grow during play; a row wraps that wasn't expected),
   * they're drawn smaller to fit. A transform doesn't change the layout, so measuring it can't
   * set off another round.
   */
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
      // (anything below the piles in the middle, the hand's summary say, keeps its room; not what
      // floats over the table, the result banner)
      let below = 0;
      for (let c = el.nextElementSibling as HTMLElement | null; c; c = c.nextElementSibling as HTMLElement | null)
        if (c.offsetHeight && !['absolute', 'fixed'].includes(getComputedStyle(c).position)) below += c.offsetHeight + 6;
      const room = main.clientHeight - el.offsetTop - below;
      // (a table screen sizes its cards to this room: see displayCw)
      if (display && Math.abs(room - middleRoom) >= 4) middleRoom = room;
      const { h, w } = extent();
      // (too tall, or too wide: a showdown's two seven-card hands side by side on a phone)
      // (nothing in the middle, hand mode between moves say: nothing to fit)
      const k = h ? Math.min(1, room / h, main.clientWidth / Math.max(1, w, el.offsetWidth)) : 1;
      // (a table screen lets the middle run a few percent past its box into the oval, rather than
      // shrink everything by a hair and back as melds land)
      const want = display && k >= 0.96 ? 1 : Math.max(0.6, Math.min(1, k));
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
  /** This device's settings (the menu's), and where you've dragged cards to in your hand (by id; see arrangeHand). */
  const settings = new TableSettings();
  let handOrder = $state<string[]>([]);
  const myHand = $derived(arrangeHand(dealtHand, settings.handSort, handOrder));
  /** The hands turned over at a showdown, in the middle (see shown.ts), and the zones they came from. */
  const showdownZones = $derived(shown.showdownZones(status.showdown, s.zones));
  const shownDownSeats = $derived(new Set(showdownZones.map((z) => z.owner)));
  const shownDownZones = $derived(new Set((status.showdown ?? []).flatMap((x) => x.zones)));
  /** A dummy that has emptied keeps its room until the middle is clear (see keptRoomAfter). */
  let keptRoom = $state<string[]>([]);
  $effect(() => {
    const next = shown.keptRoomAfter(keptRoom, s.zones);
    if (next !== keptRoom) keptRoom = next;
  });
  const allCenterZones = $derived(shown.middleZones(s.zones, keptRoom, showdownZones));
  /** Zones on the compact strip along the bottom of the table (e.g. everyone's melds). */
  const allStripZones = $derived(shown.stripZonesOf(s.zones, shownDownZones));
  const seatZone = (seat: number) => (shownDownSeats.has(seat) ? [] : (s.zones[`hand:${seat}`]?.cards ?? []));

  // ---- selection --------------------------------------------------------------------------
  /** The cards you've picked (see selection.svelte.ts), pruned to what's still on offer after each update. */
  const sel = new Selection(() => view.actions);
  const selectable = $derived(sel.selectable);
  $effect(() => sel.prune());

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
    const next = afterTap(sel.selected, id, sel.picking);
    if (!next) {
      // (with the hints off nothing looks unplayable, so a tap on such a card says why nothing happens)
      if (!settings.hints && selectable && fanCards.some((c) => c.id === id)) app.say('That card can’t be played right now');
      return;
    }
    // (tapping a lone picked card again plays it, unless the action is swipe-only)
    if ('play' in next) return run(next.play);
    sel.selected = next.selected;
    haptic(5);
  }

  function swipe(id: string) {
    const next = afterSwipe(sel.selected, id, sel.picking);
    if (next === 'tap') return tap(id);
    run(next.play, undefined, next.cards);
  }

  // ---- real-time games: how quickly you reacted, timed on this device ----------------------
  const race = new RaceClock();
  $effect(() => race.saw(status.race));

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
    if (replay) return;
    const next = freshAfter(before, now, freshIds, isHidden);
    if (next !== freshIds) freshIds = next;
  });
  function run(spec: ActionSpec, amount?: number, cards = sel.selected, seat?: number) {
    freshIds = [];
    const timing = spec.react ? race.timing(status.race) : {};
    app.act({ type: spec.type, cards: spec.select ? [...cards] : undefined, amount, seat, ...timing });
    if (spec.select) sel.clear();
    haptic(spec.react ? 25 : 10);
  }

  /** Tapping a pile: its action (draw, take…), or, with cards selected, putting them there (Kings Corners). */
  const zoneAction = (zoneId: string) => sel.zoneAction(zoneId);
  /** What every pile needs to be tapped and played onto: the same in the middle, the strip and the melds full screen. */
  const zoneHooks = (z: ZoneState) => ({
    you,
    players: n,
    selected: sel.selected,
    selectable,
    ontap: tap,
    zoneActive: !!zoneAction(z.id),
    place: !!zoneAction(z.id)?.select,
    onzone: zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined,
    fast: !!zoneAction(z.id)?.react,
  });
  /** Your moves, wherever their buttons are. */
  const actionBar = $derived({
    actions: view.actions,
    selected: sel.selected,
    pot: status.pot,
    onact: (spec: ActionSpec, amount?: number, seat?: number) => run(spec, amount, sel.selected, seat),
    onclear: () => sel.clear(),
    seatInfo: (seat: number) => ({ name: s.players[seat]?.name ?? '', avatar: lobbySeat(seat)?.avatar, relation: seatRelation(you, seat, n) }),
  });
  /** In hand mode only piles you can use right now stay on the phone (e.g. the deck to draw from, a bridge dummy). */
  const usable = (z: (typeof allCenterZones)[number]) => !!zoneAction(z.id) || z.cards.some((c) => selectable?.has(c.id));
  // (in a real-time game you react to the piles, so they stay put on the phone: watching the TV
  // instead would also time your reaction from the wrong screen)
  const centerZones = $derived(handMode && !game.realtime ? allCenterZones.filter(usable) : allCenterZones);
  /**
   * Piles with places on the table (Kings Corners' cross): a big screen lays them out so; a phone on
   * its side, short of height, puts them in one row in reading order, as wide as fits.
   */
  const gridded = $derived(size.isGridded(centerZones));
  const cross = $derived(gridded && !side);
  const shownCenter = $derived(gridded ? shown.gridOrder(centerZones) : centerZones);
  /** One row of placed piles on a phone: the widest card that lets them all fit across (with a little over for a wider label). */
  const rowFit = $derived(size.rowFit(centerZones, mainW, side));
  /**
   * A whole hand face up on the table that you're playing from now (bridge's dummy, for its
   * declarer): it takes your hand's place at the bottom, full size, and your own hand sits small in
   * its place in the middle until it's your own turn again.
   */
  const playFrom = $derived(display || you < 0 ? null : shown.playFromOf(centerZones, selectable));
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
  const stripZones = $derived(shown.stripOrder(handMode ? allStripZones.filter(usable) : allStripZones, usable, you, n));
  /**
   * A table screen can't be scrolled, so there the strip (everyone's melds) wraps into rows across
   * the middle, with cards small enough that the longest set of melds fits a row. Through a hand
   * they only get smaller (once, as melds outgrow the row), never back and forth.
   */
  /**
   * The height a table screen's strip of melds has: the room under the headline less the piles'
   * row over it (6px between) and a little clear of the seat at the bottom.
   */
  const stripSpace = $derived(display && middleRoom ? Math.floor(middleRoom - middleAt(centerCw, false, false) - 6 - 8) : 0);
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
  // (nothing left to show: the full-screen view of the melds closes itself, e.g. at a new hand)
  $effect(() => {
    if (sheet === 'spread' && !allStripZones.length) sheet = null;
  });
  let bannerHidden = $state<number | null>(null);
  const showBanner = $derived(!!status.banner && bannerHidden !== s.v);

  // keep the screen awake while at the table
  $effect(() => keepAwake());
  // (leaving the table: no "your turn" left behind in the title)
  $effect(() => () => clearTurn());

  // ---- what just happened ------------------------------------------------------------------
  const lastEntry = $derived(s.log.at(-1));
  /** Latest player move, shown under the headline (unless the headline already says it). */
  const lastMove = $derived(lastMoveOf(lastEntry, status.headline));

  /**
   * What a screen reader hears as the game goes on: each move, and when it's your turn. One region
   * that stays put (a region that's replaced each time is often not read at all).
   */
  const announce = $derived(
    replay || display ? '' : announceText(lastEntry, you >= 0 && (actor === you || (actor == null && !game.realtime && view.actions.some((a) => !a.menu)))),
  );

  // ---- sounds: each new move on the table (on the big screen, when there is one), and the end
  // a table screen stays quiet when someone at the table has muted it (a Chromecast has no menu)
  const sound = (x: Sound) => (replay || (display && view.lobby.screenSound === false) ? undefined : playSound(x));
  let heard = -1;
  $effect(() => {
    const e = lastEntry;
    if (!e || e.t === heard) return;
    const first = heard === -1;
    heard = e.t;
    // (not for what was already on the table when we arrived; in hand mode the big screen plays them)
    if (first || handMode) return;
    const snd = soundFor(e, showChips);
    if (snd) sound(snd);
  });
  let lastPhase: string | null = null;
  $effect(() => {
    if (s.phase === 'gameOver' && lastPhase != null && lastPhase !== 'gameOver') sound(display || s.winner?.includes(you) ? 'win' : 'end');
    lastPhase = s.phase;
  });
  /** Reactions showing on seats just now, by game seat (see REACTIONS). */
  const reactions = new Reactions();
  const reacts = $derived(reactions.shown);
  $effect(() => {
    const r = app.reaction;
    if (!r || replay) return;
    const seat = (view.lobby.playing ?? []).indexOf(r.id);
    if (seat >= 0) untrack(() => reactions.show(seat, r.e, r.at));
  });
  let reacting = $state(false);
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
  const recap = $derived(view.handDone && !replay ? recapOf(history, status.banner?.lines) : null);
  /** The hand's summary under the middle's piles (on a phone on its side it's in the column instead). */
  const recapShown = $derived(!!recap && !side && !(showBanner && status.banner));
  /** Game night standings, shown when a game ends. */
  const tonight = $derived(nightTotals(view.lobby.night));
  const myInfo = $derived(you >= 0 ? status.seats[you] : undefined);
</script>

<svelte:window onkeydown={onkey} bind:innerWidth={vw} bind:innerHeight={vh} />

<!-- whose turn it is and the last move: above the middle, or (a phone on its side) in the column on the left -->
{#snippet tableStatus()}
  <TableStatus
    headline={status.headline}
    mine={actor === you && you >= 0}
    {lastMove}
    lastShown={cardSizes.lastFits}
    who={lastMove?.seat != null ? { avatar: lobbySeat(lastMove.seat)?.avatar, name: s.players[lastMove.seat]?.name ?? '' } : null}
    {display}
    {side}
    {handMode}
    bind:headH
    bind:lastH
  />
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
    <SeatsBar
      seats={others}
      players={n}
      turn={actor}
      {display}
      seat={(seat) => ({
        player: s.players[seat],
        info: status.seats[seat],
        cards: seatZone(seat),
        turn: s.turn === seat,
        connected: lobbySeat(seat)?.connected ?? true,
        showChips,
        compact: others.length > 4 || (others.length >= 3 && vw < 940 && !display),
        avatar: lobbySeat(seat)?.avatar,
        relation: display ? null : seatRelation(you, seat, n),
        said: saidBy(seat),
        ping: lobbySeat(seat)?.host ? null : pingOf(seat),
        scale: tvRem / 16,
        turnLabel: display,
      })}
    />
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
  <main bind:clientWidth={mainW} bind:clientHeight={mainH} onclick={(e) => !(e.target as Element).closest('button, .card') && sel.clear()}>
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
            {...zoneHooks(z)}
            {roomy}
            {growTo}
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
              {...zoneHooks(z)}
            />
          {/each}
        </div>
      {/if}
    </div>

    {#if recapShown}
      <Recap recap={recap!} bind:h={recapH} />
    {/if}
    {#if showBanner && status.banner}
      <ResultBanner
        banner={status.banner}
        {recap}
        handDone={!!view.handDone}
        gameOver={s.phase === 'gameOver'}
        history={!!history}
        {tonight}
        {display}
        replay={!!replay}
        onhide={() => (bannerHidden = s.v)}
        onscores={() => (sheet = 'scores')}
      />
    {/if}
  </main>

  <!-- you: a column of your own beside the middle, above your hand, so your hand has the whole width -->
  {#if !display}
    <MeColumn
      {me}
      {you}
      avatar={lobbySeat(you)?.avatar}
      info={myInfo}
      chips={showChips}
      hint={status.hint}
      react={reacts[you]}
      away={view.lobby.seats.some((x) => x.id === app.cid) ? 'Sitting this one out — you’re in the next game' : 'Watching'}
      {side}
      {handMode}
      recap={recap && !(showBanner && status.banner) ? recap : null}
      status={tableStatus}
      bind:meOwnH
      bind:recapH={sideRecapH}
    />
  {/if}

  {#if !display}
    <!-- bottom: my hand, info and actions -->
    <footer>
      <!-- bigger fanned cards tip further past the ends: keep them clear of the buttons -->
      <div class="hand-wrap" style:padding-inline={handMode ? `${Math.round(handCw * 0.3)}px` : undefined}>
        {#if myHandZone?.layout === 'stack'}
          <!-- a face-down pile instead of a hand (slap games): tap it to turn up your top card -->
          <Zone zone={myHandZone} cw={handCw} {...zoneHooks(myHandZone)} place={false} />
        {:else}
          <!-- (your hand and the dummy trade places quietly: see frames.calm) -->
          <div class="fan">
            {#if playFrom?.label}<div class="fan-label eyebrow">{playFrom.label}</div>{/if}
            <Hand
              cards={fanCards}
              cw={handCw}
              zone={playFrom?.id ?? `hand:${you}`}
              selected={sel.selected}
              {selectable}
              fresh={playFrom ? [] : freshIds}
              hints={settings.hints}
              ontap={tap}
              onswipe={swipe}
              onreorder={playFrom ? undefined : (ids) => (handOrder = ids)}
            />
          </div>
        {/if}
      </div>
    </footer>
    <aside bind:offsetHeight={asideH}>
      <ActionsColumn
        track={status.track}
        colorOf={(seat) => lobbySeat(seat)?.avatar?.color ?? seatColor(seat)}
        replayHand={!!view.handDone && !(showBanner && status.banner) && !replay}
        replay={replay ?? null}
        bar={actionBar}
      />
    </aside>
  {/if}
  <CardLayer {frames} {you} entry={s.log.at(-1)} />
</div>

{#if !display}<RotatePrompt />{/if}

{#if sheet === 'spread'}
  <MeldsSheet
    zones={allStripZones}
    hand={myHand}
    hints={settings.hints}
    {selectable}
    {you}
    players={n}
    zone={zoneHooks}
    bar={actionBar}
    {labels}
    ontap={tap}
    onswipe={swipe}
    onreorder={(ids) => (handOrder = ids)}
    onclose={() => (sheet = null)}
  />
{:else if sheet === 'tv'}
  <TvSheet table={view.lobby.code} onclose={() => (sheet = null)} />
{/if}

{#if sheet === 'menu'}
  <MenuSheet
    {view}
    {game}
    {rules}
    {settings}
    {display}
    replay={!!replay}
    onsheet={(x) => (sheet = x)}
    onsort={() => (handOrder = [])}
    onclose={() => (sheet = null)}
  />
{:else if sheet === 'save'}
  <SaveSheet config={game.config} onclose={() => (sheet = null)} />
{:else if sheet === 'look'}
  <Sheet title="The table's look" onclose={() => (sheet = null)}>
    <LookPicker look={view.lobby.look} onpick={app.controls ? (l) => app.controls?.setLook(l) : undefined} />
  </Sheet>
{:else if sheet === 'scores'}
  <ScoresSheet
    {status}
    players={s.players}
    chips={showChips}
    {history}
    night={view.lobby.night}
    seats={view.lobby.seats}
    log={s.log}
    avatars={s.players.map((_, i) => lobbySeat(i)?.avatar)}
    onclose={() => (sheet = null)}
  />
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
  header {
    grid-area: top;
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
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
  @keyframes lastIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
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
  /* very short landscape phones */
  @media (max-height: 360px) {
    .icon {
      width: 34px;
      height: 34px;
    }
  }
</style>
