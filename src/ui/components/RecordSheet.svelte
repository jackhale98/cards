<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { forgetRecord, loadRecord, summarise } from '../record';

  /** Your record across game nights (kept on this device only: see record.ts). */
  let { onclose }: { onclose: () => void } = $props();
  let list = $state(loadRecord());
  const sum = $derived(summarise(list));
  let confirming = $state(false);
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
</script>

<Sheet title="Your record" {onclose}>
  {#if !list.length}
    <p class="small">Finish a game and it shows up here. Your record stays on this device: nothing is sent anywhere.</p>
  {:else}
    <div class="tiles">
      <div><b>{sum.played}</b><span>game{sum.played === 1 ? '' : 's'}</span></div>
      <div><b>{sum.won}</b><span>won</span></div>
      <div><b>{pct(sum.won, sum.played)}%</b><span>win rate</span></div>
      <div><b>{sum.nights}</b><span>night{sum.nights === 1 ? '' : 's'}</span></div>
    </div>

    <div class="eyebrow">By game</div>
    <table>
      <thead><tr><th scope="col">Game</th><th scope="col">Won</th><th scope="col" class="bar-col"><span class="sr-only">Share won</span></th></tr></thead>
      <tbody>
        {#each sum.games as g (g.name)}
          <tr>
            <th scope="row">{g.name}</th>
            <td>{g.won} of {g.played}</td>
            <td class="bar-col" aria-hidden="true"><span class="track"><span class="fill" style:width="{pct(g.won, g.played)}%"></span></span></td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if sum.rivals.length}
      <div class="eyebrow">Who you play with</div>
      <table>
        <thead><tr><th scope="col">Name</th><th scope="col">Games</th><th scope="col">You finished ahead</th><th scope="col">Behind</th></tr></thead>
        <tbody>
          {#each sum.rivals.slice(0, 12) as r (r.name)}
            <tr><th scope="row">{r.name}</th><td>{r.played}</td><td>{r.beat}</td><td>{r.lostTo}</td></tr>
          {/each}
        </tbody>
      </table>
      <p class="small">By name, so two friends with the same name count as one.</p>
    {/if}

    <p class="small">Kept on this device only: nothing is sent anywhere. Clearing the browser's data clears it too.</p>
    {#if confirming}
      <div class="row">
        <button
          class="btn danger"
          onclick={() => {
            forgetRecord();
            list = [];
            confirming = false;
          }}>Clear it</button
        >
        <button class="btn quiet" onclick={() => (confirming = false)}>Keep it</button>
      </div>
    {:else}
      <button class="btn quiet" onclick={() => (confirming = true)}>Clear my record</button>
    {/if}
  {/if}
</Sheet>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.9rem;
  }
  .tiles div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.55rem 0.3rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.2);
  }
  .tiles b {
    font-size: 1.45rem;
    font-variant-numeric: tabular-nums;
  }
  .tiles span {
    font-size: 0.75rem;
    color: var(--ink-dim);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.9rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 0.32rem 0.4rem;
    text-align: right;
    white-space: nowrap;
  }
  thead th {
    color: var(--ink-dim);
    font-weight: 600;
    font-size: 0.75rem;
  }
  tbody th,
  thead th:first-child {
    text-align: left;
    font-weight: 500;
  }
  tbody tr + tr {
    border-top: 1px solid var(--line);
  }
  .bar-col {
    width: 34%;
  }
  .track {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--gold);
  }
  .small {
    color: var(--ink-dim);
    font-size: 0.8rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  @media (max-width: 420px) {
    .tiles {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
