<script lang="ts">
  import { untrack } from 'svelte';
  import type { LogEntry } from '../../engine/types';
  import { landing, layout, offstage, travel, type Box, type Spot } from '../layout/cardLayout';
  import Card from './Card.svelte';

  /**
   * Every card on the table in one layer (a prototype: your hand and the trick so far). Each card
   * is one element for as long as it's on the table, placed by the layout and eased from place to
   * place by its own transition: a card played from your hand is the same element that lands in
   * the trick, so nothing is swapped, and nothing reflows around it.
   *
   * The table still lays out its areas (where your hand's strip and the trick's box are); this
   * finds them by `data-layer` and puts the cards in them.
   */
  interface Props {
    /** Your hand in the order shown, and its card width. */
    hand: { ids: string[]; cw: number } | null;
    trick: { id: string; by?: number }[];
    you: number;
    players: number;
    /** Bumped on every change of the game (when to look again at where the areas are). */
    v: number;
    /** The latest move: where cards that weren't on the table come from, and leaving ones go. */
    entry: LogEntry | undefined;
    selected: string[];
    selectable: Set<string> | null;
    fresh: string[];
    hints: boolean;
    ontap: (id: string) => void;
    onswipe: (id: string) => void;
    onreorder?: (ids: string[]) => void;
  }
  let { hand, trick, you, players, v, entry, selected, selectable, fresh, hints, ontap, onswipe, onreorder }: Props = $props();

  let el: HTMLDivElement;
  let boxes = $state<{ hand: Box | null; trick: Box | null }>({ hand: null, trick: null });

  /** An element's place relative to the layer. */
  function boxOf(target: Element | null): Box | null {
    if (!target || !el) return null;
    const r = target.getBoundingClientRect();
    const o = el.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }
  const table = () => el?.parentElement ?? null;
  function measure() {
    const t = table();
    if (!t) return;
    const next = { hand: boxOf(t.querySelector('[data-layer="hand"]')), trick: boxOf(t.querySelector('[data-layer="trick"]')) };
    // (only a real change: a new object would set every card's place again)
    const same = (a: Box | null, b: Box | null) =>
      a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);
    if (!same(next.hand, boxes.hand) || !same(next.trick, boxes.trick)) boxes = next;
  }
  // after every change, and again once the table's own easing (sizes, rows) has settled
  $effect(() => {
    void v;
    measure();
    const later = setTimeout(measure, 380);
    return () => clearTimeout(later);
  });
  $effect(() => {
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  });

  const spots = $derived(
    layout({
      hand: hand && boxes.hand ? { ids: hand.ids, box: boxes.hand, cw: hand.cw } : null,
      trick: boxes.trick ? { cards: trick, box: boxes.trick } : null,
      you,
      players,
    }),
  );

  /** A card on screen: where it's going, how long it takes, and where it starts if it's new. */
  interface Shown {
    id: string;
    spot: Spot;
    ms: number;
    from: Spot | null;
    leaving: boolean;
  }
  let shown = $state<Shown[]>([]);
  const gone = new Map<string, ReturnType<typeof setTimeout>>();

  /** A seat on the table (yours is your hand), or a pile, to come from or go to. */
  function anchor(seat: number | undefined, pile: string | undefined): { box: Box | null; pile: boolean } {
    const t = table();
    if (pile) {
      const b = boxOf(t?.querySelector(`[data-zone="${CSS.escape(pile)}"]`) ?? null);
      if (b) return { box: b, pile: true };
    }
    if (seat == null) return { box: null, pile: false };
    if (seat === you) return { box: untrack(() => boxes.hand), pile: false };
    return { box: boxOf(t?.querySelector(`[data-seat="${seat}"]`) ?? null), pile: false };
  }

  // the cards that came, went or moved: each keeps its element, and only its place changes
  $effect(() => {
    const next = spots;
    untrack(() => {
      const byId = new Map(next.map((p) => [p.id, p]));
      const had = new Set(shown.map((c) => c.id));
      const out: Shown[] = [];
      for (const c of shown) {
        const p = byId.get(c.id);
        if (p) {
          // (one leaving that's back again, as after an undo: it turns round)
          clearTimeout(gone.get(c.id));
          gone.delete(c.id);
          out.push({ id: c.id, spot: p, ms: travel(c.spot, p), from: null, leaving: false });
        } else if (c.leaving) out.push(c);
        else {
          const to = anchor(entry?.to ?? entry?.seat, entry?.toZone);
          const away = offstage(c.spot, to.box, { arriving: false, pile: to.pile });
          const ms = travel(c.spot, away);
          out.push({ id: c.id, spot: away, ms, from: null, leaving: true });
          gone.set(
            c.id,
            setTimeout(() => {
              gone.delete(c.id);
              shown = shown.filter((x) => x.id !== c.id || !x.leaving);
            }, ms + 80),
          );
        }
      }
      const arriving = next.filter((p) => !had.has(p.id));
      // a new hand comes in a card at a time
      const dealing = arriving.length >= 5;
      const from = anchor(entry?.seat, entry?.fromZone);
      arriving.forEach((p, i) => {
        const start = offstage(p, from.box, { arriving: true, pile: from.pile });
        out.push({ id: p.id, spot: dealing ? { ...p, delay: i * 30 } : p, ms: travel(start, p), from: start, leaving: false });
      });
      shown = out;
    });
  });
  $effect(() => () => gone.forEach((t) => clearTimeout(t)));

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** A new card starts where it comes from, and then eases to its place (set before it's first drawn). */
  function arrive(node: HTMLElement, from: Spot | null) {
    if (!from || still) return;
    const keep = { transform: node.style.transform, opacity: node.style.opacity, cw: node.style.getPropertyValue('--cw'), z: node.style.zIndex };
    // (the property only: the inline duration and delay stay as they are)
    node.style.transitionProperty = 'none';
    node.style.transform = place(from);
    node.style.opacity = String(from.opacity);
    node.style.setProperty('--cw', `${from.w}px`);
    node.style.zIndex = String(from.z + 1000);
    void node.offsetWidth;
    node.style.transitionProperty = '';
    node.style.transform = keep.transform;
    node.style.opacity = keep.opacity;
    node.style.setProperty('--cw', keep.cw);
    node.style.zIndex = keep.z;
  }
  const place = (p: Spot, dx = 0, dy = 0) => `translate(${p.x - p.w / 2 + dx}px, ${p.y - p.w * 0.7 + dy}px) rotate(${p.rot}deg)`;

  // ---- your hand: tap to pick, drag up to play, drag sideways to move a card along -------------
  let drag = $state<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean; slide: boolean } | null>(null);
  const handSpots = $derived(spots.filter((p) => p.inHand));

  function down(e: PointerEvent, id: string) {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (a synthetic event) */
    }
    drag = { id, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, slide: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const dx = e.clientX - drag.x;
    if (Math.abs(dy) > 6 || Math.abs(dx) > 6) drag.moved = true;
    if (onreorder && handSpots.length > 1 && !drag.slide && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) drag.slide = true;
    if (drag.slide) {
      drag.dx = dx;
      drag.dy = 0;
    } else drag.dy = Math.min(0, dy);
  }
  function up(e: PointerEvent) {
    if (!drag) return;
    const { id, dy, moved, slide } = drag;
    const slid = e.clientX - drag.x;
    drag = null;
    const ids = handSpots.map((p) => p.id);
    const from = ids.indexOf(id);
    if (slide) {
      const at = from < 0 ? from : landing(handSpots, handSpots[from].x + slid);
      if (from >= 0 && at !== from) {
        ids.splice(from, 1);
        ids.splice(at, 0, id);
        onreorder?.(ids);
      }
      return;
    }
    if (dy < -Math.max(36, (hand?.cw ?? 60) * 0.45) && Math.abs(slid) < -dy) onswipe(id);
    else if (!moved || Math.abs(dy) < 10) ontap(id);
  }
  /**
   * The keyboard goes along the hand in its order (the cards' elements stay in the order they
   * came, so moving one never interrupts its easing): arrows move between cards, Enter or Space
   * picks one, and Alt with an arrow moves it along the hand.
   */
  let focusId = $state<string | null>(null);
  const tabStop = $derived(handSpots.some((p) => p.id === focusId) ? focusId : (handSpots[0]?.id ?? null));
  function key(e: KeyboardEvent, id: string) {
    const ids = handSpots.map((p) => p.id);
    const i = ids.indexOf(id);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ontap(id);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const at = i + (e.key === 'ArrowLeft' ? -1 : 1);
    if (at < 0 || at >= ids.length) return;
    e.preventDefault();
    if (e.altKey && onreorder) {
      ids.splice(i, 1);
      ids.splice(at, 0, id);
      onreorder(ids);
      return;
    }
    focusId = ids[at];
    el.querySelector<HTMLElement>(`[data-card="${CSS.escape(ids[at])}"]`)?.focus();
  }
