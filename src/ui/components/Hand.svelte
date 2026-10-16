<script lang="ts">
  import type { CardRef } from '../../engine/types';
  import { receive, send } from '../motion';
  import Card from './Card.svelte';

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
    /** Only the room for the hand: the card layer draws its cards (see CardLayer.svelte). */
    ghost?: boolean;
  }
  let { cards, cw, selected, selectable, fresh = [], hints = true, ontap, onswipe, onreorder, ghost = false }: Props = $props();

  let width = $state(0);
  /** A card being dragged: up (to play it) or, with `slide`, sideways (to move it in the hand). */
  let drag = $state<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean; slide: boolean } | null>(null);

  const layout = $derived.by(() => {
    const n = cards.length;
    if (!n || !width) return [];
    const mid = (n - 1) / 2;
    const spread = Math.min(3.2, 26 / n);
    // the outer cards lean out, turning about a point below the card (transform-origin 50% 120%),
    // so their top corners reach past the card's own width: leave room for that at each end (or
    // they'd run under your name and the buttons beside the hand)
    const lean = ((spread * mid) / 180) * Math.PI;
    const reach = n > 1 ? Math.max(0, (cw / 2) * (Math.cos(lean) - 1) + 1.2 * cw * 1.4 * Math.sin(lean)) : 0;
    const room = width - 2 * reach;
    const gap = Math.min(cw * 0.62, n > 1 ? (room - cw - 8) / (n - 1) : 0);
    const total = cw + gap * (n - 1);
    const left = (width - total) / 2;
    return cards.map((_, i) => {
      const off = i - mid;
      return {
        x: left + i * gap,
        rot: off * spread,
        y: Math.abs(off) ** 2 * Math.min(1.4, 40 / (n * n)) + Math.abs(off) * 0.6,
      };
    });
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
  /** Where a card slid sideways by `dx` lands: the slot nearest where it was let go. */
  function landing(from: number, dx: number): number {
    const x = (layout[from]?.x ?? 0) + dx;
    let best = from;
    layout.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(layout[best].x - x)) best = i;
    });
    return best;
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
      const at = landing(from, slid);
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
  bind:clientWidth={width}
  style:--cw="{cw}px"
  style:height={cards.length ? 'calc(var(--cw) * 1.4 + 26px)' : '0px'}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  role={ghost ? undefined : 'group'}
  aria-label={ghost ? undefined : 'Your hand'}
  data-layer={ghost ? 'hand' : undefined}
>
  {#each ghost ? [] : cards as c, i (c.id)}
    {@const p = layout[i] ?? { x: 0, rot: 0, y: 0 }}
    {@const can = !selectable || selectable.has(c.id)}
    <!-- (data-flip: a card whose place in the hand changes, as when the hand is sorted afresh, is
         moved in the page, which loses its transition: the table slides it there instead) -->
    <div
      class="slot"
      data-flip
      class:dragging={drag?.id === c.id}
      style:left="{p.x + (drag?.id === c.id ? drag.dx : 0)}px"
      style:transform="translateY({p.y + (drag?.id === c.id ? drag.dy : 0)}px) rotate({p.rot}deg)"
      style:z-index={drag?.id === c.id && drag.slide ? cards.length + 1 : i + 1}
      onpointerdown={(e) => down(e, c.id)}
      onkeydown={(e) => key(e, c.id, i)}
      in:receive={{ key: c.id }}
      out:send={{ key: c.id }}
      role="button"
      tabindex="0"
      aria-pressed={selected.includes(c.id)}
      aria-disabled={hints && !can}
    >
      <Card
        id={c.id}
        selected={selected.includes(c.id)}
        playable={hints && !!selectable && can && selectable.size < cards.length}
        dim={hints && !!selectable && !can}
        fresh={fresh.includes(c.id)}
      />
    </div>
  {/each}
</div>

<style>
  .hand {
    position: relative;
    width: 100%;
    touch-action: none;
  }
  /* (cards that change size, a hand grown long after picking up a pile, ease into it) */
  @media (prefers-reduced-motion: no-preference) {
    .hand {
      transition: --cw 0.35s var(--ease-out);
    }
  }
  .slot {
    position: absolute;
    bottom: 6px;
    transform-origin: 50% 120%;
    transition:
      left 0.3s var(--ease-out),
      transform 0.3s var(--ease-out);
    cursor: pointer;
  }
  .slot.dragging {
    transition: none;
  }
</style>
