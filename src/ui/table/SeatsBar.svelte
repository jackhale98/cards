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
      el.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<svelte:window bind:innerWidth={vw} />

<div class="seats" class:display class:more-left={moreLeft} class:more-right={moreRight} bind:this={row} onscroll={edges}>
  {#each seats as s (s)}
    {@const pos = display ? ovalSeat(s, players, slotW[s], slotH[s]) : null}
    <div class="seat-slot" class:display style:left={pos?.left} style:top={pos?.top} bind:clientWidth={slotW[s]} bind:clientHeight={slotH[s]}>
      <Seat {...seat(s)} />
    </div>
  {/each}
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
  /* ---- a table screen: round the oval */
  .seats.display {
    position: absolute;
    inset: 0;
    display: block;
    padding: 0;
    margin: 0;
    overflow: visible;
  }
  .seat-slot.display {
    position: absolute;
    transform: translate(-50%, -50%);
  }
</style>
