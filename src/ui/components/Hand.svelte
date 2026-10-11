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
    ontap: (id: string) => void;
    onswipe: (id: string) => void;
  }
  let { cards, cw, selected, selectable, fresh = [], ontap, onswipe }: Props = $props();

  let width = $state(0);
  let drag = $state<{ id: string; x: number; y: number; dy: number; moved: boolean } | null>(null);

  const layout = $derived.by(() => {
    const n = cards.length;
    if (!n || !width) return [];
    const gap = Math.min(cw * 0.62, n > 1 ? (width - cw - 8) / (n - 1) : 0);
    const total = cw + gap * (n - 1);
    const left = (width - total) / 2;
    const mid = (n - 1) / 2;
    const spread = Math.min(3.2, 26 / n);
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
    drag = { id, x: e.clientX, y: e.clientY, dy: 0, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const dx = e.clientX - drag.x;
    if (Math.abs(dy) > 6 || Math.abs(dx) > 6) drag.moved = true;
    drag.dy = Math.min(0, dy);
  }
  function up(e: PointerEvent) {
    if (!drag) return;
    const { id, dy, moved } = drag;
    const dx = Math.abs(e.clientX - drag.x);
    drag = null;
    if (dy < -Math.max(36, cw * 0.45) && dx < -dy) onswipe(id);
    else if (!moved || Math.abs(dy) < 10) ontap(id);
  }
</script>

<div
  class="hand"
  bind:clientWidth={width}
  style:--cw="{cw}px"
  style:height="{cw * 1.4 + 26}px"
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  role="list"
>
  {#each cards as c, i (c.id)}
    {@const p = layout[i] ?? { x: 0, rot: 0, y: 0 }}
    {@const can = !selectable || selectable.has(c.id)}
    <div
      class="slot"
      class:dragging={drag?.id === c.id}
      style:left="{p.x}px"
      style:transform="translateY({p.y + (drag?.id === c.id ? drag.dy : 0)}px) rotate({p.rot}deg)"
      style:z-index={i + 1}
      onpointerdown={(e) => down(e, c.id)}
      in:receive={{ key: c.id }}
      out:send={{ key: c.id }}
      role="listitem"
    >
      <Card
        id={c.id}
        selected={selected.includes(c.id)}
        playable={!!selectable && can && selectable.size < cards.length}
        dim={!!selectable && !can}
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
