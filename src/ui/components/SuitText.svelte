<script lang="ts">
  /** Text with the red suit symbols (♥ ♦) in red, so suits read at a glance; ♠ ♣ keep the text colour. */
  let { text }: { text: string | number } = $props();
  const parts = $derived(String(text).split(/([♠♥♦♣])/));
  // U+FE0E asks for the plain (text) symbol: some phones would otherwise draw ♥ as an emoji, ignoring the colour
</script>

{#each parts as p, i (i)}{#if p === '♥' || p === '♦'}<span class="suit-red">{p}&#xFE0E;</span>{:else if p === '♠' || p === '♣'}{p}&#xFE0E;{:else}{p}{/if}{/each}
