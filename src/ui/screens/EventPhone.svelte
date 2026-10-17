<script lang="ts">
  import { app } from '../../app.svelte';
  import { getGame } from '../../games';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import EventStandings from '../components/EventStandings.svelte';
  import Loader from '../components/Loader.svelte';

  /**
   * A phone in a tournament, away from a table: signing up (and, in a partnership game, choosing
   * a partner), then waiting (a bye, knocked out, between tables), and at the end, the standings.
   * At a table the phone shows the table, as at any other; the director sends it there.
   */
  const ev = $derived(app.events.phone);
  const board = $derived(ev?.board ?? null);
  const you = $derived(ev?.you ?? null);
  const game = $derived(board ? getGame(board.game.id) : null);
  const me = $derived(app.cid);
  const people = $derived(ev?.people ?? []);
  const mine = $derived(people.find((p) => p.id === me));
  // a partnership game: everyone signs up with a partner
  const pairs = $derived((board?.perSide ?? 1) > 1);
  const askedMe = $derived(people.filter((p) => p.partner === me && mine?.partner !== p.id));
  const FORMAT: Record<string, string> = { swiss: 'Swiss', roundRobin: 'Round robin', knockout: 'Knockout' };
</script>

<main class="event-phone">
  <header>
    <span class="eyebrow">Tournament · {ev?.code ?? ''}</span>
    <h1>{board?.name ?? 'Joining…'}</h1>
    {#if game && board}<p class="sub">{game.config.name} · {FORMAT[board.format]}{board.rounds ? ` · ${board.rounds} rounds` : ''}</p>{/if}
  </header>

  {#if ev?.refused}
    <section class="panel note">
      <p>{ev.refused}</p>
      <button class="btn" onclick={() => app.go('/')}>Back</button>
    </section>
  {:else if !you || !board}
    <div class="wait">
      <Loader size={40} />
      <p>Signing you up…</p>
    </div>
  {:else if board.phase === 'registering'}
    <section class="panel note">
      <p><b>You're in.</b> The director starts when everyone's here: you'll be sent to your table.</p>
    </section>
    {#if pairs}
      <section class="panel partner">
        <span class="eyebrow">Your partner</span>
        <p class="small">Pick who you'd like to partner. When you pick each other, you're a pair; anyone without one is paired up by the director.</p>
        <div class="choices">
          {#each people.filter((p) => p.id !== me && !p.bot) as p (p.id)}
            <button
              class="person"
              class:on={mine?.partner === p.id}
              class:asked={p.partner === me}
              onclick={() => app.events.partner(mine?.partner === p.id ? null : p.id)}
            >
              <AvatarBadge avatar={p.avatar} name={p.name} size={28} />
              <span>{p.name}</span>
              {#if mine?.partner === p.id && p.partner === me}<em>partners</em>{:else if p.partner === me}<em>picked you</em>{/if}
            </button>
          {/each}
        </div>
        {#if askedMe.length}<p class="small">{askedMe.map((p) => p.name).join(', ')} picked you.</p>{/if}
      </section>
    {/if}
    <section class="people">
      <span class="eyebrow">Signed up · {people.length}</span>
      <ul>
        {#each people as p (p.id)}
          <li class:me={p.id === me} class:bot={p.bot}><AvatarBadge avatar={p.avatar} name={p.name} size={26} /><span>{p.name}</span></li>
        {/each}
      </ul>
    </section>
  {:else}
    <section class="panel note">
      {#if board.phase === 'done'}
        <p><b>That's the tournament!</b> {you.rank ? `You finished ${you.rank === 1 ? 'first' : `#${you.rank}`}.` : ''}</p>
      {:else if you.out}
        <p>You've withdrawn: your results so far stand.</p>
      {:else if you.bye}
        <p><b>A bye this round</b> ({board.format === 'swiss' ? 'it counts as a win' : 'you sit this one out'}). You'll be sent to your table for the next.</p>
      {:else if board.format === 'knockout' && board.standings.find((r) => r.entrant === you.entrant)?.alive === false}
        <p>You're out of the knockout. Thanks for playing: watch the bracket on the screen.</p>
      {:else}
        <p>Round {board.round}: your table's on its way.</p>
      {/if}
    </section>
    <EventStandings rows={board.standings} {people} me={you.entrant} knockout={board.format === 'knockout'} />
    <button class="btn quiet" onclick={() => app.go('/')}>Leave</button>
  {/if}
</main>

<style>
  .event-phone {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: calc(14px + var(--safe-t)) calc(16px + var(--safe-r)) calc(16px + var(--safe-b)) calc(16px + var(--safe-l));
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 44rem;
    margin: 0 auto;
    background: var(--felt);
  }
  h1 {
    margin: 0.1rem 0 0;
    font-family: var(--font-card);
    font-size: 1.6rem;
  }
  .sub {
    margin: 0.2rem 0 0;
    color: var(--ink-dim);
  }
  .note {
    padding: 0.8rem 1rem;
  }
  .note p {
    margin: 0 0 0.4rem;
    line-height: 1.45;
  }
  .note p:last-child {
    margin: 0;
  }
  .wait {
    display: grid;
    justify-items: center;
    gap: 0.6rem;
    padding: 2rem;
    color: var(--ink-dim);
  }
  .partner {
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .partner .small {
    margin: 0;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.4rem;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    min-height: 44px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.05);
    text-align: left;
    min-width: 0;
  }
  .person span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .person em {
    font-size: 0.75rem;
    color: var(--gold);
  }
  .person.on {
    border-color: var(--gold);
    background: rgba(233, 196, 106, 0.14);
  }
  .people ul {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.4rem;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .people li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .people li.bot span {
    color: var(--ink-faint);
    font-style: italic;
  }
  .people li.me span {
    color: var(--gold);
    font-weight: 700;
  }
</style>
