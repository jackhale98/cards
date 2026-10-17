<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Seat from '../components/Seat.svelte';
  import { ovalSeat } from '../layout/table';

  /**
   * Everyone else at the table. On a phone: a row along the top that scrolls sideways when it's
   * too long, faded at an edge with more beyond it, sliding to whoever's turn it is. On a table
   * screen: round an oval in turn order (`players`: how many there are), seat 0 at the bottom.
   */
  let {
    seats,
    players,
    turn,
    display,
    seat,
  }: {
    /** The seats shown, in turn order from your left. */
    seats: number[];
    players: number;
    /** Whose move it is. */
    turn: number | null | undefined;
    display: boolean;
    /** Each seat's own props. */
    seat: (seat: number) => ComponentProps<typeof Seat>;
  } = $props();

  let row = $state<HTMLElement>();
  let moreLeft = $state(false);
  let moreRight = $state(false);
  // each seat's measured size, so a wide one is kept fully on screen instead of centred off the edge
  let slotW = $state<Record<number, number>>({});
  let slotH = $state<Record<number, number>>({});
  let vw = $state(innerWidth);

  function edges() {
    const el = row;
    if (!el) return;
    moreLeft = el.scrollLeft > 4;
    moreRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
  }
  $effect(() => {
    const el = row;
    const now = turn;
    void [seats.length, vw]; // (re-measure when these change)
    if (!el || display) return;
    const frame = requestAnimationFrame(() => {
      edges();
      const slot = now == null ? null : (el.querySelector(`[data-seat="${now}"]`)?.parentElement as HTMLElement | null);
      if (!slot || el.scrollWidth <= el.clientWidth) return;
      // centre the player whose turn it is
      const box = el.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const left = el.scrollLeft + r.left - box.left - (box.width - r.width) / 2;
      // (being looked along by hand: that's where it goes back to once it's let go)
      if (drag || back) rest = left;
      else el.scrollTo({ left, behavior: still() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  });

  // ---- looking along the row by hand --------------------------------------------------------
  // A finger (or a mouse) slides the row sideways, to read what everyone has played; let go, and it
  // eases back to where it was (or to whoever's turn it is by then).
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Where the row goes back to. */
  let rest = 0;
  let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
  /** The slide back under way. */
  let back = 0;
  function down(e: PointerEvent) {
    const el = row;
    if (!el || display || e.button > 0) return;
    if (back) cancelAnimationFrame(back);
    else rest = el.scrollLeft;
    back = 0;
    drag = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
  }
  function move(e: PointerEvent) {
    const el = row;
    if (!el || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      // (a tap on a seat stays a tap)
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* the pointer's already gone */
      }
    }
    el.scrollLeft = drag.left - dx;
  }
  function up(e: PointerEvent) {
    const el = row;
    if (!el || !drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (moved) slideBack(el);
  }
  function slideBack(el: HTMLElement) {
    const from = el.scrollLeft;
    const to = Math.max(0, Math.min(rest, el.scrollWidth - el.clientWidth));
    if (still() || Math.abs(to - from) < 1) {
      el.scrollLeft = to;
      return;
    }
    // (slowly: you see it go back to where it was)
    const ms = 700;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      el.scrollLeft = from + (to - from) * (1 - Math.pow(1 - k, 3));
      back = k < 1 ? requestAnimationFrame(step) : 0;
    };
    back = requestAnimationFrame(step);
  }
  $effect(() => () => cancelAnimationFrame(back));
</script>

<svelte:window bind:innerWidth={vw} />

<div class="seats-wrap" class:display>
  <div
    class="seats"
    class:display
    role="group"
    aria-label="The other players"
    bind:this={row}
    onscroll={edges}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#each seats as s (s)}
      {@const pos = display ? ovalSeat(s, players, slotW[s], slotH[s]) : null}
      <!-- (centred on its place by margins, not a transform: see .seat-slot.display) -->
      <div
        class="seat-slot"
        class:display
        style:left={pos?.left}
        style:top={pos?.top}
        style:margin-left={pos ? `${-(slotW[s] ?? 0) / 2}px` : undefined}
        style:margin-top={pos ? `${-(slotH[s] ?? 0) / 2}px` : undefined}
        bind:clientWidth={slotW[s]}
        bind:clientHeight={slotH[s]}
      >
        <Seat {...seat(s)} />
      </div>
    {/each}
  </div>
  <!-- where more players are scrolled out of view, the row fades into the cloth: over the seats' cards
       too (the card layer draws them), not by a mask on the row, which would take the speech bubbles
       under the cards -->
  {#if moreLeft}<div class="fade left" aria-hidden="true"></div>{/if}
  {#if moreRight}<div class="fade right" aria-hidden="true"></div>{/if}
</div>

<style>
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
    /* (a finger sliding sideways is ours: the row follows it, and eases back once let go) */
    touch-action: pan-y;
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
  /* seats keep their size; a row too long for the screen scrolls (and follows the turn) */
  .seat-slot {
    flex: none;
    display: flex;
  }
  .seats-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    position: relative;
  }
  /* (a table screen's seats sit round the oval, placed against the table) */
  .seats-wrap.display {
    display: contents;
  }
  .fade {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 34px;
    width: 28px;
    pointer-events: none;
    background: var(--felt);
  }
  .fade.left {
    left: 0;
    -webkit-mask-image: linear-gradient(90deg, #000, transparent);
    mask-image: linear-gradient(90deg, #000, transparent);
  }
  .fade.right {
    right: 0;
    -webkit-mask-image: linear-gradient(270deg, #000, transparent);
    mask-image: linear-gradient(270deg, #000, transparent);
  }
  /* ---- a table screen: round the oval */
  .seats.display {
    position: absolute;
    inset: 0;
    display: block;
    padding: 0;
    margin: 0;
    overflow: visible;
  }
  /* (centred by margins, above: a transform would make each seat a layer of its own, and its
     speech bubble couldn't come up over the card layer, which draws the seat's cards) */
  .seat-slot.display {
    position: absolute;
  }
</style>
