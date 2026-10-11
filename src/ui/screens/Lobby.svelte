<script lang="ts">
  import { app } from '../../app.svelte';
  import { GAME_LIST, getGame } from '../../games';
  import type { View } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import AvatarPicker from '../components/AvatarPicker.svelte';
  import GameIcon from '../components/GameIcon.svelte';
  import NetStatus from '../components/NetStatus.svelte';
  import { keepAwake } from '../wakeLock';
  import NightBoard from '../components/NightBoard.svelte';
  import PingDot from '../components/PingDot.svelte';
  import Sheet from '../components/Sheet.svelte';

  let { view }: { view: View } = $props();

  const lobby = $derived(view.lobby);
  const game = $derived(getGame(lobby.gameId));
  const host = $derived(view && app.host);
  const startError = $derived(view && host ? host.canStart() : null);
  const joinUrl = $derived(`${location.origin}${location.pathname}${location.search}#/join/${lobby.code}`);

  let qr = $state('');
  $effect(() => {
    const url = joinUrl;
    import('qrcode').then((QR) =>
      QR.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0b2a21', light: '#fbf8f1' } }).then((d) => (qr = d)),
    );
  });

  // the host's phone keeps the table alive: don't let it sleep while friends are joining
  $effect(() => (app.isHost ? keepAwake() : undefined));

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Join my Lamplight table', text: `Pull up a chair — table ${lobby.code}`, url: joinUrl });
      else {
        await navigator.clipboard.writeText(joinUrl);
        app.say('Invite link copied');
      }
    } catch {
      /* cancelled */
    }
  }

  const mySeat = $derived(lobby.seats.findIndex((s) => s.id === app.cid));
  let picking = $state(false);
</script>

