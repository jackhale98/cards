<script lang="ts">
  import { app } from '../../app.svelte';
  import type { ActionSpec } from '../../engine/types';
  import { getGame } from '../../games';
  import type { View } from '../../net/protocol';
  import ActionBar from '../components/ActionBar.svelte';
  import Hand from '../components/Hand.svelte';
  import Seat from '../components/Seat.svelte';
  import Zone from '../components/Zone.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { haptic } from '../motion';
  import { seatColor } from '../seatColors';

  let { view, display = false }: { view: View; display?: boolean } = $props();

  const s = $derived(view.state!);
  const you = $derived(view.you);
  const status = $derived(view.status!);
  const game = $derived(getGame(s.game));
  const n = $derived(s.players.length);
  const showChips = $derived(!!game.config.chips);

  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  const handCw = $derived(Math.round(Math.max(52, Math.min(112, vh * 0.2, vw * 0.11))));
  const centerCw = $derived(Math.round(Math.max(44, Math.min(display ? 130 : 92, vh * (display ? 0.2 : 0.15), vw * 0.09))));

  /** Opponents in turn order starting to your left. */
  const others = $derived.by(() => {
    if (you < 0) return s.players.map((_, i) => i);
    return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
  });

  const myHand = $derived(you >= 0 ? (s.zones[`hand:${you}`]?.cards ?? []) : []);
  const centerZones = $derived(Object.values(s.zones).filter((z) => z.area === 'center'));
  const seatZone = (seat: number) => s.zones[`hand:${seat}`]?.cards ?? [];

  // ---- selection --------------------------------------------------------------------------
  let selected = $state<string[]>([]);
  const selecting = $derived(view.actions.filter((a) => a.select));
  const selectable = $derived(selecting.length ? new Set(selecting.flatMap((a) => a.select!.cards)) : null);
  const quick = $derived(view.actions.find((a) => a.quick && a.select));
  const maxSelect = $derived(Math.max(0, ...selecting.map((a) => a.select!.max)));

  // drop selections that are no longer valid after each update
  $effect(() => {
    const valid = selectable;
    const keep = selected.filter((id) => valid?.has(id));
    if (keep.length !== selected.length) selected = keep;
  });

  // nudge when it becomes your turn
  let lastTurn = -1;
  $effect(() => {
    if (s.turn === you && lastTurn !== you && you >= 0) haptic(18);
    lastTurn = s.turn ?? -1;
  });

  function tap(id: string) {
    if (!selectable?.has(id)) return;
    if (selected.includes(id)) {
      // tapping a lone selected card plays it when there's a quick action
      if (quick && selected.length === 1 && quick.select!.cards.includes(id)) return run(quick);
      selected = selected.filter((x) => x !== id);
    } else if (maxSelect === 1) {
      selected = [id];
    } else if (selected.length < maxSelect) {
      selected = [...selected, id];
    }
    haptic(5);
  }

  function swipe(id: string) {
    if (!quick || !quick.select!.cards.includes(id)) return tap(id);
    const sel = selected.includes(id) && selected.length <= quick.select!.max ? selected : [id];
    run(quick, undefined, sel);
  }

  function run(spec: ActionSpec, amount?: number, cards = selected) {
    app.act({ type: spec.type, cards: spec.select ? [...cards] : undefined, amount });
    if (spec.select) selected = [];
    haptic(10);
  }

  const drawAction = $derived(view.actions.find((a) => a.type === 'draw'));

  // ---- chrome -----------------------------------------------------------------------------
  let sheet = $state<'menu' | 'scores' | null>(null);
  let bannerHidden = $state<number | null>(null);
  const showBanner = $derived(!!status.banner && bannerHidden !== s.v);
  let portraitOk = $state(false);
  let fullscreen = $state(!!document.fullscreenElement);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as any).lock?.('landscape').catch(() => {});
      }
    } catch {
      app.say('Fullscreen isn’t available here — try “Add to Home Screen”.');
    }
  }

  // keep the screen awake while at the table
  $effect(() => {
    let lock: any = null;
    const get = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* not supported */
      }
    };
    const onVis = () => document.visibilityState === 'visible' && get();
    void get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.();
    };
  });

  const me = $derived(you >= 0 ? s.players[you] : null);
  const myInfo = $derived(you >= 0 ? status.seats[you] : undefined);
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<div class="table" class:display>
  <!-- top: menu + opponents + scores -->
  <header>
    <button class="icon" onclick={() => (sheet = 'menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <div class="seats">
      {#each others as seat (seat)}
        <Seat
          player={s.players[seat]}
          info={status.seats[seat]}
          cards={seatZone(seat)}
          turn={s.turn === seat}
          connected={view.lobby.seats[seat]?.connected ?? true}
          {showChips}
          compact={others.length > 4}
        />
      {/each}
    </div>
    <button class="icon" onclick={() => (sheet = 'scores')} aria-label="Scores and log">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 4h10v3a5 5 0 0 1-10 0V4Zm5 8v4m-4 4h8m-4-4v4M7 6H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </header>

  <!-- centre: shared zones, pot, headline -->
  <main>
    <div class="headline" class:mine={s.turn === you && you >= 0}>{status.headline}</div>
    <div class="zones">
      {#each centerZones as z (z.id)}
        <Zone
          zone={z}
          cw={centerCw}
          {you}
          players={n}
          {selected}
          {selectable}
          ontap={tap}
          zoneActive={z.id === 'deck' && !!drawAction}
          onzone={z.id === 'deck' && drawAction ? () => run(drawAction) : undefined}
        />
      {/each}
      {#if status.pot}
        <div class="pot">
          <div class="chipstack" aria-hidden="true">
            {#each { length: Math.min(6, Math.ceil(Math.log2(status.pot + 1))) } as _, i}
              <span style:bottom="{i * 4}px" style:--c={seatColor(i * 3)}></span>
            {/each}
          </div>
          <div><div class="eyebrow">Pot</div><b>{status.pot.toLocaleString()}</b></div>
        </div>
      {/if}
    </div>

    {#if showBanner && status.banner}
      <div class="banner panel">
        <button class="close" onclick={() => (bannerHidden = s.v)} aria-label="Hide">×</button>
        <h2>{status.banner.title}</h2>
        {#each status.banner.lines as line}<p>{line}</p>{/each}
      </div>
    {/if}
  </main>

  {#if !display}
    <!-- bottom: my hand, info and actions -->
    <footer>
      <div class="me">
        {#if me}
          <div class="me-name" style:--c={seatColor(you)}>
            <span class="dot"></span>{me.name}
            {#if myInfo?.tag}<span class="mytag">{myInfo.tag}</span>{/if}
          </div>
          <div class="me-sub">
            {#if showChips}<b>{me.chips.toLocaleString()}</b> chips{/if}
            {#if myInfo?.badge}<span class="gold">{myInfo.badge}</span>{/if}
          </div>
          {#if status.hint}<div class="hint">{status.hint}</div>{/if}
        {:else}
          <div class="me-sub">Watching</div>
        {/if}
      </div>
      <div class="hand-wrap">
        <Hand
          cards={myHand}
          cw={handCw}
          {selected}
          {selectable}
          fresh={(s.data as any)?.received?.[you] ?? []}
          ontap={tap}
          onswipe={swipe}
        />
      </div>
    </footer>
    <aside>
      <ActionBar actions={view.actions} {selected} pot={status.pot} onact={run} />
    </aside>
  {/if}
</div>

{#if !portraitOk && !display}
  <div class="rotate">
    <div class="phone"></div>
    <p>Turn your phone sideways for the best view</p>
    <button class="btn quiet" onclick={() => (portraitOk = true)}>Continue anyway</button>
  </div>
{/if}

{#if sheet === 'menu'}
  <Sheet title="Table {view.lobby.code}" onclose={() => (sheet = null)}>
    <div class="menu-list">
      <button class="btn" onclick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
      <button class="btn" onclick={() => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/join/${view.lobby.code}`); app.say('Invite link copied'); }}>Copy invite link</button>
      {#if app.isHost}
        <button class="btn" onclick={() => { app.host?.endGame(); sheet = null; }}>Back to lobby</button>
      {/if}
      <button class="btn danger" onclick={() => { app.leave(); app.go('/'); }}>{app.isHost ? 'Close table' : 'Leave table'}</button>
    </div>
    {#if game.config.rulesSummary}
      <div class="eyebrow">How to play {game.config.name}</div>
      <ul class="rules">{#each game.config.rulesSummary as r}<li>{r}</li>{/each}</ul>
    {/if}
  </Sheet>
{:else if sheet === 'scores'}
  <Sheet title="Scores" onclose={() => (sheet = null)}>
    {#if status.scoreboard}
      <table class="scores">
        <thead><tr><th></th>{#each status.scoreboard.columns as c}<th>{c}</th>{/each}</tr></thead>
        <tbody>
          {#each status.scoreboard.rows as r}
            <tr class:hl={r.highlight}><td>{r.name}</td>{#each r.values as v}<td>{v}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    {:else if showChips}
      <table class="scores">
        <tbody>
          {#each [...s.players].sort((a, b) => b.chips - a.chips) as p}
            <tr><td>{p.name}</td><td>{p.chips.toLocaleString()}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <div class="eyebrow">Recent</div>
    <ol class="log">
      {#each [...s.log].reverse().slice(0, 14) as l}<li>{l.text}</li>{/each}
    </ol>
  </Sheet>
{/if}

<style>
  .table {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'top top'
      'center actions'
      'hand actions';
    padding: calc(6px + var(--safe-t)) calc(10px + var(--safe-r)) calc(4px + var(--safe-b)) calc(10px + var(--safe-l));
    gap: 4px 10px;
    overflow: hidden;
  }
  .table.display {
    grid-template-columns: 1fr;
    grid-template-areas: 'top' 'center';
    grid-template-rows: auto 1fr;
  }
  header {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seats {
    flex: 1;
    display: flex;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 4px 2px 6px;
  }
  .icon {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--glass);
    border: 1px solid var(--line);
    color: var(--ink-dim);
  }
  main {
    grid-area: center;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 0;
  }
  .headline {
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.3rem 0.9rem;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.22);
    color: var(--ink-dim);
    transition:
      background 0.3s,
      color 0.3s;
    max-width: 100%;
    text-align: center;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .headline.mine {
    background: var(--gold);
    color: #2a1d05;
    box-shadow: 0 0 24px rgba(233, 196, 106, 0.45);
  }
  .zones {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 3vw, 32px);
    flex-wrap: wrap;
    min-height: 0;
  }
  .pot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.8rem 0.4rem 0.5rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.22);
  }
  .pot b {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
  }
  .chipstack {
    position: relative;
    width: 26px;
    height: 32px;
  }
  .chipstack span {
    position: absolute;
    left: 0;
    width: 26px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
    box-shadow:
      inset 0 -2px 0 rgba(0, 0, 0, 0.3),
      0 1px 2px rgba(0, 0, 0, 0.4);
    border: 1.5px dashed rgba(255, 255, 255, 0.6);
  }
  .banner {
    position: absolute;
    z-index: 5;
    background: rgba(8, 26, 20, 0.94);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 0.9rem 1.4rem;
    text-align: center;
    min-width: 16rem;
    max-width: 92%;
    max-height: 100%;
    overflow: auto;
    animation: rise 0.35s var(--ease-spring);
  }
  .banner h2 {
    margin: 0 0 0.3rem;
    font-family: var(--font-card);
    font-size: 1.35rem;
    color: var(--gold);
  }
  .banner p {
    margin: 0.15rem 0;
    font-size: 0.85rem;
    color: var(--ink-dim);
  }
  .close {
    position: absolute;
    top: 4px;
    right: 8px;
    font-size: 1.2rem;
    color: var(--ink-faint);
    width: 32px;
    height: 32px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, -40%) scale(0.95);
    }
  }
  footer {
    grid-area: hand;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-width: 0;
  }
  .me {
    flex: none;
    width: clamp(70px, 13vw, 140px);
    padding-bottom: 8px;
    font-size: 0.8rem;
  }
  .me-name {
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }
  .mytag {
    font-size: 0.65rem;
    background: #fff;
    color: #111;
    border-radius: 6px;
    padding: 0 4px;
  }
  .me-sub {
    color: var(--ink-dim);
    display: flex;
    flex-direction: column;
  }
  .me-sub b {
    color: var(--ink);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .gold,
  .hint {
    color: var(--gold);
    font-weight: 600;
  }
  .hint {
    margin-top: 0.2rem;
    font-size: 0.75rem;
  }
  .hand-wrap {
    flex: 1;
    min-width: 0;
  }
  aside {
    grid-area: actions;
    width: clamp(108px, 17vw, 168px);
    padding-bottom: 8px;
    min-height: 0;
  }
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
      background: rgba(5, 18, 14, 0.94);
      backdrop-filter: blur(10px);
    }
    .phone {
      width: 44px;
      height: 78px;
      border: 3px solid var(--ink);
      border-radius: 10px;
      animation: turn 2s var(--ease-out) infinite;
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
  .menu-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .rules {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    color: var(--ink-dim);
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .scores {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .scores th {
    text-align: right;
    font-size: 0.7rem;
    color: var(--ink-dim);
    font-weight: 600;
    padding: 0.3rem 0.5rem;
  }
  .scores td {
    padding: 0.45rem 0.5rem;
    border-top: 1px solid var(--line);
    text-align: right;
  }
  .scores td:first-child {
    text-align: left;
    font-weight: 600;
  }
  .scores tr.hl td {
    color: var(--gold);
  }
  .log {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    color: var(--ink-dim);
    font-size: 0.85rem;
    line-height: 1.6;
  }

  /* very short landscape phones */
  @media (max-height: 360px) {
    .headline {
      font-size: 0.74rem;
      padding: 0.2rem 0.7rem;
    }
    .icon {
      width: 34px;
      height: 34px;
    }
  }
</style>
