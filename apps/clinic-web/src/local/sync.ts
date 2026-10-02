// Bộ máy đồng bộ (kế hoạch, N1–N3, OFF-6, OFF-7): gửi các mục trong hàng đợi trên máy lên BFF theo thứ tự phụ thuộc.
// - Lưu bền trước, gửi sau: mục chỉ được gửi khi đã nằm trong kho; trình duyệt sập lúc nào thì mở lại vẫn gửi tiếp (N1).
// - Một mục một `clientUuid`, giữ nguyên qua mọi lần gửi lại (N2); máy chủ idempotent theo UUID nên gửi lại không tạo trùng.
// - Không âm thầm (N3): mục bị từ chối nằm lại với trạng thái cần xử lý; không tự bỏ, không tự ghi đè.
// - Chỉ gửi mục của chính người đang đăng nhập: mỗi người một kho, và bộ máy dừng nếu phiên không phải chủ kho (OFF-6).
import { vnDay } from '@phongmach/clinical';
import { ApiError } from '../api';
import { ATTENTION, depState } from './deps';
import { effectsOf, resolveIds, send, type AnyOp, type NewOp, type Op, type OpBody, type OpError, type Payloads } from './ops';
import { dbName, type Change, type LocalStore, type OpMeta, type OpStatus, type Owner } from './store';

/** Đồng hồ và bộ hẹn giờ, tiêm vào được để kiểm thử chạy bằng thời gian ảo. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Phần của Web Locks mà bộ máy dùng: một tên khóa, mỗi lúc chỉ một nơi giữ. */
export interface Locks {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export interface Session {
  token: string;
  tenant: string;
  userId: string;
}

export interface SyncOptions {
  store: LocalStore;
  /** Chủ của kho: chỉ gửi khi phiên hiện tại đúng là người này. */
  owner: Owner;
  session: () => Session | undefined;
  clock?: Clock;
  locks?: Locks;
  /** Trình duyệt có báo đang có mạng không (`navigator.onLine`). */
  isOnline?: () => boolean;
  /** Chờ gửi lại: base · 2^(n−1), tối đa cap (mili giây). */
  baseMs?: number;
  capMs?: number;
  /** Chạy định kỳ khi còn mục chưa xong (mục do tab khác thêm, lỡ sự kiện). */
  periodMs?: number;
}

/** Kết quả của một mục sau khi được đẩy đi (dùng khi gửi ngay lúc có mạng). */
export type Outcome =
  | { kind: 'done'; result: unknown }
  /** Chưa tới được máy chủ vì mất mạng: mục nằm trong hàng đợi (đã chuyển sang dạng ngoại tuyến nếu có `promote`). */
  | { kind: 'offline' }
  /** Máy chủ lỗi tạm (5xx, 503 ghi dở, 429): mục nằm trong hàng đợi, tự gửi lại. */
  | { kind: 'retrying'; error: OpError }
  /** Mục trước nó chưa xong (đang thử lại). */
  | { kind: 'waiting' }
  /** Phiên hết hạn (401) hoặc phiên không phải chủ kho: đã dừng đồng bộ. */
  | { kind: 'paused' }
  /** Máy chủ từ chối: xung đột (409), quy tắc kê đơn (422), lỗi khác. */
  | { kind: 'rejected'; status: 'conflict' | 'rules' | 'error'; error: OpError }
  /** Mục trước nó đang cần xử lý: bị giữ lại. */
  | { kind: 'held'; by: string };

export interface SyncState {
  /** Theo những gì bộ máy thấy: trình duyệt báo mất mạng hoặc lần gửi gần nhất lỗi mạng thì false. */
  online: boolean;
  paused: false | 'unauthorized' | 'owner';
  /**
   * false cho tới khi đếm xong lần đầu sau khi mở kho (đăng nhập, tải lại trang): trong lúc đó `pending` và `attention` là 0
   * nhưng chưa có nghĩa. Giao diện phải hiện "đang đếm" thay cho "0" (N3: không báo "hết mục chờ" khi chưa biết).
   */
  counted: boolean;
  /** Mục chưa xong (mọi trạng thái trừ `done`). */
  pending: number;
  /** Mục cần người xử lý (xung đột, quy tắc, lỗi khác) và mục bị chúng giữ lại. */
  attention: number;
  /** id mục đang gửi (chỉ trong tab đang giữ khóa). */
  sending?: string;
  /** Lần gần nhất máy chủ nhận một mục của máy này (ms kể từ epoch). Không có: hôm nay chưa gửi được mục nào. */
  lastSyncAt?: number;
  /** Tăng mỗi lần kho thay đổi: giao diện đọc lại hàng đợi khi số này đổi. */
  version: number;
}

/** Biến đổi một mục khi nó chưa gửi được vì mất mạng (ví dụ thêm giờ máy khách, số tạm): cùng id, cùng `clientUuid`. */
export type Promote = (payload: Payloads[keyof Payloads]) => { payload: Payloads[keyof Payloads]; changes?: Change[] } | Promise<{ payload: Payloads[keyof Payloads]; changes?: Change[] }>;

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

// Trình duyệt không có Web Locks: khóa trong tab (các tab không loại trừ nhau, nhưng máy chủ vẫn idempotent theo UUID).
const localChains = new Map<string, Promise<unknown>>();
export const inTabLocks: Locks = {
  request<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = localChains.get(name) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    localChains.set(
      name,
      next.catch(() => undefined)
    );
    return next;
  },
};