{#if picking}
  <Sheet title="Pick your look" onclose={() => (picking = false)}>
    <AvatarPicker value={app.avatar} name={app.name} onpick={(a) => app.setProfile(app.name, a)} />
  </Sheet>
{/if}

<div class="lobby">
  <section class="invite panel">
    <div class="eyebrow">Table code</div>
    <div class="code">{#each lobby.code.split('') as ch}<span>{ch}</span>{/each}</div>
    <!-- the QR is generated a moment later: hold its place so the page doesn't jump -->
    {#if qr}<img class="qr" src={qr} alt="QR code to join this table" />{:else}<div class="qr" aria-hidden="true"></div>{/if}
    <p class="small">Scan, or open the site and enter the code. Friends somewhere else can join with the invite link — pair it with a video call. Same WiFi is fastest.</p>
    <div class="row">
      <button class="btn" onclick={share}>Share invite</button>
      <button class="btn quiet" onclick={() => { app.leave(); app.go('/'); }}>Leave</button>
    </div>
    {#if app.isHost}<NetStatus />{:else if !app.connected}<p class="status warn">Reconnecting to the host…</p>{/if}
  </section>

  <section class="setup">
    <div class="block">
      <div class="head">
        <div class="eyebrow">Players · {lobby.seats.length}/{game.config.players.max}</div>
        {#if host && game.bot && lobby.seats.length < game.config.players.max}
          <button class="btn small-btn" onclick={() => host.addBot()}>+ Add bot</button>
        {/if}
      </div>
      <ul class="players">
        {#each lobby.seats as seat, i (seat.id)}
          <li class:me={i === mySeat} class:offline={!seat.connected}>
            {#if i === mySeat}
              <button class="me-av" onclick={() => (picking = true)} aria-label="Change your avatar">
                <AvatarBadge avatar={seat.avatar} name={seat.name} seat={i} size={32} />
              </button>
            {:else}
              <AvatarBadge avatar={seat.avatar} name={seat.name} seat={i} size={32} />
            {/if}
            <span class="pname">
              <span class="ptext">{seat.name}</span>
              {#if seat.host}<em>host</em>{/if}
              {#if seat.bot}<em>bot</em>{/if}
              {#if i === mySeat}<em class="you">you</em>{/if}
            </span>
            {#if !seat.bot && !seat.host}<PingDot ms={app.pings[i]} label />{/if}
            {#if host}
              <span class="ctl">
                <button onclick={() => host.moveSeat(seat.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button onclick={() => host.moveSeat(seat.id, 1)} disabled={i === lobby.seats.length - 1} aria-label="Move down">↓</button>
                {#if !seat.host}<button onclick={() => host.removeSeat(seat.id)} aria-label="Remove">×</button>{/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if lobby.spectators}<p class="small">+ {lobby.spectators} watching</p>{/if}
      {#if lobby.displays}<p class="small">📺 Table screen connected — phones will show just your hand</p>{/if}
    </div>

    {#if lobby.night?.games.length}
      <div class="block">
        <div class="head"><div class="eyebrow">Game night · {lobby.night.games.length} game{lobby.night.games.length > 1 ? 's' : ''}</div></div>
        <NightBoard night={lobby.night} seats={lobby.seats} onreset={host ? () => host.newNight() : undefined} />
      </div>
    {/if}

    <div class="block">
      <div class="eyebrow">Game</div>
      {#if host}
        <div class="games">
          {#each GAME_LIST as g (g.config.id)}
            <button class="game" class:active={g.config.id === lobby.gameId} onclick={() => host.setGame(g.config.id)}>
              <span class="gicon"><GameIcon id={g.config.id} icon={g.config.icon} size={40} /></span>
              <span class="gname">{g.config.name}</span>
              <span class="gmeta">{g.config.players.counts?.join(' or ') ?? (g.config.players.min === g.config.players.max ? g.config.players.min : `${g.config.players.min}–${g.config.players.max}`)} players{g.config.chips ? ' · chips' : ''}{g.bot ? ' · bots' : ''}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="chosen">
        <span class="gicon big"><GameIcon id={game.config.id} icon={game.config.icon} size={52} /></span>
        <div>
          <b>{game.config.name}</b>
          <p class="small">{game.config.tagline}</p>
        </div>
      </div>
      {#if game.config.options?.length}
        <div class="options">
          {#each game.config.options as o (o.id)}
            <label class="opt">
              <span>{o.label}</span>
              {#if o.type === 'number'}
                <span class="stepper">
                  <button disabled={!host} onclick={() => host?.setOption(o.id, Math.max(o.min ?? 0, Number(lobby.options[o.id]) - (o.step ?? 1)))}>−</button>
                  <b>{lobby.options[o.id]}</b>
                  <button disabled={!host} onclick={() => host?.setOption(o.id, Math.min(o.max ?? 1e9, Number(lobby.options[o.id]) + (o.step ?? 1)))}>+</button>
                </span>
              {:else}
                <input type="checkbox" disabled={!host} checked={!!lobby.options[o.id]} onchange={(e) => host?.setOption(o.id, e.currentTarget.checked)} />
              {/if}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="start">
      {#if host}
        <button class="btn primary big" disabled={!!startError} onclick={() => host.start()}>Deal {game.config.name}</button>
        {#if startError}<span class="small">{startError}{game.bot ? ' — add bots to fill seats' : ''}</span>{/if}
      {:else}
        <span class="waiting"><span class="spinner"></span> Waiting for the host to deal…</span>
      {/if}
    </div>
  </section>
</div>

<style>
  .lobby {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(220px, 300px) 1fr;
    gap: 14px;
    padding: calc(12px + var(--safe-t)) calc(14px + var(--safe-r)) calc(12px + var(--safe-b)) calc(14px + var(--safe-l));
    overflow: auto;
  }
  @media (orientation: portrait), (max-width: 560px) {
    .lobby {
      grid-template-columns: 1fr;
      grid-auto-rows: min-content;
    }
  }
  .invite {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
    align-self: start;
  }
  .code {
    display: flex;
    gap: 0.35rem;
  }
  .code span {
    width: 2.4rem;
    height: 3.1rem;
    display: grid;
    place-items: center;
    font-family: var(--font-card);
    font-size: 2rem;
    font-weight: 700;
    border-radius: 10px;
    background: var(--card-face);
    color: #10231c;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .qr {
    width: min(150px, 34vh);
    aspect-ratio: 1;
    border-radius: 12px;
    image-rendering: pixelated;
  }
  div.qr {
    background: rgba(251, 248, 241, 0.06);
  }
  .small {
    font-size: 0.78rem;
    color: var(--ink-dim);
    margin: 0;
    line-height: 1.4;
  }
  .row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .status.warn {
    color: var(--gold);
    font-size: 0.8rem;
    margin: 0;
  }
  .setup {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .block {
    background: var(--glass);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 0.8rem 1rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .small-btn {
    min-height: 32px;
    padding: 0.2em 0.8em;
    font-size: 0.8rem;
  }
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.4rem;
  }
  .players li {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.5rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.15);
    animation: slide 0.3s var(--ease-out);
  }
  .players li.me {
    box-shadow: inset 0 0 0 1px rgba(233, 196, 106, 0.5);
  }
  .players li.offline {
    opacity: 0.5;
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .me-av {
    padding: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(233, 196, 106, 0.6);
  }
  .pname {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    display: flex;
    align-items: center;
    white-space: nowrap;
  }
  .ptext {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .pname em {
    font-style: normal;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--ink-dim);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 0.3rem;
    margin-left: 0.3rem;
    flex: none;
  }
  .pname em.you {
    color: var(--gold);
  }
  .ctl {
    display: flex;
  }
  .ctl button {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--ink-dim);
  }
  .ctl button:disabled {
    opacity: 0.25;
  }
  .games {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.5rem;
    margin: 0.5rem 0 0.7rem;
  }
  .game {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.6rem 0.75rem;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid var(--line);
    text-align: left;
    transition:
      border-color 0.2s,
      background 0.2s,
      transform 0.15s;
  }
  .game:active {
    transform: scale(0.97);
  }
  .game.active {
    border-color: var(--gold);
    background: rgba(233, 196, 106, 0.12);
  }
  .gicon {
    display: block;
    margin-bottom: 0.15rem;
  }
  .gicon.big {
    flex: none;
    margin-bottom: 0;
  }
  .gname {
    font-weight: 700;
  }
  .gmeta {
    font-size: 0.7rem;
    color: var(--ink-dim);
  }
  .chosen {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin-top: 0.3rem;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.2rem;
    margin-top: 0.7rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--ink-dim);
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .stepper button {
    width: 34px;
    height: 34px;
    font-size: 1.1rem;
  }
  .stepper button:disabled {
    opacity: 0.3;
  }
  .stepper b {
    min-width: 3.2rem;
    text-align: center;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .start {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 0.5rem;
  }
  .btn.big {
    font-size: 1.05rem;
    padding: 0.7em 1.8em;
  }
  .waiting {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--ink-dim);
  }
  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--gold);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
