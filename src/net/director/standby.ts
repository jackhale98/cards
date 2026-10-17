import { newBackupKey, open, seal } from '../backup';
import type { Director, DirectorSnapshot } from '../director';
import type { Transport } from '../transport';
import type { Desk, DeskSaved } from './desk';
import type { Member, Registry } from './registry';

/**
 * A standby director: a second device (a laptop, say) that holds the latest copy of the
 * director's tournament, sealed, as a table's players hold its backups: it can't open it, since
 * the key is left with the relay (in each of the director's rooms). If the director's device
 * stops, the standby takes over: the relay hands it the key and the rooms, and the tournament
 * carries on there. The tables played on phones never stopped; they link up to the new director.
 */

/** What the director keeps on its device (to carry on after a reload), and what a standby's copy holds. */
export interface DirectorSave {
  v: 1;
  code: string;
  /** Its claim on its rooms at the relay. */
  hostKey: string;
  registry: Member[];
  director: DirectorSnapshot;
  desk: DeskSaved;
  /** A standby's copy is sealed with `key` (left with the relay) and taken over with `token` (the standby's link). */
  backup: { key: string; token: string };
  at: number;
}

/** The relay's part (see relay/src/index.ts): a key left in a room, handed to whoever takes the room over. */
export interface Escrow {
  /** The director leaves its key in one of its rooms (repeated as a heartbeat, so the relay can tell it's still there). */
  deposit(code: string, room: Transport, key: string, token: string): void;
  /** Take over room `code` as its new host (`newHostKey`): the key, or why not (`host-here`, `too-soon`, `no-backup`, `not-a-player`, `offline`). */
  takeover(code: string, newHostKey: string, token: string): Promise<{ key?: string; error?: string }>;
}

/** A room's connection that can leave a key with the relay, and take a room over (our relay's; and, testing in one browser, the local stand-in). */
interface EscrowRoom {
  deposit(key: string, token: string): unknown;
  takeover(newHostKey: string, token: string): Promise<{ key?: string; error?: string }>;
  opened(): Promise<boolean>;
}
const escrowOf = (t: Transport) => ('takeover' in t && 'deposit' in t && 'opened' in t ? (t as Transport & EscrowRoom) : null);

/**
 * The escrow in the director's rooms (see transport.ts eventRooms): the key goes with each room,
 * and a takeover asks each room in turn. Networks without one have nothing to take over.
 */
export function roomEscrow(open: (code: string) => Transport): Escrow {
  return {
    deposit: (_code, room, key, token) => void escrowOf(room)?.deposit(key, token),
    async takeover(code, newHostKey, token) {
      const t = open(code);
      const r = escrowOf(t);
      try {
        if (!r || !(await r.opened())) return { error: 'offline' };
        return await r.takeover(newHostKey, token);
      } finally {
        t.leave();
      }
    },
  };
}

/** The director sends its standby a fresh copy at most this often. */
export const BACKUP_EVERY_MS = 5000;
/** …and says it's still here this often, while a standby is linked. */
export const ALIVE_EVERY_MS = 10_000;
/** The standby offers to take over once it hasn't heard from the director for this long. */
export const DIRECTOR_QUIET_MS = 30_000;

export function directorSave(o: {
  code: string;
  hostKey: string;
  registry: Registry;
  director: Director;
  desk: Desk;
  backup: DirectorSave['backup'];
}): DirectorSave {
  return {
    v: 1,
    code: o.code,
    hostKey: o.hostKey,
    registry: o.registry.snapshot(),
    director: o.director.snapshot(),
    desk: o.desk.saved(),
    backup: o.backup,
    at: Date.now(),
  };
}

/** The standby's copy of a save. */
export const sealSave = (save: DirectorSave) => seal(save, save.backup.key);

/**
 * The director has gone: take over its rooms (the event's own first, whose key opens the copy,
 * then the rest) and carry on from the copy, as their host now (`hostKey`). Its tables are as they
 * were when the copy was made; those on phones carry on and link up again (sending any result
 * since). A fresh key for the next standby's copies; the same link for it.
 */
export async function takeOver(o: { code: string; blob: string; token: string; escrow: Escrow; hostKey: string }): Promise<DirectorSave | { error: string }> {
  const front = await o.escrow.takeover(o.code, o.hostKey, o.token);
  if (!front.key) return { error: front.error ?? 'offline' };
  let save: DirectorSave;
  try {
    save = await open<DirectorSave>(o.blob, front.key);
  } catch {
    return { error: 'bad-copy' };
  }
  // (and the rooms of tables the director hosted, which people play in)
  for (const room of [...save.desk.rooms, ...Object.values(save.director.rooms ?? {})]) if (room !== o.code) await o.escrow.takeover(room, o.hostKey, o.token);
  return { ...save, hostKey: o.hostKey, backup: { key: newBackupKey(), token: save.backup.token }, at: Date.now() };
}
