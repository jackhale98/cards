<script lang="ts">
  import { app } from '../../app.svelte';

  const LABEL: Record<string, string> = { nostr: 'Nostr', mqtt: 'MQTT', torrent: 'WebTorrent', local: 'This browser' };
  const status = $derived(app.netStatus);
  const up = $derived(status?.networks.reduce((n, x) => n + x.up, 0) ?? 0);
  const local = $derived(status?.networks.some((n) => n.kind === 'local'));
  // give relays a few seconds to connect before warning
  let grace = $state(true);
  $effect(() => {
    const t = setTimeout(() => (grace = false), 8000);
    return () => clearTimeout(t);
  });
</script>

{#if status}
  <div class="net" class:warn={!local && !up && !grace}>
    {#if local}
      <span class="dot good"></span> Local test mode (tabs in this browser only)
    {:else if up}
      <span class="dot good"></span> Open for players
      <small>{status.networks.filter((n) => n.total).map((n) => `${LABEL[n.kind] ?? n.kind} ${n.up}/${n.total}`).join(' · ')}</small>
    {:else if grace}
      <span class="dot wait"></span> Connecting to relay networks…
    {:else}
      <span class="dot bad"></span> Can't reach any relay network — players can't join yet. Check this device's internet
      connection.
    {/if}
  </div>
{/if}

<style>
  .net {
    font-size: 0.75rem;
    color: var(--ink-dim);
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    justify-content: center;
    line-height: 1.35;
  }
  .net.warn {
    color: #ffb4a2;
  }
  small {
    width: 100%;
    text-align: center;
    color: var(--ink-faint);
    font-size: 0.66rem;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex: none;
  }
  .good {
    background: #7bd389;
    box-shadow: 0 0 6px #7bd389;
  }
  .wait {
    background: var(--gold);
    animation: blink 1s ease-in-out infinite alternate;
  }
  .bad {
    background: var(--danger);
  }
  @keyframes blink {
    to {
      opacity: 0.3;
    }
  }
</style>
