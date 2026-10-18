import type { Msg } from '../protocol';
import type { Transport } from '../transport';

/**
 * Messages one of the director's connections sends in any second, at most: the relay passes on 120
 * a second from each and drops the rest. When a round's moves and everyone's places go out together
 * to a room of twenty phones, the rest wait their turn.
 */
export const SENDS_PER_SECOND = 100;

/**
 * A connection's messages, sent now while it's within the relay's rate (in any second: the relay
 * counts its own seconds), else in their turn, in order. A timer only while some are waiting.
 */
export class Pacer {
  /** When each of the last second's messages went. */
  private sent: number[] = [];
  private waiting: [Msg, string][] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly perSecond = SENDS_PER_SECOND,
  ) {}

  send(msg: Msg, peer: string) {
    this.waiting.push([msg, peer]);
    this.drain();
  }

  private drain() {
    if (this.timer || this.closed) return;
    const now = Date.now();
    while (this.sent.length && now - this.sent[0] >= 1000) this.sent.shift();
    while (this.waiting.length && this.sent.length < this.perSecond) {
      const [msg, peer] = this.waiting.shift()!;
      this.sent.push(now);
      this.transport.send(msg, peer);
    }
    if (this.waiting.length)
      this.timer = setTimeout(
        () => {
          this.timer = null;
          this.drain();
        },
        this.sent[0] + 1000 - now,
      );
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
