<script lang="ts">
  import { app } from '../../app.svelte';

  $effect(() => {
    const t = app.toast;
    if (!t) return;
    const timer = setTimeout(() => {
      if (app.toast?.id === t.id) app.toast = null;
    }, 2600);
    return () => clearTimeout(timer);
  });
</script>

{#if app.toast}
  {#key app.toast.id}
    <div class="toast" role="status">{app.toast.text}</div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    z-index: 100;
    left: 50%;
    top: calc(12px + var(--safe-t));
    transform: translateX(-50%);
    padding: 0.6rem 1.1rem;
    border-radius: 999px;
    background: rgba(20, 20, 20, 0.92);
    border: 1px solid var(--line);
    font-size: 0.9rem;
    box-shadow: var(--shadow);
    animation: drop 0.3s var(--ease-spring);
    max-width: calc(100vw - 32px);
    text-align: center;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, -16px);
    }
  }
</style>