function defaultLocks(): Locks {
  const nav = globalThis.navigator as (Navigator & { locks?: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } }) | undefined;
  const locks = nav?.locks;
  if (!locks) return inTabLocks;
  return { request: <T>(name: string, fn: () => Promise<T>) => locks.request(name, fn) as Promise<T> };
}

/** Phân loại phản hồi theo OFF-7. */
export function classify(err: unknown): { verdict: 'network' | 'retry' | 'paused' | 'conflict' | 'rules' | 'error'; error: OpError } {
  if (!(err instanceof ApiError)) {
    return { verdict: 'error', error: { status: -1, code: 'client', message: err instanceof Error ? err.message : String(err) } };
  }
  const error: OpError = { status: err.status, code: err.code, message: err.message, ...(err.body !== undefined ? { body: err.body } : {}) };
  if (err.status === 0) return { verdict: 'network', error };
  if (err.status === 401) return { verdict: 'paused', error };
  if (err.status === 409) return { verdict: 'conflict', error };
  if (err.status === 422 && err.code === 'rules-not-satisfied') return { verdict: 'rules', error };
  if (err.status === 429 || err.status >= 500) return { verdict: 'retry', error };
  return { verdict: 'error', error };
}

export class SyncEngine {
  private readonly store: LocalStore;
  private readonly owner: Owner;
  private readonly session: () => Session | undefined;
  private readonly clock: Clock;
  private readonly locks: Locks;
  private readonly isOnline: () => boolean;
  private readonly baseMs: number;
  private readonly capMs: number;
  private readonly periodMs: number;
  private readonly lockName: string;

  private current: SyncState = { online: true, paused: false, counted: false, pending: 0, attention: 0, version: 0 };
  private readonly listeners = new Set<(s: SyncState) => void>();
  private timer: unknown;
  private started = false;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  private queued: Promise<void> | undefined;
  /** Gửi tất cả ngay, bỏ qua thời gian chờ (nút "Đồng bộ ngay", sự kiện `online`). */
  private force = false;
  /** Mục cần gửi ngay (thao tác lúc có mạng) và cách chuyển nó sang dạng ngoại tuyến nếu mất mạng. */
  private readonly focus = new Map<string, Promote | undefined>();
  /** Mục gửi ngay đã được chuyển sang dạng ngoại tuyến vì mất mạng. */
  private readonly promoted = new Set<string>();
  private lastSeq = 0;
  private expiredToken: string | undefined;

