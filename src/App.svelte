<script lang="ts">
  import { app } from './app.svelte';
  import Toast from './ui/components/Toast.svelte';
  import Home from './ui/screens/Home.svelte';
  import Lobby from './ui/screens/Lobby.svelte';
  import Table from './ui/screens/Table.svelte';
  import TvScreen from './ui/screens/TvScreen.svelte';

  $effect(() => {
    void app.sync();
  });

  const route = $derived(app.route);
  const view = $derived(app.view);

  // seconds spent looking for the table, for progress and troubleshooting hints
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const waited = $derived(app.joinStarted ? Math.max(0, Math.round((now - app.joinStarted) / 1000)) : 0);
  const LABEL: Record<string, string> = { relay: 'the Lamplight relay', nostr: 'Nostr relays', mqtt: 'MQTT brokers', torrent: 'WebTorrent trackers', local: 'this browser' };
  const trying = $derived(app.netStatus?.networks.map((n) => LABEL[n.kind] ?? n.kind).join(', ') ?? '');
  // local test mode has no relays to wait for
  const relaysUp = $derived(app.net === 'local' ? 1 : (app.netStatus?.networks.reduce((n, x) => n + x.up, 0) ?? 0));
</script>

{#if route.name === 'home'}
  <Home code={route.code} />
{:else if route.name === 'tv'}
  <TvScreen />
{:else if !view}
  <div class="connecting">
    <div class="spinner"></div>
    <p>Finding table <b>{route.code}</b>… <span class="secs">{waited}s</span></p>
    {#if trying}<p class="small">Looking via {trying}{relaysUp ? '' : ' (connecting…)'}</p>{/if}
    {#if waited < 12}
      <p class="small">Joining usually takes a few seconds.</p>
    {:else}
      <ul class="tips">
        <li>Is the host's screen on, with the table open? Phones pause background tabs.</li>
        <li>Double-check the code: <b>{route.code}</b>.</li>
        {#if app.net === 'local'}<li>Local test mode only links tabs in the same browser — not private tabs or other devices.</li>{/if}
        {#if app.netStatus && !relaysUp}<li>This device can't reach the internet — check its connection.</li>{/if}
        <li>Joining from somewhere else works too — the host just needs to be online with the table open.</li>
      </ul>
    {/if}
    <div class="row">
      {#if waited >= 12}<button class="btn" onclick={() => app.rejoin()}>Try again</button>{/if}
      <button class="btn quiet" onclick={() => app.go('/')}>Cancel</button>
    </div>
  </div>
{:else if view.state && view.lobby.started}
  {#key view.lobby.code}
    <Table {view} display={route.name === 'display'} />
  {/key}
{:else}
  <Lobby {view} />
{/if}

{#if view && !app.isHost && !app.connected}
  <div class="reconnect">Reconnecting…</div>
{/if}

<Toast />

<style>
  .connecting {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
    padding: 2rem;
  }
  .connecting p {
    margin: 0;
  }
  .small {
    color: var(--ink-dim);
    font-size: 0.85rem;
    max-width: 24rem;
  }
  .secs {
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .tips {
    text-align: left;
    max-width: 30rem;
    margin: 0.2rem 0;
    padding-left: 1.1rem;
    color: var(--ink-dim);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 3px solid var(--line);
    border-top-color: var(--gold);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .reconnect {
    position: fixed;
    z-index: 90;
    bottom: calc(10px + var(--safe-b));
    left: 50%;
    transform: translateX(-50%);
    padding: 0.4rem 1rem;
    border-radius: 999px;
    background: rgba(201, 154, 46, 0.95);
    color: #2a1d05;
    font-weight: 600;
    font-size: 0.85rem;
  }
</style>
