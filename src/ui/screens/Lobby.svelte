<script lang="ts">
  import { app, inviteUrl } from '../../app.svelte';
  import { CATEGORIES, categoryOf, GAME_LIST, getGame, GAMES, misfit, playersText, searchGames } from '../../games';
  import type { GameInfo } from '../../games';
  import type { View } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import AvatarPicker from '../components/AvatarPicker.svelte';
  import GameIcon from '../components/GameIcon.svelte';
  import LookPicker from '../components/LookPicker.svelte';
  import { backOf, clothOf } from '../looks';
  import NetStatus from '../components/NetStatus.svelte';
  import { keepAwake } from '../wakeLock';
  import NightBoard from '../components/NightBoard.svelte';
  import PingDot from '../components/PingDot.svelte';
  import Sheet from '../components/Sheet.svelte';
  import TvSheet from '../components/TvSheet.svelte';

  let { view }: { view: View } = $props();

  const lobby = $derived(view.lobby);
  const game = $derived(getGame(lobby.gameId));
  const host = $derived(view && app.host);
  const startError = $derived(view && host ? host.canStart() : null);
  const joinUrl = $derived(inviteUrl(lobby.code));

  let qr = $state('');
  $effect(() => {
    const url = joinUrl;
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0b2a21', light: '#fbf8f1' } }))
      .then((d) => (qr = d))
      // (no QR code is fine: the code and link are right there)
      .catch(() => {});
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

  // the picker: recent games first, then a section per kind of game
  const people = $derived(lobby.seats.filter((s) => !s.bot).length);
  const recent = app.recentGames.filter((id) => GAMES[id]).slice(0, 3).map((id) => GAMES[id]);
  const sections = CATEGORIES.map((c) => ({ name: c, games: GAME_LIST.filter((g) => categoryOf(g) === c) })).filter((x) => x.games.length);
  const sectionEls: Record<string, HTMLElement> = $state({});
  let query = $state('');
  const found = $derived(query.trim() ? searchGames(query) : []);
  /** Enter picks the best match. */
  function searchKey(e: KeyboardEvent) {
    if (e.key === 'Escape') query = '';
    if (e.key === 'Enter' && found.length) {
      host?.setGame(found[0].config.id);
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
  const jump = (name: string) => sectionEls[name]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  function deal() {
    app.noteGame(lobby.gameId);
    host?.start();
  }
  let picking = $state(false);
  let tv = $state(false);
  let settings = $state(false);
  let looking = $state(false);
  // who plays: the table can hold more people than the game seats
  const seatsMax = $derived(game.config.players.counts ? Math.max(...game.config.players.counts) : game.config.players.max);
  const playing = $derived(lobby.seats.filter((s) => !s.out).length);
  const sittingOut = $derived(lobby.seats.filter((s) => s.out).length);
  // splitting the table: anyone here but the host and bots can go
  const splittable = $derived(lobby.seats.filter((s) => !s.host && !s.bot && s.connected));
  let splitting = $state(false);
  let going = $state<string[]>([]);
  let newHost = $state('');
  function openSplit() {
    going = [];
    newHost = '';
    splitting = true;
  }
  function toggleGoing(id: string) {
    going = going.includes(id) ? going.filter((x) => x !== id) : [...going, id];
    if (!going.includes(newHost)) newHost = going[0] ?? '';
  }
  function doSplit() {
    if (!going.length || !newHost) return;
    app.split(going, newHost);
    splitting = false;
  }
  /**
   * A line too long for its space glides along by itself: a pause at the start, slowly across to
   * the end, a pause, and back. How far it goes (and so how long it takes) is measured here. It
   * rests after a few passes (battery); a tap plays it again.
   */
  function marquee(el: HTMLElement) {
    const run = el.firstElementChild as HTMLElement;
    const SPEED = 30; // px a second
    const update = () => {
      const moving = run.offsetWidth > el.clientWidth + 2;
      el.classList.toggle('moving', moving);
      // far enough that the last letter ends up clear of the soft right edge (and the padding)
      const css = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const fade = parseFloat(css.getPropertyValue('--fade')) || 0;
      const over = moving ? Math.ceil(run.offsetWidth - room + fade) : 0;
      el.style.setProperty('--over', `${-over}px`);
      // the glide out takes half the cycle
      el.style.setProperty('--cycle', `${Math.max(6, (over / SPEED) * 2).toFixed(1)}s`);
    };
    const replay = () => run.getAnimations?.().forEach((a) => (a.cancel(), a.play()));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(run);
    el.addEventListener('pointerdown', replay);
    return {
      destroy: () => {
        ro.disconnect();
        el.removeEventListener('pointerdown', replay);
      },
    };
  }
  /** How many options differ from the game's defaults. */
  const changed = $derived((game.config.options ?? []).filter((o) => lobby.options[o.id] !== undefined && lobby.options[o.id] !== o.default).length);
</script>

{#snippet tile(g: GameInfo)}
  {@const why = misfit(g, people)}
  <button class="game" data-game={g.config.id} class:active={g.config.id === lobby.gameId} class:misfit={!!why} onclick={() => host?.setGame(g.config.id)}>
    <span class="gicon"><GameIcon id={g.config.id} icon={g.config.icon} size={40} /></span>
    <span class="gname">{g.config.name}</span>
    <span class="gmeta">
      {#if why}<span class="warn">{why} players{why.startsWith('up to') ? ' · rest sit out' : ''}</span>{:else}{playersText(g)} players{g.config.chips ? ' · chips' : ''}{/if}
    </span>
  </button>
{/snippet}

{#snippet optionList()}
  <div class="options">
    {#each game.config.options as o (o.id)}
      <label class="opt">
        <span>{o.label}</span>
        {#if o.choices}
          <span class="seg">
            {#each o.choices as c, i (c)}
              <button class:on={Number(lobby.options[o.id]) === i} disabled={!host} onclick={() => host?.setOption(o.id, i)}>{c}</button>
            {/each}
          </span>
        {:else if o.type === 'number'}
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
{/snippet}

{#if settings}
  <Sheet title={game.config.name} onclose={() => (settings = false)}>
    <p class="small">{game.config.tagline}</p>
    {#if game.config.options?.length}{@render optionList()}{/if}
    {#if !host}<p class="small">The host chooses the settings.</p>{/if}
  </Sheet>
{/if}

{#if looking}
  <Sheet title="The table's look" onclose={() => (looking = false)}>
    <LookPicker look={lobby.look} onpick={host ? (l) => app.setLook(l) : undefined} />
  </Sheet>
{/if}

{#if splitting}
  <Sheet title="Split the table" onclose={() => (splitting = false)}>
    <p class="small">Pick who moves to a new table of their own, and whose phone hosts it. Tonight's scoreboard goes with them, and their games join this table's tally when they come back.</p>
    <ul class="pick">
      {#each splittable as s (s.id)}
        <li>
          <label class="pick-who"><input type="checkbox" checked={going.includes(s.id)} onchange={() => toggleGoing(s.id)} /><AvatarBadge avatar={s.avatar} name={s.name} seat={0} size={26} />{s.name}</label>
          {#if going.includes(s.id)}
            <label class="pick-host"><input type="radio" name="newhost" checked={newHost === s.id} onchange={() => (newHost = s.id)} />hosts</label>
          {/if}
        </li>
      {/each}
    </ul>
    <button class="btn primary" disabled={!going.length || !newHost} onclick={doSplit}>
      {going.length ? `Move ${going.length} to a new table` : 'Pick who moves'}
    </button>
  </Sheet>
{/if}

{#if tv}
  <TvSheet table={lobby.code} onclose={() => (tv = false)} />
{/if}

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
    <p class="small">Scan, or open the site and enter the code. Friends somewhere else can join with the invite link. Same WiFi is fastest.</p>
    <div class="row">
      <button class="btn" onclick={share}>Share invite</button>
      <button class="btn" onclick={() => (tv = true)}>📺 TV</button>
      <button class="btn quiet" onclick={() => { app.leave(); app.go('/'); }}>Leave</button>
    </div>
    {#if app.isHost}<NetStatus />{:else if !app.connected}<p class="status warn">Reconnecting to the host…</p>{/if}
  </section>

  <section class="setup">
    <div class="block">
      <div class="head">
        <div class="eyebrow">Playing · {playing}/{seatsMax}{sittingOut ? ` · ${sittingOut} sitting out` : ''}</div>
        {#if host && game.bot && playing < seatsMax}
          <button class="btn small-btn" onclick={() => host.addBot()}>+ Add bot</button>
        {/if}
      </div>
      <ul class="players" style:--row={host ? '16rem' : null}>
        {#each lobby.seats as seat, i (seat.id)}
          <li class:me={i === mySeat} class:offline={!seat.connected} class:out={seat.out}>
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
              {#if seat.out && !host}<em>sitting out</em>{/if}
            </span>
            {#if !seat.bot && !seat.host}<PingDot ms={app.pings[i]} label />{/if}
            {#if host && !seat.bot && (seat.out || lobby.seats.length > 1)}
              <!-- who plays this game: tap to sit someone out, or bring them in -->
              <button class="inout" class:on={!seat.out} onclick={() => host.setPlaying(seat.id, !!seat.out)} aria-label={seat.out ? `Deal ${seat.name} in` : `Sit ${seat.name} out`}>
                {seat.out ? 'Out' : 'In'}
              </button>
            {/if}
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
      {#if sittingOut && host}<p class="small">More people than {game.config.name} seats: whoever sits out plays the next game. Tap In / Out to choose.</p>{/if}
      {#if lobby.spectators}<p class="small">+ {lobby.spectators} watching</p>{/if}
      <button class="btn small-btn look-btn" onclick={() => (looking = true)}>🎴 {backOf(lobby.look?.back).name} backs · {clothOf(lobby.look?.cloth).name}</button>
      {#if host && splittable.length >= 1}
        <button class="btn small-btn split-btn" onclick={openSplit}>⑂ Split the table</button>
      {/if}
      {#if lobby.splits?.length}
        <p class="small">Also playing tonight: {#each lobby.splits as x, k (x.code)}{k ? ' · ' : ''}table <b>{x.code}</b> ({x.names.join(', ')}){/each}</p>
      {/if}
      {#if lobby.parent}
        <p class="small">
          Split off from table <b>{lobby.parent}</b>.
          {#if host}<button class="btn small-btn" onclick={() => app.goBack()}>Everyone back to {lobby.parent}</button>{:else}The host can bring everyone back, games and all.{/if}
        </p>
      {/if}
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
      {#if !host}
        <div class="chosen">
          <span class="gicon"><GameIcon id={game.config.id} icon={game.config.icon} size={44} /></span>
          <div><b>{game.config.name}</b><p class="small">{game.config.tagline}</p></div>
        </div>
      {/if}
      {#if host}
        <label class="search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none" /><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          <input
            type="search"
            bind:value={query}
            onkeydown={searchKey}
            placeholder="Search games or player count"
            aria-label="Search games"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          {#if query}<button class="clear" onclick={() => (query = '')} aria-label="Clear search">×</button>{/if}
        </label>
        {#if query.trim()}
          {#if found.length}
            <div class="sec">{found.length} game{found.length === 1 ? '' : 's'}</div>
            <div class="games">{#each found as g (g.config.id)}{@render tile(g)}{/each}</div>
          {:else}
            <p class="small none">No games match “{query.trim()}”.</p>
          {/if}
        {:else}
          <nav class="cats" aria-label="Kinds of game">
            {#each sections as sec (sec.name)}<button class="cat" onclick={() => jump(sec.name)}>{sec.name}</button>{/each}
          </nav>
          {#if recent.length}
            <div class="sec">Recent</div>
            <div class="games">{#each recent as g (g.config.id)}{@render tile(g)}{/each}</div>
          {/if}
          {#each sections as sec (sec.name)}
            <div class="sec" bind:this={sectionEls[sec.name]}>{sec.name}</div>
            <div class="games">{#each sec.games as g (g.config.id)}{@render tile(g)}{/each}</div>
          {/each}
        {/if}
      {/if}
    </div>
  </section>

  <!-- always on screen: what's chosen, its settings and the deal, however far down the picker you are -->
  <div class="dealbar">
    <span class="gicon"><GameIcon id={game.config.id} icon={game.config.icon} size={34} /></span>
    <div class="what">
      <b>{game.config.name}</b>
      <!-- a long line glides along by itself rather than being cut off -->
      {#key `${game.config.id}|${startError}|${changed}`}
        {#if host && startError}<span class="small warn-text line" use:marquee><span class="run">{startError}{game.bot ? ' — add bots to fill seats' : ''}</span></span>
        {:else}<span class="small line" use:marquee><span class="run">{changed ? `${changed} setting${changed > 1 ? 's' : ''} changed` : game.config.tagline}</span></span>{/if}
      {/key}
    </div>
    {#if game.config.options?.length}
      <button class="btn" onclick={() => (settings = true)} aria-label="Settings">⚙ <span class="long">Settings</span></button>
    {/if}
    {#if host}
      <button class="btn primary big" disabled={!!startError} onclick={deal}>Deal <span class="long">{game.config.name}</span></button>
    {:else}
      <span class="waiting"><span class="spinner"></span> Waiting for the host…</span>
    {/if}
  </div>
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
  /* side by side (a phone on its side, where the left column is otherwise empty space): the table
     code stays in view while you scroll the games, and if the panel is taller than the screen it
     scrolls on its own. Stacked (portrait) it scrolls away with the page, leaving room for the games. */
  @media (orientation: landscape) and (min-width: 561px) {
    .invite {
      position: sticky;
      top: 0;
      /* (stopping above the deal bar pinned at the bottom) */
      max-height: calc(100vh - 100px - var(--safe-t) - var(--safe-b));
      max-height: calc(100dvh - 100px - var(--safe-t) - var(--safe-b));
      overflow-y: auto;
      scrollbar-width: none;
    }
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
    /* (the host's rows carry In/Out and seat controls: give names room) */
    grid-template-columns: repeat(auto-fill, minmax(var(--row, 13rem), 1fr));
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
  .players li.out {
    background: rgba(0, 0, 0, 0.06);
  }
  .players li.out .pname {
    color: var(--ink-dim);
  }
  .inout {
    flex: none;
    min-width: 2.6rem;
    height: 26px;
    padding: 0 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-dim);
  }
  .inout.on {
    background: var(--gold);
    border-color: var(--gold);
    color: #1a1408;
  }
  .split-btn,
  .look-btn {
    margin-top: 0.5rem;
    margin-right: 0.4rem;
  }
  .pick {
    list-style: none;
    margin: 0.6rem 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .pick li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .pick-who,
  .pick-host {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .pick-host {
    font-size: 0.8rem;
    color: var(--ink-dim);
  }
  .ctl button {
    width: 28px;
    height: 30px;
    border-radius: 8px;
    color: var(--ink-dim);
  }
  .ctl button:disabled {
    opacity: 0.25;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.55rem;
    padding: 0 0.35rem 0 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.22);
    color: var(--ink-dim);
  }
  .search:focus-within {
    border-color: var(--gold);
    color: var(--ink);
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 0;
    border: 0;
    outline: none;
    background: none;
    color: var(--ink);
    /* (16px: smaller and iPhones zoom the page in when it's tapped) */
    font-size: 16px;
  }
  .search input::placeholder {
    color: var(--ink-dim);
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .search .clear {
    flex: none;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--ink-dim);
  }
  .none {
    margin: 0.9rem 0.2rem;
  }
  .cats {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    margin: 0.55rem -0.2rem 0.1rem;
    padding: 0 0.2rem 0.2rem;
    scrollbar-width: none;
  }
  .cat {
    flex: none;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.18);
    color: var(--ink-dim);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .cat:active {
    background: rgba(233, 196, 106, 0.12);
    color: var(--ink);
  }
  .sec {
    margin-top: 0.75rem;
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--gold);
    font-weight: 600;
    /* jumping to a section lands it a quarter of the way down: clear of a phone's status bar or
       notch, with the section's games below it still above the deal bar */
    scroll-margin-top: calc(var(--safe-t) + 25vh);
  }
  .game.misfit:not(.active) {
    opacity: 0.45;
  }
  .warn {
    color: #e8a87c;
  }
  .games {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.5rem;
    margin: 0.4rem 0 0.3rem;
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
  .chosen .gicon {
    flex: none;
    margin: 0;
  }
  .chosen p {
    margin: 0;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.7rem;
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    padding: 0 0.8rem;
    height: 34px;
    font-size: 0.82rem;
    color: var(--ink-dim);
  }
  .seg button.on {
    background: var(--gold);
    color: #1a1408;
    font-weight: 600;
  }
  .seg button:disabled:not(.on) {
    opacity: 0.45;
  }
  .stepper b {
    min-width: 3.2rem;
    text-align: center;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .dealbar {
    grid-column: 1 / -1;
    min-width: 0;
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.6rem 0.5rem 0.8rem;
    border-radius: 20px;
    background: rgba(8, 26, 20, 0.82);
    background: color-mix(in srgb, var(--felt-3) 92%, transparent);
    border: 1px solid var(--line);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .dealbar .btn {
    flex: none;
    white-space: nowrap;
  }
  .dealbar .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .dealbar .what > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dealbar .what > .line {
    text-overflow: clip;
  }
  .dealbar .what > .line .run {
    display: inline-block;
  }
  .dealbar .what > .line:global(.moving) {
    /* (the glide measures this, to finish with the text clear of the fade) */
    --fade: 16px;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 0.5rem, #000 calc(100% - var(--fade)), transparent);
    mask-image: linear-gradient(to right, transparent, #000 0.5rem, #000 calc(100% - var(--fade)), transparent);
    padding-left: 0.5rem;
    margin-left: -0.5rem;
  }
  .dealbar .what > .line:global(.moving) .run {
    /* a few passes then rest (battery); tapping the line plays it again */
    animation: glide var(--cycle) ease-in-out 3;
  }
  @keyframes glide {
    0%,
    15% {
      transform: translateX(0);
    }
    65%,
    80% {
      transform: translateX(var(--over));
    }
    100% {
      transform: translateX(0);
    }
  }
  /* (without motion: the ending is cut off as before) */
  @media (prefers-reduced-motion: reduce) {
    .dealbar .what > .line:global(.moving) .run {
      animation: none;
    }
  }
  .dealbar .gicon {
    flex: none;
    margin-bottom: 0;
  }
  .warn-text {
    color: var(--gold);
  }
  @media (max-width: 560px) {
    .dealbar .gicon,
    .dealbar .long {
      display: none;
    }
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