  constructor(opts: SyncOptions) {
    this.store = opts.store;
    this.owner = opts.owner;
    this.session = opts.session;
    this.clock = opts.clock ?? realClock;
    this.locks = opts.locks ?? defaultLocks();
    this.isOnline = opts.isOnline ?? (() => globalThis.navigator?.onLine !== false);
    this.baseMs = opts.baseMs ?? 2000;
    this.capMs = opts.capMs ?? 60_000;
    this.periodMs = opts.periodMs ?? 30_000;
    this.lockName = `phongmach-sync:${dbName(this.owner)}`;
    this.current.online = this.isOnline();
  }

  get state(): SyncState {
    return this.current;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncState>, bump = false): void {
    this.current = { ...this.current, ...patch, ...(bump ? { version: this.current.version + 1 } : {}) };
    if (patch.sending === undefined && 'sending' in patch) delete this.current.sending;
    for (const fn of this.listeners) fn(this.current);
  }

  /** Bắt đầu: gửi những gì còn lại từ lần trước (kể cả sau khi trình duyệt sập) và hẹn giờ. */
  start(): Promise<void> {
    if (this.started) return this.idle();
    this.started = true;
    this.stopped = false;
    return this.refreshCounts().then(() => this.run());
  }

  /** Dừng hẹn giờ (rời phiên). Bắt đầu lại được (React chạy hiệu ứng hai lần ở bản dev). */
  stop(): void {
    this.stopped = true;
    this.started = false;
    this.clock.clearTimeout(this.timer);
  }

  /** Có mạng lại (sự kiện `online`): gửi ngay, không chờ hết thời gian chờ. */
  wake(): Promise<void> {
    this.emit({ online: this.isOnline() });
    return this.syncNow();
  }

  /** Nút "Đồng bộ ngay". */
  syncNow(): Promise<void> {
    this.force = true;
    return this.run();
  }

  /** Mọi mục trong kho, theo thứ tự hàng đợi (đã giải mã). */
  async ops(): Promise<AnyOp[]> {
    const rows = await this.store.list<'ops', OpBody>('ops');
    return rows.map((r) => ({ id: r.id, meta: r.plain, body: r.value, updatedAt: r.updatedAt }) as AnyOp).sort((a, b) => a.meta.seq - b.meta.seq);
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(this.clock.now() * 1000, this.lastSeq + 1);
    return this.lastSeq;
  }

  /**
   * Lưu bền các mục mới cùng các thay đổi kèm theo (bản nháp, bộ đệm…) trong MỘT giao dịch, rồi mới gửi (N1).
   * Mục đã có cùng id: đã xong thì giữ nguyên; chưa xong thì thay dữ liệu, giữ id (cùng `clientUuid`) và thứ tự.
   */
  async enqueue(entries: NewOp[], extra: Change[] = []): Promise<void> {
    const changes: Change[] = [];
    for (const e of entries) {
      const existing = await this.store.get<'ops', OpBody>('ops', e.id);
      if (existing?.plain.status === 'done') continue;
      changes.push(
        existing
          ? { table: 'ops', id: e.id, plain: { ...existing.plain, status: 'pending', nextAt: 0, deps: e.deps ?? [] }, value: { payload: e.payload } satisfies OpBody }
          : this.newOpChange(e)
      );
    }
    await this.store.commit([...changes, ...extra]);
    await this.refreshCounts();
  }

  /** Thay đổi thêm một mục mới, để ghi cùng giao dịch với việc khác (ví dụ trong `promote`). */
  newOpChange(e: NewOp): Change {
    const now = this.clock.now();
    const meta: OpMeta = { seq: this.nextSeq(), kind: e.kind, status: 'pending', deps: e.deps ?? [], day: vnDay(new Date(now)), createdAt: now, attempts: 0, nextAt: 0 };
    return { table: 'ops', id: e.id, plain: meta, value: { payload: e.payload } satisfies OpBody };
  }

  /** Giao diện vừa gọi máy chủ (ngoài hàng đợi): có phản hồi thì đang có mạng, lỗi mạng thì không. Có mạng lại thì gửi ngay. */
  observe(reachable: boolean): void {
    if (reachable === this.current.online) return;
    this.emit({ online: reachable });
    if (reachable) void this.syncNow();
  }

