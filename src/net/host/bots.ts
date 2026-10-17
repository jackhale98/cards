import { botView } from '../../engine/botView';
import { fallbackMoves } from '../../engine/fallback';
import { resolveAction } from '../../engine/redact';
import type { Action, GameModule, GameState } from '../../engine/types';
import { inlineBrain, type Brain, type Pick, type Thought } from '../brain';
import { report } from '../reports';

/** What the bots play at: the host's table, as it is now, and how a move is made there. */
export interface BotTable {
  readonly state: GameState | null;
  readonly module: GameModule | null;
  readonly closed: boolean;
  /** How much longer to wait after this moment (a move its player can still take back). */
  grace(s: GameState): number;
  /** Make a move for a seat (null: done; else why the rules refused it). */
  apply(seat: number, a: Action): string | null;
  /** Run an automatic step (collect a trick, deal the next hand…). */
  system(sys: { run: (s: GameState) => void }, module: GameModule): void;
}

/**
 * The bots and the table's automatic steps. Turn by turn, every bot with a move thinks (in the
 * background, in the app: see brain.ts), each seeing only its own seat, and moves after a natural
 * pause; real-time games run every bot on its own timer at once. A bot's mistake never freezes
 * the table (see rescue).
 */
export class Bots {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Counts requests to the brain: an answer to an older one (the table has moved on) is ignored. */
  private thinking = 0;

  constructor(
    private readonly t: BotTable,
    private readonly brain: Brain = inlineBrain(),
    /** Development and tests: nothing moves by itself (see Host's `still`). */
    private readonly still = false,
  ) {
    this.brain.onError = (e, game, phase) => {
      console.error(e);
      report('bot', e, { game, phase, action: 'think' });
    };
  }

  /** Someone made a move: bots that `rescue` moved for start afresh. */
  moved() {
    this.rescued.clear();
  }

  /** Waiting to move (a timer set): for tests. */
  get waiting() {
    return this.timer;
  }

