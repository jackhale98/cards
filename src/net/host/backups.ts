import type { GameState } from '../../engine/types';
import { seal } from '../backup';
import type { Lobby } from '../protocol';
import type { Transport } from '../transport';
import { BACKUP_EVERY_MS, BACKUP_HOLDERS, BACKUP_SOON_MS } from './limits';

/** What a backup is made of and sent over: the host's table, as it is now. */
export interface BackupTable {
  readonly transport: Transport | null;
  readonly state: GameState | null;
  readonly lobby: Lobby;
  readonly keys: Record<string, string>;
  /** The table's version now. */
  readonly v: number;
  /** transport peer → client id, and which peers are table screens. */
  readonly peers: Map<string, string>;
  readonly displays: Set<string>;
}

/**
 * Host handoff: two players hold a sealed backup of the table (one is enough to take over; two in
 * case one has gone too), sealed with a key only the relay holds. Sent when a trick or hand ends,
 * when someone new must hold one, and otherwise at most every BACKUP_EVERY_MS.
 */
export class Backups {
  /** The key backups are sealed with (held by the relay), and the token that lets a holder take over. */
  private key?: string;
  private token?: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the queued backup goes, and when the last one went. */
  private due = 0;
  private at = 0;
  private sent = -1;
  /** Who holds the latest backup (client ids). */
  private holders: string[] = [];
  /** The phase, and the cards on the trick, at the last broadcast: their change marks a trick or hand ending. */
  private seenPhase?: string;
  private seenTrick = 0;

  constructor(private readonly t: BackupTable) {}

  /** The relay's sealing key and takeover token (none: no backups). */
  configure(key: string | undefined, token: string | undefined) {
    this.key = key;
    this.token = token;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Queue a backup: soon after a trick or a hand ends, or when someone new must hold one (a holder
   * has gone); otherwise within BACKUP_EVERY_MS of the last.
   */
  queue() {
    if (!this.t.transport || !this.key) return;
    const s = this.t.state;
    const trick = s?.zones.trick?.cards.length ?? 0;
    const ended = !!s && (s.phase !== this.seenPhase || (this.seenTrick > 0 && trick === 0));
    this.seenPhase = s?.phase;
    this.seenTrick = trick;
    const newHolder = this.chosen().some(([cid]) => !this.holders.includes(cid));
    const now = Date.now();
    const due = ended || newHolder ? now + BACKUP_SOON_MS : Math.max(now, this.at + BACKUP_EVERY_MS);
    if (this.timer) {
      if (this.due <= due) return;
      clearTimeout(this.timer);
    }
    this.due = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, due - now);
  }

  /**
   * The players to hold backups, and the connection to send each one's on: seated people who could
   * take over (not bots, not table screens), connected now. Those already holding one come first, so
   * a backup isn't passed around; then in seat order.
   */
  private chosen(): [string, string][] {
    const reach = new Map<string, string>();
    for (const [peer, cid] of this.t.peers) if (!this.t.displays.has(peer) && !reach.has(cid)) reach.set(cid, peer);
    const people = this.t.lobby.seats.filter((x) => !x.bot && !x.host && reach.has(x.id)).map((x) => x.id);
    const order = [...people.filter((c) => this.holders.includes(c)), ...people.filter((c) => !this.holders.includes(c))];
    return order.slice(0, BACKUP_HOLDERS).map((cid) => [cid, reach.get(cid)!]);
  }

  private async send() {
    const v = this.t.v;
    const to = this.chosen();
    // (nothing new: only a new holder needs it)
    const fresh = v === this.sent ? to.filter(([cid]) => !this.holders.includes(cid)) : to;
    this.at = Date.now();
    if (!fresh.length) return;
    const blob = await seal({ lobby: this.t.lobby, state: this.t.state, keys: this.t.keys }, this.key!);
    this.sent = v;
    this.holders = to.map(([cid]) => cid);
    for (const [, peer] of fresh) this.t.transport?.send({ t: 'backup', blob, v, token: this.token }, peer);
  }
}