  /** Gửi ngay một mục vừa lưu (thao tác lúc có mạng) và cho biết kết quả. Lỗi mạng thì `promote` chuyển nó sang dạng ngoại tuyến. */
  async submit(id: string, promote?: Promote): Promise<Outcome> {
    this.focus.set(id, promote);
    await this.run();
    return this.outcome(id);
  }

  /** Bác sĩ đã xác nhận các phát hiện máy chủ trả về (422): gửi lại cùng `clientUuid` kèm lý do (OFF-7). */
  async acknowledge(id: string, acks: Array<{ key: string; reason: string }>): Promise<void> {
    const op = await this.store.get<'ops', OpBody<'complete'>>('ops', id);
    if (!op || op.plain.kind !== 'complete' || op.plain.status !== 'rules') throw new Error('Mục này không chờ xác nhận');
    const p = op.value.payload;
    const prev = p.body.prescription?.acknowledgements ?? [];
    const merged = [...prev.filter((a) => !acks.some((b) => b.key === a.key)), ...acks];
    const payload: Payloads['complete'] = { ...p, body: { ...p.body, ...(p.body.prescription ? { prescription: { ...p.body.prescription, acknowledgements: merged } } : {}) } };
    await this.store.commit([{ table: 'ops', id, plain: { ...op.plain, status: 'pending', nextAt: 0 }, value: { payload } satisfies OpBody<'complete'> }]);
    await this.refreshCounts();
    await this.run();
  }

  /**
   * Bỏ một mục vừa bị máy chủ từ chối khi gửi ngay lúc có mạng: dữ liệu vẫn còn trên màn hình (biểu mẫu, bản nháp) nên người dùng
   * sửa rồi gửi lại như trước M0-S3. Chỉ bỏ được mục đang cần xử lý và không có mục nào phụ thuộc vào nó.
   */
  async discard(id: string): Promise<void> {
    const ops = await this.ops();
    const op = ops.find((o) => o.id === id);
    if (!op) return;
    if (!ATTENTION.has(op.meta.status)) throw new Error('Chỉ bỏ được mục máy chủ đã từ chối');
    if (ops.some((o) => o.meta.deps.includes(id))) throw new Error('Có mục khác phụ thuộc vào mục này');
    await this.store.commit([{ table: 'ops', id, delete: true }]);
    await this.refreshCounts();
  }

