<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { CardRef, ZoneState } from '../../engine/types';
  import ActionBar from '../components/ActionBar.svelte';
  import Hand from '../components/Hand.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Zone from '../components/Zone.svelte';
  import { TAP } from '../layout';
  import { MIN_CW, PANELS, panelPad, sheetRoom, spreadCw, type Labels } from '../layout/table';

  /** What a pile needs to be tapped and played onto (the table's zoneHooks). */
  type Hooks = Omit<ComponentProps<typeof Zone>, 'zone' | 'cw'>;

  /**
   * Everyone's melds full screen (a phone's strip is a sliver): to browse, and with your hand and
   * your moves under them, to meld and lay off from here.
   */
  let {
    zones,
    hand,
    hints,
    selectable,
    you,
    players,
    zone,
    bar,
    labels,
    ontap,
    onswipe,
    onreorder,
    onclose,
  }: {
    zones: ZoneState[];
    hand: CardRef[];
    hints: boolean;
    /** The cards you may pick now. */
    selectable: Set<string> | null;
    you: number;
    players: number;
    zone: (z: ZoneState) => Hooks;
    bar: ComponentProps<typeof ActionBar>;
    labels: Labels;
    ontap: (id: string) => void;
    onswipe: (id: string) => void;
    onreorder: (ids: string[]) => void;
    onclose: () => void;
  } = $props();

  /** The room the melds have (above your hand), measured. */
  let w = $state(0);
  let h = $state(0);
  let vh = $state(innerHeight);
  /** How wide a panel's cards may spread, and how far apart their rows are (1rem: the sheet isn't scaled up). */
  const room = $derived(w ? sheetRoom(w, 16) : Infinity);
  const rowGap = PANELS.cardRowGap * 16;
  /** The biggest cards that let them all fit the room, so a few melds fill the screen; only past a readable smallest size does the page scroll. */
  const cw = $derived(
    spreadCw({
      zones,
      w,
      h,
      labels,
      whereOf: (z, zcw) => ({
        cw: zcw,
        you,
        players,
        style: 'sheet',
        maxW: room,
        rowGap,
        tap: z.cards.some((c) => selectable?.has(c.id)) ? TAP : undefined,
      }),
    }),
  );
  // (your hand under them stays small: the melds are what you're looking at)
  const handCw = $derived(Math.max(MIN_CW, Math.min(52, Math.round(vh * 0.1))));
</script>

<svelte:window bind:innerHeight={vh} />

<Sheet title="On the table" full {onclose}>
  <!-- (its sizes from layout/table.ts, PANELS: spreadCw reckons with the same numbers) -->
  <div
    class="spread-all"
    style:gap="{PANELS.sheet.gap}px"
    style:padding="{PANELS.sheet.pad.top}px {PANELS.sheet.pad.x}px {PANELS.sheet.pad.bottom}px"
    style:--panel={panelPad}
    bind:clientWidth={w}
    bind:clientHeight={h}
  >
    {#each zones as z (z.id)}
      <Zone zone={z} {cw} inline style="sheet" {room} {rowGap} {...zone(z)} />
    {/each}
  </div>
  <div class="spread-dock">
    <div class="spread-hand">
      <Hand cards={hand} cw={handCw} inline selected={bar.selected} {selectable} {hints} {ontap} {onswipe} {onreorder} />
    </div>
    <div class="spread-acts">
      <ActionBar {...bar} />
    </div>
  </div>
</Sheet>

<style>
  /* everyone's melds full screen: panels that wrap, the page scrolling down */
  .spread-all {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
  }
  .spread-all > :global(.zone) {
    max-width: 100%;
    padding: var(--panel);
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
</style>
