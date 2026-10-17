import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standings } from '../src/engine/events';
import { newBackupKey } from '../src/net/backup';
import { newSecret } from '../src/net/eventCrypto';
import { EventLink } from '../src/net/eventLink';
import { sealSave, takeOver, type DirectorSave } from '../src/net/director/standby';
import { CODE, director, FakeEscrow, Net, Phone, playOut, settle } from './eventHarness';
import './games';

/**
 * A standby director: a second device keeps the latest sealed copy of the tournament (which it
 * can't open: the key is with the relay, as with a table's backups) and, when the director's device
 * stops, takes over: the relay hands it the key and the director's rooms, and the tournament
 * carries on from there, the tables linking up again and no result lost.
 */

describe('a standby director', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes over when the director’s device stops: the tables link up again, no result is lost, and the event finishes', async () => {
    const net = new Net();
    const escrow = new FakeEscrow(net);
    const backup = { key: newBackupKey(), token: newBackupKey() };
    const first = director(net, { rounds: 2 }, { backup: { ...backup, escrow } });
    const phones = ['Ann', 'Bo', 'Cy', 'Di'].map((n) => new Phone(net, n));
    const standby = new EventLink(net.open, { code: CODE, cid: 'standby:1', name: 'Standby', secret: newSecret() }, { standby: backup.token });
    const stranger = new EventLink(net.open, { code: CODE, cid: 'standby:2', name: 'Stranger', secret: newSecret() }, { standby: 'a-guess' });
    await settle();
    expect(first.desk.start()).toBeNull();
    await settle();
    expect(first.desk.standbys()).toBe(1);

    // the director sends its copy: the standby has it, sealed (nobody's secret in it), and a stranger doesn't
    first.desk.sendBackup(await sealSave(first.save()));
    await settle(500);
    const copy = standby.backup!.blob;
    expect(copy).toBeTruthy();
    for (const p of phones) expect(copy).not.toContain(p.id.secret);
    expect(stranger.backup).toBeNull();
    // while the director is here, there's nothing to take over
    expect(await takeOver({ code: CODE, blob: copy, token: backup.token, escrow, hostKey: 'new-host' })).toEqual({ error: 'host-here' });

    // one table finishes (its result counted by the director, after the copy was made), then the director's device stops
    const one = phones.find((p) => p.host)!;
    for (let i = 0; i < 3000 && one.host!.step(); i++);
    await settle(500);
    expect(first.d.event.rounds[0].tables.filter((t) => t.result)).toHaveLength(1);
    first.desk.close();
    first.d.close();
    await settle(500);

    // the standby takes over: the key from the relay opens its copy
    expect(await takeOver({ code: CODE, blob: copy, token: 'wrong', escrow, hostKey: 'new-host' })).toEqual({ error: 'not-a-player' });
    const save = await takeOver({ code: CODE, blob: copy, token: backup.token, escrow, hostKey: 'new-host' });
    expect('error' in save).toBe(false);
    const restored = save as DirectorSave;
    expect(restored.hostKey).toBe('new-host');
    // (the copy was from before the result)
    expect(restored.director.event.rounds[0].tables.some((t) => t.result)).toBe(false);
    const second = director(net, { rounds: 2 }, { restore: restored });
    await settle(6000);
    // the finished table's host links up to the new director and sends its result again
    expect(second.d.event.rounds[0].tables.filter((t) => t.result)).toHaveLength(1);

    await playOut(phones, second.d);
    expect(second.d.event.phase).toBe('between');
    second.d.advance();
    await settle();
    expect(phones.every((p) => p.at?.round === 2)).toBe(true);
    await playOut(phones, second.d);
    second.d.advance();
    expect(second.d.event.phase).toBe('done');
    expect(standings(second.d.event).every((r) => r.played === 2)).toBe(true);
    second.desk.close();
    standby.close();
    stranger.close();
    phones.forEach((p) => p.leaveTable());
  });
});
