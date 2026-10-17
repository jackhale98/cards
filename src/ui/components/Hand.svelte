<script lang="ts">
  import type { CardRef } from '../../engine/types';
  import { cardName } from '../cardName';
  import { fan, fanHeight, landing, type Spot } from '../layout';
  import { LAYER, useFrames } from '../layout/frames.svelte';
  import Card from './Card.svelte';

  /**
   * Your hand, fanned (layout/fan.ts). Each card's place is a button here, in the hand's order:
   * tap to pick it, drag it up to play it, drag it sideways to move it in the hand, or use the
   * keyboard. At a table the card layer draws the cards over them (CardLayer.svelte); elsewhere
   * (under the full-screen melds) they're drawn here.
   */
  interface Props {
    cards: CardRef[];
    cw: number;
    selected: string[];
    /** Cards that may be selected right now; null when no selection is in play. */
    selectable: Set<string> | null;
    fresh?: string[];
    /** Shade the cards that can't be used now and edge the ones that can (a choice in the menu). */
    hints?: boolean;
    ontap: (id: string) => void;
    onswipe: (id: string) => void;
    /** Drag a card sideways to move it within the hand: the hand's new order, by card id. */
    onreorder?: (ids: string[]) => void;
    /** The zone it holds (yours; bridge's dummy when you play from it). */
    zone?: string;
    /** Draw its own cards, even at a table (it's on a sheet over it). */
    inline?: boolean;
  }
  let { cards, cw, selected, selectable, fresh = [], hints = true, ontap, onswipe, onreorder, zone = 'hand', inline = false }: Props = $props();

  const frames = useFrames();
  const layered = $derived(!!frames && !inline);

  let width = $state(0);
  /** A card being dragged: up (to play it) or, with `slide`, sideways (to move it in the hand). */
  let drag = $state<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean; slide: boolean } | null>(null);

  const placed = $derived(
    fan(
      cards.map((c) => c.id),
      width,
      cw,
    ),
  );
  /** Each card's place (and, being dragged, where your finger has it), and how it looks there. */
  const spots = $derived(
    placed.spots.map((p): Spot => {
      const can = !selectable || selectable.has(p.id);
      // (held only once it's being dragged: a card just pressed stays in its place in the fan, and
      // a tap picks it, easing up from there, rather than jumping to the front first)
      const held = drag?.id === p.id && drag.moved;
      return {
        ...p,
        x: p.x + (held ? drag!.dx : 0),
        y: p.y + (held ? drag!.dy : 0),
        z: held && drag!.slide ? cards.length + 1 : p.z,
        held,
        selected: selected.includes(p.id),
        playable: hints && !!selectable && can && selectable.size < cards.length,
        dim: hints && !!selectable && !can,
        fresh: fresh.includes(p.id),
      };
    }),
  );

  let handEl = $state<HTMLElement>();
  // (at a table: the card layer draws your hand)
  $effect(() => {
    const el = handEl;
    if (!frames || inline || !el) return;
    frames.set('hand', { el, zone, layer: LAYER.hand, spots, ids: cards.map((c) => c.id) });
    return () => frames.drop('hand', el);
  });

  function down(e: PointerEvent, id: string) {
    // (a mouse let go outside the hand still ends the drag here: touch does this by itself)
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
    // mostly sideways: moving the card along the hand (once decided, it stays a slide)
    if (onreorder && cards.length > 1 && !drag.slide && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) drag.slide = true;
    if (drag.slide) {
      drag.dx = dx;
      drag.dy = 0;
    } else drag.dy = Math.min(0, dy);
  }
  /** Enter or Space picks the card; Alt with an arrow key moves it along the hand. */
  function key(e: KeyboardEvent, id: string, i: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ontap(id);
    } else if (e.altKey && onreorder && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const at = i + (e.key === 'ArrowLeft' ? -1 : 1);
      if (at < 0 || at >= cards.length) return;
      e.preventDefault();
      const ids = cards.map((c) => c.id);
      ids.splice(i, 1);
      ids.splice(at, 0, id);
      onreorder(ids);
      // (keep the keyboard on the card that moved)
      requestAnimationFrame(() => (e.currentTarget as HTMLElement | null)?.focus());
    }
  }
  function up(e: PointerEvent) {
    if (!drag) return;
    const { id, dy, moved, slide } = drag;
    const dx = Math.abs(e.clientX - drag.x);
    const slid = e.clientX - drag.x;
    drag = null;
    if (slide) {
      const from = cards.findIndex((c) => c.id === id);
      const at = from < 0 ? from : landing(placed, placed.spots[from].x + slid);
      if (from >= 0 && at !== from) {
        const ids = cards.map((c) => c.id);
        ids.splice(from, 1);
        ids.splice(at, 0, id);
        onreorder?.(ids);
      }
      return;
    }
    if (dy < -Math.max(36, cw * 0.45) && dx < -dy) onswipe(id);
    else if (!moved || Math.abs(dy) < 10) ontap(id);
  }
</script>

<div
  class="hand"
  bind:this={handEl}
  bind:clientWidth={width}
  style:--cw="{cw}px"
  style:height="{cards.length ? fanHeight(cw) : 0}px"
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  role="group"
  aria-label="Your hand"
>
  {#each cards as c, i (c.id)}
    {@const p = spots[i]}
    {@const can = !selectable || selectable.has(c.id)}
    {#if p}
      <div
        class="slot"
        class:dragging={p.held}
        style:transform="translate({p.x - p.w / 2}px, {p.y - p.w * 0.7}px) rotate({p.rot}deg)"
        style:z-index={p.z}
        onpointerdown={(e) => down(e, c.id)}
        onkeydown={(e) => key(e, c.id, i)}
        role="button"
        tabindex="0"
        aria-label={cardName(c.id)}
        aria-pressed={selected.includes(c.id)}
        aria-disabled={hints && !can}
      >
        {#if !layered}
          <Card id={c.id} selected={p.selected} playable={p.playable} dim={p.dim} fresh={p.fresh} />
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .hand {
    position: relative;
    width: 100%;
    touch-action: none;
  }
  /* each card's place, to tap or drag: the card is drawn in it, or at a table by the card layer over it */
  .slot {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    border-radius: var(--card-radius);
    transition: transform 0.3s var(--ease-out);
    cursor: pointer;
  }
  .slot.dragging {
    transition: none;
  }
  .slot:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .slot {
      transition: none;
    }
  }
</style>
