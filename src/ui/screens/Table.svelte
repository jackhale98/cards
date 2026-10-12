<script lang="ts">
  import SuitText from '../components/SuitText.svelte';
  import { app } from '../../app.svelte';
  import type { ActionSpec } from '../../engine/types';
  import { getGame } from '../../games';
  import type { View } from '../../net/protocol';
  import ActionBar from '../components/ActionBar.svelte';
  import Hand from '../components/Hand.svelte';
  import Seat from '../components/Seat.svelte';
  import Zone from '../components/Zone.svelte';
  import Sheet from '../components/Sheet.svelte';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import Track from '../components/Track.svelte';
  import NightBoard from '../components/NightBoard.svelte';
  import { nightTotals } from '../../net/night';
  import { seatRelation } from '../../engine/state';
  import { flight, haptic, play, snapshot } from '../motion';
  import { play as sound, setSound, soundOn, type Sound } from '../sound';
  import { seatColor } from '../seatColors';
  import { keepAwake } from '../wakeLock';
  import TvSheet from '../components/TvSheet.svelte';

  let { view, display = false }: { view: View; display?: boolean } = $props();

  const s = $derived(view.state!);
  const you = $derived(view.you);
  const status = $derived(view.status!);
  const game = $derived(getGame(s.game));
  const n = $derived(s.players.length);
  const showChips = $derived(!!game.config.chips);

  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  /**
   * Hand mode: a table screen shows the middle of the table, so this phone keeps only what's
   * yours (a bigger hand, your info and actions) plus any pile you can tap right now.
   */
  const handMode = $derived(!display && you >= 0 && !!view.lobby.displays && app.handMode);
  // a score track takes some height, so table cards get a little smaller with one
  const centerCw = $derived(
    Math.round(
      display
        ? Math.max(60, Math.min(300, vh * (status.track ? 0.18 : 0.22), vw * 0.1))
        : Math.max(40, Math.min(92, vh * (status.track ? 0.13 : 0.15), vw * 0.09)),
    ),
  );

  /** Opponents in turn order starting to your left. */
  const others = $derived.by(() => {
    if (you < 0) return s.players.map((_, i) => i);
    return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
  });

  const myHand = $derived(you >= 0 ? (s.zones[`hand:${you}`]?.cards ?? []) : []);
  const allCenterZones = $derived(Object.values(s.zones).filter((z) => z.area === 'center' && !(z.hideEmpty && !z.cards.length)));
  /** Zones on the compact strip along the bottom of the table (e.g. everyone's melds). */
  const allStripZones = $derived(Object.values(s.zones).filter((z) => z.area === 'strip' && !(z.hideEmpty && !z.cards.length)));
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

  /** Whose move it is (the declarer moves for the dummy in bridge). */
  const actor = $derived(status.actor ?? s.turn);
  // nudge when it becomes your turn
  let lastTurn = -1;
  let lastActor = -1;
  $effect(() => {
    if (actor === you && (lastActor !== you || s.turn !== lastTurn) && you >= 0) {
      haptic(18);
      sound('turn');
    }
    lastTurn = s.turn ?? -1;
    lastActor = actor ?? -1;
  });

  function tap(id: string) {
    if (!selectable?.has(id)) return;
    if (selected.includes(id)) {
      // tapping a lone selected card plays it, unless the action is swipe-only
      if (quick?.quick === true && selected.length === 1 && quick.select!.cards.includes(id)) return run(quick);
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

  function run(spec: ActionSpec, amount?: number, cards = selected, seat?: number) {
    app.act({ type: spec.type, cards: spec.select ? [...cards] : undefined, amount, seat });
    if (spec.select) selected = [];
    haptic(10);
  }

  /** Actions triggered by tapping a pile (draw from the deck, take the discard…). */
  const zoneAction = (zoneId: string) => view.actions.find((a) => a.zone === zoneId && !a.select);
  /** In hand mode only piles you can use right now stay on the phone (e.g. the deck to draw from, a bridge dummy). */
  const usable = (z: (typeof allCenterZones)[number]) => !!zoneAction(z.id) || z.cards.some((c) => selectable?.has(c.id));
  const centerZones = $derived(handMode ? allCenterZones.filter(usable) : allCenterZones);
  const stripZones = $derived(handMode ? allStripZones.filter(usable) : allStripZones);
  // ---- table screen -----------------------------------------------------------------------
  /** On a table screen everything sized in rem grows with the screen (1rem = this many px). */
  // (a little smaller with lots of players, so seats don't collide around the oval)
  const tvRem = $derived(display ? Math.round(Math.max(16, Math.min(56, vw * (n > 6 ? 0.014 : 0.0175), vh * 0.031))) : 16);
  $effect(() => {
    if (!display) return;
    document.documentElement.style.fontSize = `${tvRem}px`;
    return () => {
      document.documentElement.style.fontSize = '';
    };
  });
  /** Seats sit around an oval in turn order, seat 0 at the bottom (matching where trick cards land). */
  // each seat's measured size, so a wide one is kept fully on screen instead of centred off the edge
  let slotW = $state<Record<number, number>>({});
  let slotH = $state<Record<number, number>>({});
  function tvSeatPos(seat: number) {
    const a = Math.PI / 2 + (seat * 2 * Math.PI) / n;
    const keep = (pct: number, size = 0) => `clamp(${size / 2 + 8}px, ${pct}%, calc(100% - ${size / 2 + 8}px))`;
    return { left: keep(50 + Math.cos(a) * 40, slotW[seat]), top: keep(50 + Math.sin(a) * 39, slotH[seat]) };
  }
  const handCw = $derived(
    Math.round(
      handMode
        ? // a pile left on the phone (deck to draw from…) needs some of the height
          Math.max(64, Math.min(168, vh * (centerZones.length ? 0.27 : 0.34), vw * 0.15))
        : Math.max(52, Math.min(112, vh * 0.2, vw * 0.11)),
    ),
  );

  // ---- chrome -----------------------------------------------------------------------------
  let sheet = $state<'menu' | 'scores' | 'tv' | null>(null);
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
  $effect(() => keepAwake());


  // ---- what just happened ------------------------------------------------------------------
  const lastEntry = $derived(s.log.at(-1));
  /** Latest player move, shown under the headline (unless the headline already says it). */
  const lastMove = $derived(lastEntry && lastEntry.text !== status.headline ? lastEntry : null);

  // ---- sounds: each new move on the table (on the big screen, when there is one), and the end
  let soundsOn = $state(soundOn());
  let heard = -1;
  function soundFor(e: { text: string; fromZone?: string; toZone?: string }): Sound | null {
    const t = e.text.toLowerCase();
    if (/\b(deals?|shuffles?)\b/.test(t)) return 'deal';
    if (showChips && /\b(bets?|raises?|calls?|all in|antes?|blinds?|wins?|splits?|doubles?|insures?|pays?)\b/.test(t)) return 'chips';
    if (e.toZone || e.fromZone || /\b(plays?|leads?|discards?|draws?|lays?|melds?|turns? over|passes \d)\b/.test(t)) return 'card';
    return null;
  }
  $effect(() => {
    const e = lastEntry;
    if (!e || e.t === heard) return;
    const first = heard === -1;
    heard = e.t;
    // (not for what was already on the table when we arrived; in hand mode the big screen plays them)
    if (first || handMode) return;
    const snd = soundFor(e);
    if (snd) sound(snd);
  });
  let lastPhase: string | null = null;
  $effect(() => {
    if (s.phase === 'gameOver' && lastPhase != null && lastPhase !== 'gameOver') sound(display || s.winner?.includes(you) ? 'win' : 'end');
    lastPhase = s.phase;
  });
  const saidBy = (seat: number) =>
    lastEntry?.seat === seat && lastEntry.short ? { text: lastEntry.short, key: lastEntry.t } : null;

  // Before the DOM updates, note where the acting player sits so cards fly to/from them.
  let tableEl: HTMLElement;
  $effect.pre(() => {
    const entry = s.log.at(-1);
    if (!tableEl) return;
    const rect = (seat: number | undefined) => {
      if (seat == null) return null;
      const el = seat === you ? tableEl.querySelector('.hand-wrap') : tableEl.querySelector(`[data-seat="${seat}"]`);
      return el?.getBoundingClientRect() ?? null;
    };
    // in hand mode the table is on the big screen: your own moves fly up toward it
    const anchor = () => {
      const h = tableEl.querySelector('.headline')?.getBoundingClientRect();
      return h ? new DOMRect(h.left + h.width / 2 - 24, h.top, 48, 67) : null;
    };
    flight.actor = handMode && entry?.seat === you ? anchor() : rect(entry?.seat);
    flight.to = rect(entry?.to);
    const pile = (id: string | undefined) => {
      if (!id) return null;
      const el = tableEl.querySelector(`[data-zone="${id}"] .stack`) ?? tableEl.querySelector(`[data-zone="${id}"]`);
      return el?.getBoundingClientRect() ?? (handMode ? anchor() : null);
    };
    flight.fromZone = pile(entry?.fromZone);
    flight.toZone = pile(entry?.toZone);
    snapshot(tableEl);
  });
  // …and after it, slide whatever merely shifted into its new place. This waits for the next
  // animation frame (still before the screen is drawn) so every other change, including
  // leaving cards being lifted out of their row, has happened first, whatever order the
  // browser runs them in (Safari does some of it a beat later than Chrome).
  $effect(() => {
    void s.v;
    const el = tableEl;
    if (!el) return;
    const frame = requestAnimationFrame(() => play(el));
    return () => cancelAnimationFrame(frame);
  });

  // ---- the players row (phones): scrolls sideways, and slides to whoever's turn it is ----------
  let seatsEl = $state<HTMLElement>();
  let moreLeft = $state(false);
  let moreRight = $state(false);
  function edges() {
    const el = seatsEl;
    if (!el) return;
    moreLeft = el.scrollLeft > 4;
    moreRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
  }
  $effect(() => {
    const el = seatsEl;
    const turn = actor;
    void others.length, vw;
    if (!el || display) return;
    const frame = requestAnimationFrame(() => {
      edges();
      const slot = turn == null ? null : (el.querySelector(`[data-seat="${turn}"]`)?.parentElement as HTMLElement | null);
      if (!slot || el.scrollWidth <= el.clientWidth) return;
      // centre the player whose turn it is
      const box = el.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const left = el.scrollLeft + r.left - box.left - (box.width - r.width) / 2;
      el.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  });

  const me = $derived(you >= 0 ? s.players[you] : null);
  /** Game night standings, shown when a game ends. */
  const tonight = $derived(nightTotals(view.lobby.night));
  const myInfo = $derived(you >= 0 ? status.seats[you] : undefined);
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<div class="table" class:display class:handmode={handMode} bind:this={tableEl}>
  <!-- top: menu + opponents + scores -->
  <header>
    <button class="icon" onclick={() => (sheet = 'menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <div class="seats" class:more-left={moreLeft} class:more-right={moreRight} bind:this={seatsEl} onscroll={edges}>
      {#each others as seat (seat)}
        {@const pos = display ? tvSeatPos(seat) : null}
        <div class="seat-slot" style:left={pos?.left} style:top={pos?.top} bind:clientWidth={slotW[seat]} bind:clientHeight={slotH[seat]}>
        <Seat
          player={s.players[seat]}
          info={status.seats[seat]}
          cards={seatZone(seat)}
          turn={s.turn === seat}
          connected={view.lobby.seats[seat]?.connected ?? true}
          {showChips}
          compact={others.length > 4 || (others.length >= 3 && vw < 940 && !display)}
          avatar={view.lobby.seats[seat]?.avatar}
          relation={display ? null : seatRelation(you, seat, n)}
          said={saidBy(seat)}
          ping={view.lobby.seats[seat]?.host ? null : app.pings[seat]}
          scale={tvRem / 16}
          turnLabel={display}
        />
        </div>
      {/each}
    </div>
    <button class="icon" onclick={() => (sheet = 'scores')} aria-label="Scores and log">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 4h10v3a5 5 0 0 1-10 0V4Zm5 8v4m-4 4h8m-4-4v4M7 6H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </header>

  <!-- centre: shared zones, pot, headline -->
  <!-- tapping empty felt clears the selection (a touch shortcut; the Clear button is the accessible path) -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <main onclick={(e) => !(e.target as Element).closest('button, .card') && (selected = [])}>
    {#if status.track && !handMode}<Track track={status.track} avatars={view.lobby.seats.map((x) => x.avatar)} />{/if}
    {#if status.headline}<div class="headline" class:mine={actor === you && you >= 0}><SuitText text={status.headline} /></div>{/if}
    {#if lastMove}
      {#key lastMove.t}
        <div class="last" aria-live="polite">
          {#if lastMove.seat != null}
            <AvatarBadge avatar={view.lobby.seats[lastMove.seat]?.avatar} name={s.players[lastMove.seat]?.name ?? ''} seat={lastMove.seat} size={16} />
          {/if}
          <span><SuitText text={lastMove.text} /></span>
        </div>
      {/key}
    {/if}
    <div class="zones" class:has-strip={stripZones.length > 0}>
      {#each centerZones as z (z.id)}
        <div class="zone-slot">
          <Zone
          zone={z}
          cw={Math.round(centerCw * (z.scale ?? 1) * (z.layout === 'spread' && z.cards.length >= 10 && !display ? 0.82 : 1))}
          {you}
          players={n}
          {selected}
          {selectable}
          ontap={tap}
          zoneActive={!!zoneAction(z.id)}
          onzone={zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined}
        />
        </div>
      {/each}
      {#if status.pot && !handMode}
        <div class="pot" data-flip>
          <div class="chipstack" aria-hidden="true">
            {#each { length: Math.min(6, Math.ceil(Math.log2(status.pot + 1))) } as _, i}
              <span style:bottom="{i * 4}px" style:--c={seatColor(i * 3)}></span>
            {/each}
          </div>
          <div><div class="eyebrow">Pot</div><b>{status.pot.toLocaleString()}</b></div>
        </div>
      {/if}
      {#if stripZones.length}
        <div class="strip">
          {#each stripZones as z (z.id)}
            <Zone
              zone={z}
              cw={Math.round(centerCw * (z.scale ?? 1))}
              {you}
              players={n}
              {selected}
              {selectable}
              ontap={tap}
              zoneActive={!!zoneAction(z.id)}
              onzone={zoneAction(z.id) ? () => run(zoneAction(z.id)!) : undefined}
            />
          {/each}
        </div>
      {/if}
    </div>

    {#if showBanner && status.banner}
      <div class="banner panel">
        <button class="close" onclick={() => (bannerHidden = s.v)} aria-label="Hide">×</button>
        <h2>{status.banner.title}</h2>
        {#each status.banner.lines as line}<p><SuitText text={line} /></p>{/each}
        {#if s.phase === 'gameOver' && tonight.length}
          <!-- top four, so a nine-player night still fits -->
          <p class="tonight">
            Tonight: {tonight.slice(0, 4).map((r) => `${r.name} ${r.points}`).join(' · ')}{tonight.length > 4 ? ` · +${tonight.length - 4} more` : ''}
          </p>
        {/if}
      </div>
    {/if}
  </main>

  {#if !display}
    <!-- bottom: my hand, info and actions -->
    <footer>
      <div class="me">
        {#if me}
          <div class="me-name">
            <AvatarBadge avatar={view.lobby.seats[you]?.avatar} name={me.name} seat={you} size={24} />{me.name}
            {#if myInfo?.tag}<span class="mytag">{myInfo.tag}</span>{/if}
          </div>
          <div class="me-sub">
            {#if showChips}<b>{me.chips.toLocaleString()}</b> chips{/if}
            {#if myInfo?.badge}<span class="gold"><SuitText text={myInfo.badge} /></span>{/if}
          </div>
          {#if status.hint}<div class="hint"><SuitText text={status.hint} /></div>{/if}
        {:else}
          <div class="me-sub">Watching</div>
        {/if}
      </div>
      <!-- bigger fanned cards tip further past the ends: keep them clear of the buttons -->
      <div class="hand-wrap" style:padding-inline={handMode ? `${Math.round(handCw * 0.3)}px` : undefined}>
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
      <ActionBar
        actions={view.actions}
        {selected}
        pot={status.pot}
        onact={(spec, amount, seat) => run(spec, amount, selected, seat)}
        onclear={() => (selected = [])}
        seatInfo={(seat) => ({
          name: s.players[seat]?.name ?? '',
          avatar: view.lobby.seats[seat]?.avatar,
          relation: seatRelation(you, seat, n),
        })}
      />
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

{#if sheet === 'tv'}
  <TvSheet table={view.lobby.code} onclose={() => (sheet = null)} />
{/if}

{#if sheet === 'menu'}
  <Sheet title="Table {view.lobby.code}" onclose={() => (sheet = null)}>
    <div class="menu-list">
      <button class="btn" onclick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
      <button class="btn" onclick={() => { soundsOn = !soundsOn; setSound(soundsOn); }}>{soundsOn ? 'Sound: on' : 'Sound: off'}</button>
      {#if view.lobby.displays && !display}
        <button class="btn" onclick={() => { app.setHandMode(!app.handMode); sheet = null; }}>
          {app.handMode ? 'Show whole table' : 'Just my hand'}
        </button>
      {/if}
      {#if !display}<button class="btn" onclick={() => (sheet = 'tv')}>Show on a TV</button>{/if}
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
            <tr class:hl={r.highlight}><td>{r.name}</td>{#each r.values as v}<td><SuitText text={v} /></td>{/each}</tr>
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
    {#if view.lobby.night?.games.length}
      <div class="eyebrow">Game night</div>
      <NightBoard night={view.lobby.night} seats={view.lobby.seats} />
      <div style:height="1rem"></div>
    {/if}
    <div class="eyebrow">Recent</div>
    <ol class="log">
      {#each [...s.log].reverse().slice(0, 14) as l}<li><SuitText text={l.text} /></li>{/each}
    </ol>
  </Sheet>
{/if}

<style>
  .table {
    position: absolute;
    inset: 0;
    display: grid;
    /* (minmax: a long row of cards scrolls inside the middle instead of widening the screen) */
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'top top'
      'center actions'
      'hand actions';
    padding: calc(6px + var(--safe-t)) calc(10px + var(--safe-r)) calc(4px + var(--safe-b)) calc(10px + var(--safe-l));
    gap: 4px 10px;
    /* clip, not hidden: nothing (a focused button, a card scrolled into view) can shift the table sideways */
    overflow: clip;
  }
  /* hand mode: the middle shrinks to the headline (and any pile you can tap); the hand grows */
  .table.handmode {
    grid-template-rows: auto auto 1fr;
  }
  .table.handmode main {
    padding-top: 4px;
  }
  .table.handmode footer {
    align-self: end;
  }
  .table.handmode .me {
    font-size: 0.9rem;
  }
  .table.handmode .hint {
    font-size: 0.85rem;
  }
  /* ---- table screen: an oval table filling the screen, players around it ---- */
  .table.display {
    display: block;
    padding: 0;
  }
  .table.display::before {
    content: '';
    position: absolute;
    inset: 9% 7%;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 45%, rgba(255, 214, 140, 0.1), transparent 70%);
    box-shadow:
      inset 0 0 0 0.35rem rgba(0, 0, 0, 0.22),
      inset 0 0 3rem rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .table.display header {
    position: absolute;
    inset: 0;
    display: block;
    pointer-events: none;
  }
  .table.display header > .icon {
    position: absolute;
    top: 1rem;
    left: 1rem;
    width: 2.4rem;
    height: 2.4rem;
    pointer-events: auto;
  }
  .table.display header > .icon :global(svg) {
    width: 1.2rem;
    height: 1.2rem;
  }
  .table.display header > .icon:last-child {
    left: auto;
    right: 1rem;
  }
  .table.display .seats {
    position: absolute;
    inset: 0;
    display: block;
    padding: 0;
    margin: 0;
    overflow: visible;
  }
  /* seats keep their size; a row too long for the screen scrolls (and follows the turn) */
  .seat-slot {
    flex: none;
    display: flex;
  }
  /* fade the edge where more players are scrolled out of view */
  .seats.more-left {
    --fade: linear-gradient(90deg, transparent, #000 28px);
  }
  .seats.more-right {
    --fade: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
  }
  .seats.more-left.more-right {
    --fade: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  }
  .seats.more-left,
  .seats.more-right {
    -webkit-mask-image: var(--fade);
    mask-image: var(--fade);
  }
  .table.display .seat-slot {
    position: absolute;
    transform: translate(-50%, -50%);
  }
  .table.display main {
    position: absolute;
    inset: 17% 21%;
    gap: 0.6rem;
  }
  .table.display .headline {
    font-size: 1.15rem;
    padding: 0.4rem 1.2rem;
  }
  .table.display .last {
    font-size: 0.95rem;
  }
  header {
    grid-area: top;
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seats {
    flex: 1;
    display: flex;
    /* centred with auto margins (below), so a row too wide to fit scrolls instead of being cut off at both ends */
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    /* extra room below (overlapping the table) so speech bubbles aren't clipped */
    padding: 10px 2px 40px;
    margin-bottom: -34px;
    pointer-events: none;
  }
  .seats > :global(*) {
    pointer-events: auto;
  }
  .seats > :global(:first-child) {
    margin-left: auto;
  }
  .seats > :global(:last-child) {
    margin-right: auto;
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
    min-width: 0;
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
  .last {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin-top: -2px;
    font-size: 0.74rem;
    color: var(--ink-dim);
    animation: lastIn 0.35s var(--ease-out);
  }
  .last span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @keyframes lastIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .headline.mine {
    --suit-red: #a8121e;
    background: var(--gold);
    color: #2a1d05;
    box-shadow: 0 0 24px rgba(233, 196, 106, 0.45);
  }
  /* never squash the headline or last move when the middle is short of room */
  .headline,
  .last {
    flex-shrink: 0;
  }
  .zones {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 3vw, 32px);
    flex-wrap: wrap;
    min-height: 0;
  }
  /* everyone's melds: beside the piles, in one row that scrolls sideways when long */
  .zones.has-strip {
    flex-wrap: nowrap;
    max-width: 100%;
  }
  .zones.has-strip > .zone-slot {
    flex: none;
  }
  .strip {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    gap: clamp(10px, 2.5vw, 24px);
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 4px;
  }
  .strip > :global(*) {
    flex: none;
  }
  .strip :global(.spread) {
    flex-wrap: nowrap;
  }
  .strip :global(.spread .scard + .scard) {
    margin-left: calc(var(--cw) * -0.45);
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
  .tonight {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
    color: var(--gold);
    font-weight: 600;
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