</script>

<div class="layer" bind:this={el} role="group" aria-label="Your hand and the table">
  {#each shown as c (c.id)}
    {@const p = c.spot}
    {@const held = drag?.id === c.id ? drag : null}
    {@const mine = p.inHand && !c.leaving}
    {@const can = !selectable || selectable.has(c.id)}
    <!-- (a card of your hand is a button; the rest are pictures) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="lc"
      class:mine
      class:held
      data-card={c.id}
      data-area={p.inHand ? 'hand' : 'trick'}
      style:transform={place(p, held?.dx, held?.dy)}
      style:--cw="{p.w}px"
      style:z-index={held?.slide ? 999 : p.z}
      style:opacity={p.opacity}
      style:transition-duration="{c.ms}ms"
      style:transition-delay="{p.delay}ms"
      use:arrive={c.from}
      onpointerdown={mine ? (e) => down(e, c.id) : undefined}
      onpointermove={mine ? move : undefined}
      onpointerup={mine ? up : undefined}
      onpointercancel={() => (drag = null)}
      onkeydown={mine ? (e) => key(e, c.id) : undefined}
      onfocus={() => (focusId = c.id)}
      role={mine ? 'button' : undefined}
      tabindex={mine ? (tabStop === c.id ? 0 : -1) : undefined}
      aria-pressed={mine ? selected.includes(c.id) : undefined}
      aria-disabled={mine && hints && !can ? true : undefined}
    >
      <Card
        id={c.id}
        selected={mine && selected.includes(c.id)}
        playable={mine && hints && !!selectable && can && selectable.size < handSpots.length}
        dim={mine && hints && !!selectable && !can}
        fresh={mine && fresh.includes(c.id)}
      />
    </div>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    overflow: hidden;
  }
  .lc {
    position: absolute;
    left: 0;
    top: 0;
    transition-property: transform, --cw, opacity;
    transition-timing-function: var(--ease-out);
    will-change: transform;
  }
  .lc.mine {
    pointer-events: auto;
    cursor: pointer;
    touch-action: none;
  }
  .lc.held {
    transition: none;
  }
  .lc:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
    border-radius: var(--card-radius);
  }
  @media (prefers-reduced-motion: reduce) {
    .lc {
      transition: none;
    }
  }
</style>