  /** Chạy một lượt gửi. Gọi nhiều lần khi đang chạy thì gộp thành một lượt chạy tiếp theo. */
  run(): Promise<void> {
    if (this.queued) return this.queued;
    const next = this.chain.then(async () => {
      this.queued = undefined;
      if (this.stopped) return;
      try {
        await this.locks.request(this.lockName, () => this.runOnce());
      } catch {
        // Kho lỗi giữa chừng (ví dụ quá hạn): mục nào chưa đánh dấu xong vẫn nằm trong kho; hẹn lần chạy sau, không bỏ cuộc.
        this.emit({ sending: undefined });
        if (!this.stopped) {
          this.clock.clearTimeout(this.timer);
          this.timer = this.clock.setTimeout(() => void this.run(), this.baseMs);
        }
      }
    });
    this.queued = next;
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Chờ mọi lần chạy đang chạy hoặc đã hẹn xong (kiểm thử dùng sau khi cho thời gian ảo trôi). */
  async idle(): Promise<void> {
    while (this.queued) await this.queued.catch(() => undefined);
    await this.chain;
  }

  private async refreshCounts(ops?: AnyOp[]): Promise<AnyOp[]> {
    const all = ops ?? (await this.ops());
    const byId = new Map(all.map((o) => [o.id, o]));
    const pending = all.filter((o) => o.meta.status !== 'done');
    const attention = pending.filter((o) => ATTENTION.has(o.meta.status) || depState(o, byId).kind === 'held').length;
    // Sau khi tải lại trang: lần gửi thành công cuối lấy từ mục đã xong còn trong kho (mục đã xong của ngày cũ bị dọn khi mở ứng dụng).
    const last = this.current.lastSyncAt ?? all.reduce((max, o) => (o.meta.status === 'done' ? Math.max(max, o.updatedAt) : max), 0);
    this.emit({ counted: true, pending: pending.length, attention, ...(last ? { lastSyncAt: last } : {}) }, true);
    return all;
  }

  private backoff(attempts: number): number {
    return Math.min(this.capMs, this.baseMs * 2 ** Math.max(0, attempts - 1));
  }

  private async runOnce(): Promise<void> {
    const force = this.force;
    this.force = false;
    this.clock.clearTimeout(this.timer);
    let ops = await this.ops();
    const s = this.session();
    // Chỉ gửi bằng phiên của chính chủ kho (OFF-6, OFF-7): phiên của người khác thì dừng, không gửi gì.
    if (!s || s.tenant !== this.owner.tenant || s.userId !== this.owner.userId) {
      this.emit({ paused: 'owner' });
      await this.settleFocus(ops, false);
      return;
    }
    // Hết phiên (401): chờ đăng nhập lại (token mới) rồi mới gửi tiếp; không đụng tới mục nào trong lúc chờ.
    if (this.current.paused === 'unauthorized' && s.token === this.expiredToken) {
      await this.settleFocus(ops, false);
      return;
    }
    if (this.current.paused) this.emit({ paused: false });
    let networkDown = !this.isOnline();
    if (networkDown) this.emit({ online: false });

    const ids = await this.store.ids();
    const byId = new Map(ops.map((o) => [o.id, o]));
    const now = this.clock.now();
    const day = vnDay(new Date(now));
    // Nhiều lượt quét theo thứ tự hàng đợi: mục xong ở lượt này mở đường cho mục phụ thuộc nó ở lượt sau.
    // Mỗi mục được thử nhiều nhất một lần trong một lần chạy (lỗi tạm thì chờ hết thời gian chờ).
    const tried = new Set<string>();
    let stop = networkDown;
    for (let progress = true; progress && !stop; ) {
      progress = false;
      for (const op of [...byId.values()].sort((a, b) => a.meta.seq - b.meta.seq)) {
        if (tried.has(op.id) || op.meta.status === 'done' || ATTENTION.has(op.meta.status)) continue;
        if (!force && !this.focus.has(op.id) && op.meta.nextAt > now) continue;
        if (depState(op, byId).kind !== 'ready') continue;
        const payload = resolveIds(op, ids);
        if (!payload) continue;
        tried.add(op.id);

        this.emit({ sending: op.id });
        let result: unknown;
        let failure: ReturnType<typeof classify> | undefined;
        try {
          result = await send(op.meta.kind, payload, s.token);
        } catch (err) {
          failure = classify(err);
        }
        this.emit({ sending: undefined });

        if (!failure) {
          const effects = await effectsOf(op, payload, result as never, { store: this.store, ids, day });
          const done: OpBody = { payload: op.body.payload, result: result as never };
          await this.store.commit([{ table: 'ops', id: op.id, plain: { ...op.meta, status: 'done', nextAt: 0 }, value: done }, ...effects]);
          for (const c of effects) if (c.table === 'ids' && !('delete' in c)) ids.set(c.id, c.serverId);
          this.update(byId, op, 'done', done);
          this.emit({ online: true, lastSyncAt: this.clock.now() });
          progress = true;
          continue;
        }
        const { verdict, error } = failure;
        if (verdict === 'paused') {
          // Phiên hết hạn: không đụng tới mục nào, chờ đăng nhập lại (OFF-6).
          this.expiredToken = s.token;
          this.emit({ paused: 'unauthorized' });
          stop = true;
          break;
        }
        if (verdict === 'network' || verdict === 'retry') {
          const attempts = op.meta.attempts + 1;
          const meta: OpMeta = { ...op.meta, status: 'retry', attempts, nextAt: this.clock.now() + this.backoff(attempts) };
          const body: OpBody = { ...op.body, error };
          await this.store.commit([{ table: 'ops', id: op.id, plain: meta, value: body }]);
          byId.set(op.id, { ...op, meta, body } as AnyOp);
          if (verdict === 'network') {
            // Mất mạng: các mục sau cũng sẽ lỗi; dừng lần chạy này, chờ sự kiện `online` hoặc hết thời gian chờ.
            networkDown = stop = true;
            this.emit({ online: false });
            break;
          }
          this.emit({ online: true });
          continue;
        }
        // 409, 422, lỗi khác: giữ nguyên mục, đánh dấu cần xử lý (không gửi lại, không ghi đè, không bỏ).
        const body: OpBody = { ...op.body, error };
        await this.store.commit([{ table: 'ops', id: op.id, plain: { ...op.meta, status: verdict, nextAt: 0 }, value: body }]);
        this.update(byId, op, verdict, body);
        this.emit({ online: true });
      }
    }
    ops = [...byId.values()].sort((a, b) => a.meta.seq - b.meta.seq);
    await this.settleFocus(ops, networkDown);
    ops = await this.refreshCounts();
    this.schedule(ops, !this.isOnline());
  }

  private update(byId: Map<string, AnyOp>, op: AnyOp, status: OpStatus, body: OpBody): void {
    byId.set(op.id, { ...op, meta: { ...op.meta, status, nextAt: 0 }, body } as AnyOp);
  }

  /** Mục gửi ngay mà chưa tới được máy chủ vì mất mạng: chuyển sang dạng ngoại tuyến ngay trong lúc giữ khóa (không tab nào kịp gửi bản cũ). */
  private async settleFocus(ops: AnyOp[], networkDown: boolean): Promise<void> {
    if (!networkDown) return;
    for (const [id, promote] of this.focus) {
      const op = ops.find((o) => o.id === id);
      if (!promote || !op || op.meta.status === 'done' || ATTENTION.has(op.meta.status)) continue;
      const next = await promote(op.body.payload);
      await this.store.commit([{ table: 'ops', id, plain: op.meta, value: { ...op.body, payload: next.payload } }, ...(next.changes ?? [])]);
      this.focus.set(id, undefined);
      this.promoted.add(id);
    }
  }

  private async outcome(id: string): Promise<Outcome> {
    const promoted = this.promoted.delete(id);
    this.focus.delete(id);
    const ops = await this.ops();
    const op = ops.find((o) => o.id === id) as Op | undefined;
    if (!op) return { kind: 'rejected', status: 'error', error: { status: -1, code: 'missing', message: 'Mục không còn trong hàng đợi' } };
    if (op.meta.status === 'done') return { kind: 'done', result: op.body.result };
    if (ATTENTION.has(op.meta.status)) return { kind: 'rejected', status: op.meta.status as 'conflict' | 'rules' | 'error', error: op.body.error! };
    const dep = depState(op as AnyOp, new Map(ops.map((o) => [o.id, o])));
    if (dep.kind === 'held') return { kind: 'held', by: dep.by };
    if (this.current.paused) return { kind: 'paused' };
    if (promoted || !this.current.online) return { kind: 'offline' };
    if (op.body.error && op.body.error.status !== 0) return { kind: 'retrying', error: op.body.error };
    return { kind: 'waiting' };
  }

  /**
   * Hẹn lượt sau: lúc mục thử lại sớm nhất hết thời gian chờ, và tối đa sau `periodMs` khi còn mục chưa xong.
   * Trình duyệt báo mất mạng thì chỉ hẹn theo chu kỳ (sự kiện `online` sẽ đánh thức sớm hơn).
   */
  private schedule(ops: AnyOp[], browserOffline: boolean): void {
    if (this.stopped || this.current.paused) return;
    this.clock.clearTimeout(this.timer);
    const open = ops.filter((o) => o.meta.status === 'pending' || o.meta.status === 'retry');
    if (open.length === 0) return;
    const now = this.clock.now();
    const later = browserOffline ? [] : open.map((o) => o.meta.nextAt).filter((t) => t > now);
    const soonest = Math.min(...later, now + this.periodMs);
    this.timer = this.clock.setTimeout(() => void this.run(), soonest - now);
  }
}
