<script lang="ts">
  /** A small signal light for a player's connection: green < 120 ms, amber < 400 ms, red beyond. */
  let { ms, label = false }: { ms: number | null | undefined; label?: boolean } = $props();
  const level = $derived(ms == null ? 'none' : ms < 120 ? 'good' : ms < 400 ? 'ok' : 'slow');
</script>

{#if ms != null}
  <span class="ping {level}" title="{ms} ms round trip to the host">
    <i></i>{#if label}{ms} ms{/if}
  </span>
{/if}

<style>
  .ping {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }
  i {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--good);
    box-shadow: 0 0 6px currentColor;
  }
  .good i {
    background: #7bd389;
    color: #7bd389;
  }
  .ok i {
    background: var(--gold);
    color: var(--gold);
  }
  .slow i {
    background: var(--danger);
    color: var(--danger);
  }
</style>
