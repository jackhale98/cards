<script lang="ts">
  /**
   * The hand's summary, "This hand: Ann +40 · Bo −40": under the middle, or on a phone on its side
   * in the column on the left (`side`), where the column is free once the hand is over.
   */
  let { recap, side = false, h = $bindable(0) }: { recap: string; side?: boolean; h?: number } = $props();
</script>

<p class="recap" class:side aria-label="This hand: {recap}" bind:clientHeight={h}>This hand: {recap}</p>

<style>
  .recap {
    position: relative;
    z-index: 3;
    margin: 0;
    max-width: calc(100% - 16px);
    padding: 0.3rem 0.9rem;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.28);
    color: var(--ink);
    font-size: 0.82rem;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .recap.side {
    flex-shrink: 0;
    max-width: 100%;
    font-size: 0.74rem;
    text-align: left;
    border-radius: 12px;
    padding: 0.3rem 0.6rem;
  }
</style>