  /** Run system steps (e.g. collecting a trick) and bot moves after a natural pause. */
  pump() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.t.state;
    const module = this.t.module;
    if (!s || !module || this.still) return;
    if (module.realtime) return this.pumpRealtime(s, module);
    const sys = module.system?.(s);
    // (a move that can still be taken back: give its player a moment before the table moves on)
    const grace = this.t.grace(s);
    if (sys) {
      this.timer = setTimeout(() => this.t.system(sys, module), sys.delay + grace);
      return;
    }
    if (!module.bot) return;
    // (only bots with a move on offer: no sending the whole game off to think on a person's turn)
    const seats = s.players.filter((p) => p.bot && module.actions(s, p.seat).some((a) => !a.menu)).map((p) => p.seat);
    if (!seats.length) return;
    // bots think (in the background, in the app), then move after a natural pause
    const turn = ++this.thinking;
    const asked = Date.now();
    const pause = 650 + Math.random() * 600 + grace;
    const then = (pick: Thought) => {
      if (this.t.closed || turn !== this.thinking || this.t.state !== s || !pick) return; // (the table moved on)
      const wait = Math.max(0, pause - (Date.now() - asked));
      // a bot that failed still moves: something plain and legal (see rescue)
      this.timer = setTimeout(() => (pick === 'failed' ? this.rescue(seats) : this.move(module, pick)), wait);
    };
    // each bot sees only its own seat's view (botView.ts); its answer comes back to the real deal
    const views = new Map(seats.map((seat) => [seat, botView(module, s, seat)]));
    const back = (pick: Thought): Thought => {
      if (!pick || pick === 'failed') return pick;
      const action = resolveAction(s, pick.seat, views.get(pick.seat)!.unfill(pick.action));
      return action ? { seat: pick.seat, action } : 'failed';
    };
    let pick: ReturnType<Brain['think']>;
    try {
      pick = this.brain.think(module.config.id, Object.fromEntries([...views].map(([seat, v]) => [seat, v.view])), seats);
    } catch (e) {
      this.brain.onError(e, module.config.id, s.phase);
      pick = 'failed';
    }
    if (pick instanceof Promise)
      void pick.then(
        (p) => then(back(p)),
        (e) => {
          this.brain.onError(e, module.config.id, s.phase);
          then('failed');
        },
      );
    else then(back(pick));
  }

  private move(module: GameModule, { seat, action: a }: Pick) {
    const err = this.t.apply(seat, a);
    if (!err) return this.rescued.clear();
    console.warn(`Bot ${seat}: ${err}`, a);
    // (a bot proposing a move the rules refuse is a bug in the bot)
    report('bot', new Error(err), { game: module.config.id, phase: this.t.state?.phase ?? '', action: a.type });
    this.rescue([seat]);
  }

  /**
   * Never let a bot's mistake freeze the table: the first of these bots with anything to do makes
   * the plainest legal move on offer (see fallbackMoves), trying each until the rules accept one.
   */
  private rescue(seats: number[]) {
    const m = this.t.module;
    if (!m || !this.t.state) return;
    // (bots it has already moved for go last: some moves stay on offer once made, like a pass
    // that can be changed until everyone has passed, and each stuck bot needs its turn)
    const order = [...seats.filter((x) => !this.rescued.has(x)), ...seats.filter((x) => this.rescued.has(x))];
    for (const seat of order)
      for (const a of fallbackMoves(m.actions(this.t.state, seat)))
        if (!this.t.apply(seat, a)) {
          if (this.rescued.size >= seats.length) this.rescued.clear();
          this.rescued.add(seat);
          return;
        }
  }
  /** Bots `rescue` has moved for since anyone else moved. */
  private rescued = new Set<number>();

  /** Real-time games: each bot's planned move, its key (to tell when the plan changes) and its timer. */
  readonly botPlans = new Map<number, { key: string; timer: ReturnType<typeof setTimeout> }>();

  /**
   * Real-time games: the system step on its own timer, and every bot on its own, all at once. A
   * bot keeps its timer while its plan stays the same (so a busy table doesn't keep pushing its
   * reaction back), and starts a new one when the plan changes.
   */
  private pumpRealtime(s: GameState, module: GameModule) {
    const sys = module.system?.(s);
    if (sys)
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.t.state && this.t.module === module) this.t.system(sys, module);
      }, sys.delay);
    const keyOf = (a: Action) => JSON.stringify({ ...a, rt: undefined, at: undefined });
    for (const p of s.players) {
      if (!p.bot) continue;
      const a = this.think(module, s, p.seat);
      const plan = this.botPlans.get(p.seat);
      if (!a) {
        if (plan) clearTimeout(plan.timer);
        this.botPlans.delete(p.seat);
        continue;
      }
      const key = keyOf(a);
      if (plan?.key === key) continue;
      if (plan) clearTimeout(plan.timer);
      const delay = Math.max(0, module.botDelay?.(s, p.seat, a) ?? 600);
      const timer = setTimeout(() => {
        this.botPlans.delete(p.seat);
        if (!this.t.state || this.t.module !== module) return;
        // still what it means to do?
        const again = this.think(module, this.t.state, p.seat);
        if (!again || keyOf(again) !== key) return this.pump();
        const err = this.t.apply(p.seat, { ...a, rt: delay, at: Date.now() });
        if (err) {
          // (in a real-time game the table can move on under a bot: just think again)
          this.pump();
        }
      }, delay);
      this.botPlans.set(p.seat, { key, timer });
    }
  }

  /** A bot's next move; a bot that throws is reported and sits this one out, not the whole table. */
  private think(module: GameModule, s: GameState, seat: number): Action | null {
    try {
      const v = botView(module, s, seat);
      const a = module.bot?.(v.view, seat);
      return a ? resolveAction(s, seat, v.unfill(a)) : null;
    } catch (e) {
      console.error(e);
      report('bot', e, { game: module.config.id, phase: s.phase, action: 'think' });
      return null;
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.thinking++;
    for (const plan of this.botPlans.values()) clearTimeout(plan.timer);
    this.botPlans.clear();
  }
}
