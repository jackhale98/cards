<script lang="ts">
  /** A phone held upright: the table is laid out for one on its side. Asked once a visit. */
  const KEY = 'cards.portraitOk';
  const remembered = () => {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };
  let ok = $state(remembered());
  function carryOn() {
    // (remembered for the visit, so a new table doesn't ask again)
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode: just this table */
    }
    ok = true;
  }
</script>

{#if !ok}
  <div class="rotate">
    <div class="phone"></div>
    <p>Turn your phone sideways for the best view</p>
    <button class="btn quiet" onclick={carryOn}>Continue anyway</button>
  </div>
{/if}

<style>
  .rotate {
    display: none;
  }
  @media (orientation: portrait) and (max-width: 600px) {
    .rotate {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      text-align: center;
      padding: 2rem;
      background: rgba(5, 18, 14, 0.96);
    }
    .phone {
      width: 44px;
      height: 78px;
      border: 3px solid var(--ink);
      border-radius: 10px;
      animation: turn 2s var(--ease-out) 3;
    }
  }
  @keyframes turn {
    0%,
    20% {
      transform: rotate(0);
    }
    60%,
    100% {
      transform: rotate(-90deg);
    }
  }
</style>
