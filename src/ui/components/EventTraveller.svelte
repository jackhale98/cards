<script lang="ts">
  import { parseCard, rankLabel, SUIT_SYMBOL } from '../../engine/cards';
  import type { Traveller } from '../../engine/events';
  import SuitText from './SuitText.svelte';

  /**
   * A board's traveller, shown once every table has played it: who dealt and who was vulnerable,
   * the four hands, and each table's contract, result and score, with its matchpoints (pairs) or
   * the swing in IMPs (teams).
   */
  interface Props {
    t: Traveller;
    names: Map<string, string>;
    /** Show the hands too. */
    hands?: boolean;
  }
  let { t, names, hands = true }: Props = $props();

  const SEAT = ['N', 'E', 'S', 'W'];
  const VUL: Record<Traveller['vul'], string> = { None: 'Nobody vulnerable', NS: 'N–S vulnerable', EW: 'E–W vulnerable', All: 'Everyone vulnerable' };
  const name = (id: string | null) => (id ? (names.get(id) ?? '?') : 'Bots');
  /** "4SX" → "4♠×". */
  const contract = (c: string | null) =>
    c
      ? c.replace(/^([1-7])(NT|[SHDC])(X*)$/, (_, l: string, s: string, x: string) => `${l}${s === 'NT' ? 'NT' : SUIT_SYMBOL[s as 'S']}${'×'.repeat(x.length)}`)
      : 'Passed';
  const made = (m: number | null) => (m == null ? '' : m === 0 ? '=' : m > 0 ? `+${m}` : `−${-m}`);
  const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0');
  /** A hand's cards in one suit, high to low ("A K 10 4"; "—" for none). */
  const suit = (hand: string[], s: string) =>
    hand
      .map(parseCard)
      .filter((c) => c.suit === s)
      .sort((a, b) => b.rank - a.rank)
      .map((c) => rankLabel(c.rank))
      .join(' ') || '—';
  const pairs = $derived(t.top != null);
</script>

<article class="traveller panel" aria-label={`Board ${t.n}`}>
  <header>
    <b>Board {t.n}</b>
    <span>Dealer {SEAT[t.dealer]} · {VUL[t.vul]}</span>
  </header>
  {#if hands}
    <div class="deal">
      {#each [0, 1, 2, 3] as seat (seat)}
        <div class="hand s{seat}">
          <span class="seat">{SEAT[seat]}</span>
          {#each ['S', 'H', 'D', 'C'] as s (s)}<span class="line"><SuitText text={`${SUIT_SYMBOL[s as 'S']} ${suit(t.hands[seat], s)}`} /></span>{/each}
        </div>
      {/each}
    </div>
  {/if}
  <table>
    <thead>
      <tr
        ><th>Table</th><th class="who">N–S</th><th class="who">E–W</th><th>Contract</th><th class="num">N–S</th><th class="num">{pairs ? 'MPs' : 'IMPs'}</th
        ></tr
      >
    </thead>
    <tbody>
      {#each t.rows as r (r.table)}
        <tr>
          <td>{r.table}</td>
          <td class="who">{name(r.ns)}</td>
          <td class="who">{name(r.ew)}</td>
          <td><SuitText text={r.contract ? `${contract(r.contract)} ${SEAT[r.declarer ?? 0]} ${made(r.made)}` : 'Passed'} /></td>
          <td class="num">{signed(r.score)}</td>
          <td class="num">{pairs ? `${r.mp ?? 0}–${(t.top ?? 0) - (r.mp ?? 0)}` : r.imps != null ? signed(r.imps) : ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</article>

<style>
  .traveller {
    padding: 0.7em 0.9em;
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    min-width: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6em;
  }
  header span {
    font-size: 0.8em;
    color: var(--ink-dim);
  }
  /* the hands round the table: North at the top, West and East either side, South below */
  .deal {
    display: grid;
    grid-template-columns: repeat(3, auto);
    grid-template-areas: '. n .' 'w . e' '. s .';
    justify-content: space-around;
    gap: 0.1em 0.6em;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }
  .hand {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .s0 {
    grid-area: n;
  }
  .s1 {
    grid-area: e;
  }
  .s2 {
    grid-area: s;
  }
  .s3 {
    grid-area: w;
  }
  .seat {
    font-size: 0.8em;
    color: var(--ink-faint);
    letter-spacing: 0.08em;
  }
  .line {
    white-space: nowrap;
  }
  table {
    border-collapse: collapse;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    width: 100%;
  }
  th {
    font-size: 0.8em;
    font-weight: 400;
    color: var(--ink-faint);
    text-align: left;
  }
  td,
  th {
    padding: 0.15em 0.3em;
  }
  tbody tr:nth-child(odd) {
    background: rgba(255, 255, 255, 0.04);
  }
  .who {
    max-width: 8em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num {
    text-align: right;
  }
</style>
