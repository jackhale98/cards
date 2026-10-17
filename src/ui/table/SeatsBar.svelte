<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Seat from '../components/Seat.svelte';
  import { ovalSeat } from '../layout/table';

  /**
   * Everyone else at the table. On a phone: a row along the top that scrolls sideways when it's
   * too long, faded at an edge with more beyond it. It stays where you scroll it, and slides to
   * whoever's turn it is when the turn moves on. On a table screen: round an oval in turn order
   * (`players`: how many there are), seat 0 at the bottom.
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
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Slide the row to centre the player whose turn it is (as far as the row goes). */
  function follow(el: HTMLElement, now: number | null | undefined) {
    const slot = now == null ? null : (el.querySelector(`[data-seat="${now}"]`)?.parentElement as HTMLElement | null);
    if (!slot || el.scrollWidth <= el.clientWidth) return;
    const box = el.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    el.scrollTo({ left: el.scrollLeft + r.left - box.left - (box.width - r.width) / 2, behavior: still() ? 'auto' : 'smooth' });
  }

  // The row moves by itself only when the turn moves on (or the row changes size): otherwise it
  // stays where it was left, so you can read along it. A turn that moves while your finger is on
  // the row waits until you let go.
  let followed = '';
  let pending = false;
  $effect(() => {
    const el = row;
    const now = turn;
    const key = `${now}|${seats.length}|${vw}`;
    if (!el || display) return;
    const moved = key !== followed;
    followed = key;
    const frame = requestAnimationFrame(() => {
      edges();
      if (!moved) return;
      if (holding) pending = true;
      else follow(el, now);
    });
    return () => cancelAnimationFrame(frame);
  });

  // ---- looking along the row by hand --------------------------------------------------------
  // A finger slides it as the phone slides anything (momentum, and a stop at each end); a mouse
  // drags it. Either way it stays where it's left.
  let holding = false;
  let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
  function hold(on: boolean) {
    holding = on;
    if (on || !pending || !row) return;
    pending = false;
    follow(row, turn);
  }
  function down(e: PointerEvent) {
    const el = row;
    if (!el || display || e.pointerType !== 'mouse' || e.button > 0) return;
    hold(true);
    drag = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
  }
  function move(e: PointerEvent) {
    const el = row;
    if (!el || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      // (a click on a seat stays a click)
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
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    hold(false);
  }
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
    ontouchstart={() => hold(true)}
    ontouchend={(e) => e.touches.length || hold(false)}
    ontouchcancel={() => hold(false)}
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
    /* (a finger slides it as the phone slides anything; see `hold`) */
    touch-action: pan-x pan-y;
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
