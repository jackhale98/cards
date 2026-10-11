<script lang="ts">
  import type { ZoneState } from '../../engine/types';
  import { receive, send } from '../motion';
  import { isHidden } from '../../engine/redact';
  import Card from './Card.svelte';

  interface Props {
    zone: ZoneState;
    cw: number;
    /** Viewer seat and player count, for placing trick cards toward their owners. */
    you: number;
    players: number;
    selected: string[];
    selectable: Set<string> | null;
    ontap: (id: string) => void;
    /** Tap on an empty spot / the stack itself (e.g. draw from the deck). */
    onzone?: () => void;
    zoneActive?: boolean;
  }
  let { zone, cw, you, players, selected, selectable, ontap, onzone, zoneActive = false }: Props = $props();

  /** Trick cards sit between the centre and the seat that played them. */
  function trickPos(by: number | undefined) {
    const rel = ((by ?? 0) - Math.max(0, you) + players) % players;
    const angle = Math.PI / 2 + (rel * 2 * Math.PI) / players;
    return { x: Math.cos(angle) * cw * 0.9, y: Math.sin(angle) * cw * 0.42, rot: (rel % 2 ? 1 : -1) * (3 + rel * 2) };
  }
  const top = $derived(zone.cards[zone.cards.length - 1]);
</script>

<div class="zone" data-zone={zone.id} data-layout={zone.layout} style:--cw="{cw}px">
  {#if zone.label && zone.layout !== 'trick'}<div class="label eyebrow" data-flip>{zone.label}{#if zone.layout === 'stack'} · {zone.cards.length}{/if}</div>{/if}

  {#if zone.layout === 'stack'}
    <button class="stack" data-flip class:active={zoneActive} onclick={() => (top && selectable?.has(top.id) ? ontap(top.id) : onzone?.())} disabled={!zoneActive && !(top && selectable?.has(top.id))}>
      {#if zone.cards.length > 1}<div class="under"><Card id="?u" /></div>{/if}
      {#if zone.cards.length > 8}<div class="under two"><Card id="?u2" /></div>{/if}
      {#if top && isHidden(top.id)}
        <!-- a face-down top just sits there: cards drawn from it fly out on their own -->
        <div class="top"><Card id={top.id} /></div>
      {:else if top}
        {#key top.id}
          <div class="top" in:receive={{ key: top.id }} out:send={{ key: top.id }}>
            <Card id={top.id} down={top.up === false} selected={selected.includes(top.id)} />
          </div>
        {/key}
      {:else}
        <div class="empty"></div>
      {/if}
    </button>
  {:else if zone.layout === 'trick'}
    <div class="trick" data-flip>
      {#each zone.cards as c (c.id)}
        {@const p = trickPos(c.by)}
        <div class="tcard" style:transform="translate(-50%, -50%) translate({p.x}px, {p.y}px) rotate({p.rot}deg)" in:receive={{ key: c.id }} out:send={{ key: c.id }}>
          <Card id={c.id} />
        </div>
      {/each}
    </div>
  {:else}
    <div class="spread">
      {#each zone.cards as c, i (c.id)}
        <button
          class="scard"
          data-flip
          class:newgroup={i > 0 && c.group != null && c.group !== zone.cards[i - 1].group}
          onclick={() => ontap(c.id)}
          disabled={!selectable?.has(c.id)}
          in:receive={{ key: c.id }}
          out:send={{ key: c.id }}
        >
          <Card id={c.id} down={c.up === false} selected={selected.includes(c.id)} dim={c.dim} />
        </button>
      {:else}
        <div class="empty wide" data-flip></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .zone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .label {
    font-size: 0.62rem;
    white-space: nowrap;
    position: relative;
    z-index: 1;
  }
  .stack {
    position: relative;
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    padding: 0;
  }
  .stack:disabled {
    cursor: default;
  }
  .stack.active .top {
    filter: drop-shadow(0 0 8px rgba(233, 196, 106, 0.8));
  }
  .stack > div {
    position: absolute;
    inset: 0;
  }
  .under {
    transform: translate(2px, 2px);
  }
  .under.two {
    transform: translate(4px, 4px);
    z-index: -1;
  }
  .empty {
    width: var(--cw);
    height: calc(var(--cw) * 1.4);
    border-radius: var(--card-radius);
    border: 1.5px dashed rgba(255, 255, 255, 0.18);
    font-size: calc(var(--cw) / 5);
  }
  .empty.wide {
    width: calc(var(--cw) * 2);
  }
  .spread {
    position: relative;
    display: flex;
    gap: calc(var(--cw) * 0.1);
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
  }
  .spread:has(> :nth-child(8)) .scard + .scard {
    margin-left: calc(var(--cw) * -0.45);
  }
  /* a whole hand on the table (bridge dummy): just the corner indices show */
  .spread:has(> :nth-child(12)) .scard + .scard {
    margin-left: calc(var(--cw) * -0.66);
  }
  .scard {
    position: relative;
    padding: 0;
  }
  .spread .scard.newgroup {
    margin-left: calc(var(--cw) * 0.22) !important;
  }
  .spread:has(> :nth-child(12)) .scard.newgroup {
    margin-left: calc(var(--cw) * -0.4) !important;
  }
  .scard:disabled {
    cursor: default;
  }
  .trick {
    position: relative;
    width: calc(var(--cw) * 3);
    height: calc(var(--cw) * 2.25);
  }
  .tcard {
    position: absolute;
    left: 50%;
    top: 50%;
  }
</style>
