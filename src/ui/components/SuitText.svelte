<script lang="ts">
  /** Text with the red suit symbols (♥ ♦) in red, so suits read at a glance; ♠ ♣ keep the text colour.
   * (With four-colour suits on, ♦ goes blue and ♣ green: the classes below.) */
  let { text }: { text: string | number } = $props();
  const parts = $derived(String(text).split(/([♠♥♦♣])/));
  // U+FE0E asks for the plain (text) symbol: some phones would otherwise draw ♥ as an emoji, ignoring the colour
</script>

{#each parts as p, i (i)}{#if p === '♥'}<span class="suit-red">{p}&#xFE0E;</span>{:else if p === '♦'}<span class="suit-red suit-d">{p}&#xFE0E;</span
    >{:else if p === '♣'}<span class="suit-c">{p}&#xFE0E;</span>{:else if p === '♠'}{p}&#xFE0E;{:else}{p}{/if}{/each}
