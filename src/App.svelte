<script lang="ts">
  import { app } from './app.svelte';
  import Toast from './ui/components/Toast.svelte';
  import Home from './ui/screens/Home.svelte';
  import Lobby from './ui/screens/Lobby.svelte';
  import Table from './ui/screens/Table.svelte';

  $effect(() => {
    void app.sync();
  });

  const route = $derived(app.route);
  const view = $derived(app.view);
</script>

{#if route.name === 'home'}
  <Home code={route.code} />
{:else if !view}
  <div class="connecting">
    <div class="spinner"></div>
    <p>Finding table <b>{route.code}</b>…</p>
    <p class="small">Make sure the host has the table open. Joining usually takes a few seconds.</p>
    <button class="btn quiet" onclick={() => app.go('/')}>Cancel</button>
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
