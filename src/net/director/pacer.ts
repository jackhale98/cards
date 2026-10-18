import type { Msg } from '../protocol';
import type { Transport } from '../transport';

/**
 * Messages one of the director's connections sends in any second, at most: the relay passes on 120
 * a second from each and drops the rest. When a round's moves and everyone's places go out together
 * to a room of twenty phones, the rest wait their turn.
 */
export const SENDS_PER_SECOND = 100;
/** …and bytes (the relay passes on 1 MB): a whole board for each of a dozen phones just knocked out is more. */
export const BYTES_PER_SECOND = 800_000;

/**
 * A connection's messages, sent now while it's within the relay's rates (in any second: the relay
 * counts its own seconds), else in their turn, in order. A timer only while some are waiting.
 */
export class Pacer {
  /** When each of the last second's messages went, and its size. */
  private sent: { at: number; size: number }[] = [];
  private bytes = 0;
  private waiting: { msg: Msg; peer: string; size: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly perSecond = SENDS_PER_SECOND,
    private readonly bytesPerSecond = BYTES_PER_SECOND,
  ) {}

  send(msg: Msg, peer: string) {
    this.waiting.push({ msg, peer, size: JSON.stringify(msg).length });
    this.drain();
  }

  private drain() {
    if (this.timer || this.closed) return;
    const now = Date.now();
    while (this.sent.length && now - this.sent[0].at >= 1000) this.bytes -= this.sent.shift()!.size;
    // (one bigger than a second's bytes goes when nothing else has lately)
    while (this.waiting.length && this.sent.length < this.perSecond && (!this.sent.length || this.bytes + this.waiting[0].size <= this.bytesPerSecond)) {
      const { msg, peer, size } = this.waiting.shift()!;
      this.sent.push({ at: now, size });
      this.bytes += size;
      this.transport.send(msg, peer);
    }
    if (this.waiting.length)
      this.timer = setTimeout(
        () => {
          this.timer = null;
          this.drain();
        },
        this.sent[0].at + 1000 - now,
      );
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
