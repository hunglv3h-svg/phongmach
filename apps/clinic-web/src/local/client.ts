// Các luồng làm được khi mất mạng (kế hoạch, N1, N4, OFF-2 đến OFF-4), dùng chung cho lúc có mạng: mọi thao tác ghi trong phạm vi
// ngoại tuyến đi qua hàng đợi trên máy rồi mới gửi. Có mạng thì gửi ngay và trả kết quả của máy chủ như trước M0-S3;
// mất mạng (hoặc gửi ngay mà mất mạng) thì làm tiếp bằng dữ liệu trên máy và để bộ máy đồng bộ gửi sau.
// Không phụ thuộc React để kiểm thử được bằng IndexedDB giả.
import { localPrescriptionDetail, vnDay, type AckView, type AllergyView, type PrescriptionDetail, type QueueItem, type QueuePriority, type Specialty, type VisitContext } from '@phongmach/clinical';
import { buildPatient, normalizeCccd, toPatientSummary, type PatientSummary } from '@phongmach/fhir-vn-model';
import { ApiError, api, type AuthState, type CompleteRequest, type CompleteResponse, type NewPatient, type RulesRejected } from '../api';
import { localPrescriptionCode, printLocal } from '../print';
import { parseNum, toCompleteRequest, toLineInput, type Draft } from '../visit/draft';
import { adoptedVisits, mergeQueue, nextLocalNumber, searchLocal, type CachedPatient, type LocalQueueItem, type QueueSnapshot, type SignedOffline } from './cache';
import { isTmp, newTmpId, type AnyOp, type NewOp, type Op, type OpDisplay, type Payloads } from './ops';
import type { Change, LocalStore } from './store';
import type { Outcome, SyncEngine } from './sync';
import type { SyncData } from './syncList';

export interface OfflineClientOptions {
  store: LocalStore;
  engine: SyncEngine;
  auth: () => AuthState;
  now?: () => number;
  /** In đơn từ dữ liệu trên máy (tiêm vào được để kiểm thử thứ tự "lưu bền rồi mới in"). */
  printLocal?: (detail: PrescriptionDetail, clinicName: string, pendingSync: boolean) => Promise<void>;
}

/** Hồ sơ vừa mở để khám. */
export interface Opened {
  context: VisitContext;
  /** Lúc mở theo đồng hồ của máy này (OFF-3). */
  openedAt: string;
  offline: boolean;
  /** false: máy không có dữ liệu dị ứng của bệnh nhân này, phải xác nhận `allergy-unknown`. */
  allergiesKnown: boolean;
  /** false: tiền sử và lịch sử khám chưa có trên máy ("chưa tải"). */
  historyLoaded: boolean;
}

export type SignOutcome =
  /** Máy chủ đã nhận (có mạng): như trước M0-S3. */
  | { kind: 'online'; response: CompleteResponse; detail?: PrescriptionDetail }
  /** Ký khi mất mạng: đã lưu bền trên máy rồi mới in từ dữ liệu trên máy; chờ đồng bộ. */
  | { kind: 'offline'; opId: string; detail?: PrescriptionDetail; printError?: string }
  /** Máy chủ kiểm tra lại và không cho ký (có mạng): hiện tại chỗ, bản nháp còn nguyên. */
  | { kind: 'rules'; rejected: RulesRejected }
  | { kind: 'failed'; message: string };

/** Lỗi do máy chủ từ chối một thao tác gửi ngay lúc có mạng (mục đã được bỏ khỏi hàng đợi, dữ liệu còn trên màn hình). */
export class RejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'RejectedError';
  }
}

const NEED_NETWORK = 'Cần mạng';
/** Hai lần tải hàng chờ gần nhau hơn mức này dùng chung một lần (màn hàng chờ tự tải lại mỗi 5 giây). */
const REFRESH_GAP_MS = 4000;
const iso = (t: number) => new Date(t).toISOString();

export class OfflineClient {
  readonly store: LocalStore;
  readonly engine: SyncEngine;
  readonly auth: () => AuthState;
  private readonly now: () => number;
  private readonly print: NonNullable<OfflineClientOptions['printLocal']>;
  private lastRefresh: { at: number; promise: Promise<{ day: string; items: QueueItem[] } | undefined> } | undefined;
  private prefetching: Promise<number> | undefined;

  constructor(opts: OfflineClientOptions) {
    this.store = opts.store;
    this.engine = opts.engine;
    this.auth = opts.auth;
    this.now = opts.now ?? (() => Date.now());
    this.print = opts.printLocal ?? printLocal;
  }

  /** Theo trình duyệt và lần gửi gần nhất. Mất mạng thì giao diện đi đường ngoại tuyến (không thử gọi máy chủ). */
  get online(): boolean {
    return this.engine.state.online && globalThis.navigator?.onLine !== false;
  }

  clinicName(): string {
    return this.auth().tenant.name;
  }

  today(): string {
    return vnDay(new Date(this.now()));
  }

  /** Khởi động: dọn bộ đệm ngày cũ, ghi tên nhân viên cho màn hình đăng nhập, gửi những gì còn lại. */
  async start(): Promise<void> {
    await this.store.purgeBefore(this.today()).catch(() => undefined);
    await this.store.setOwnerName(this.auth().user.name).catch(() => undefined);
    await this.engine.start();
  }

  /** Gọi máy chủ ngoài hàng đợi (đọc): báo cho bộ máy biết có mạng hay không. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.engine.observe(true);
      return r;
    } catch (e) {
      if (e instanceof ApiError) this.engine.observe(e.status !== 0);
      throw e;
    }
  }

  // ----------------------------------------------------------------------------------------- id và bộ đệm

  /** Mọi id của cùng một bản ghi: id đang dùng, id máy chủ của nó, các id tạm trỏ về nó. */
  async aliases(id: string): Promise<string[]> {
    const ids = await this.store.ids();
    const server = ids.get(id) ?? id;
    return [...new Set([id, server, ...[...ids].filter(([, s]) => s === server).map(([tmp]) => tmp)])];
  }

  /** id máy chủ nếu đã có (id tạm đã đồng bộ), không thì undefined. */
  async serverId(id: string): Promise<string | undefined> {
    return isTmp(id) ? (await this.store.ids()).get(id) : id;
  }

  async cachedPatient(id: string): Promise<CachedPatient | undefined> {
    for (const alias of await this.aliases(id)) {
      const row = await this.store.get<'patients', CachedPatient>('patients', alias);
      if (row) return row.value;
    }
    return undefined;
  }

  /** Hồ sơ mở ở Tiếp đón lúc có mạng (OFF-4 b): giữ tóm tắt và dị ứng cho lúc mất mạng. */
  async cachePatient(patient: PatientSummary, allergies?: AllergyView[]): Promise<void> {
    const prev = await this.store.get<'patients', CachedPatient>('patients', patient.id);
    const value: CachedPatient = { ...prev?.value, patient, ...(allergies ? { allergies } : {}) };
    await this.store.commit([{ table: 'patients', id: patient.id, plain: { day: this.today() }, value }]);
  }

  /** Tìm trong bộ đệm (mất mạng). `total`: số hồ sơ trên máy, để ghi "chỉ tìm trong N hồ sơ trên máy này". */
  async searchCache(query: string): Promise<{ results: PatientSummary[]; total: number }> {
    const entries = (await this.store.list<'patients', CachedPatient>('patients')).map((r) => r.value);
    return { results: searchLocal(query, entries), total: entries.length };
  }

  // ------------------------------------------------------------------------------------------- hàng chờ

  /**
   * Giữ ảnh chụp hàng chờ của máy chủ. Nếu trong đó có lượt khám của một mục cấp số còn chưa xong trên máy (yêu cầu tới được
   * máy chủ nhưng phản hồi không về; nhận ra theo `clientUuid`) thì ghi luôn ánh xạ id tạm → id máy chủ trong CÙNG giao dịch:
   * từ lúc dòng của máy chủ hiện ra, mọi chỗ tra bí danh (bản nháp, mục mở hồ sơ, mục phụ thuộc) đã coi hai id là một lượt.
   * Mục cấp số vẫn nằm trong hàng đợi và vẫn được gửi lại cùng `clientUuid`; ánh xạ này chính là cái nó sẽ ghi khi xong.
   */
  async saveSnapshot(day: string, items: QueueItem[]): Promise<void> {
    const value: QueueSnapshot = { day, items, fetchedAt: iso(this.now()) };
    const changes: Change[] = [{ table: 'snapshots', id: day, plain: { day }, value }];
    // Không còn mục nào chưa xong thì không có gì để khớp: khỏi giải mã hàng đợi ở mỗi lần tải hàng chờ (đếm theo kho, tính cả tab khác).
    if ((await this.store.pendingCount()) > 0) {
      const adopted = adoptedVisits(items, await this.engine.ops());
      const ids = adopted.size ? await this.store.ids() : undefined;
      for (const [localId, serverId] of adopted) {
        if (ids?.get(localId) !== serverId) changes.push({ table: 'ids', id: localId, serverId, day: this.today() });
      }
    }
    await this.store.commit(changes);
  }

  async snapshot(): Promise<QueueSnapshot | undefined> {
    return (await this.store.get<'snapshots', QueueSnapshot>('snapshots', this.today()))?.value;
  }

  /** Hàng chờ hôm nay trên máy này: của máy chủ (vừa tải hoặc ảnh chụp gần nhất) gộp với thao tác chưa đồng bộ. */
  async localQueue(serverItems?: QueueItem[]): Promise<LocalQueueItem[]> {
    const day = this.today();
    const items = serverItems ?? (await this.snapshot())?.items ?? [];
    const ops = (await this.engine.ops()).filter((o) => o.meta.day === day);
    const { user } = this.auth();
    return mergeQueue(items, ops, await this.store.ids(), { id: user.id, name: user.name });
  }

  /**
   * Dữ liệu cho danh sách chờ đồng bộ và thông báo: hàng đợi, ánh xạ id, hàng chờ trên máy và đơn đã ký khi mất mạng.
   * Chỉ đọc kho trên máy và giải mã trong bộ nhớ: không gọi máy chủ, không ghi gì.
   */
  async syncData(): Promise<SyncData> {
    const day = this.today();
    const ops = await this.engine.ops();
    const ids = await this.store.ids();
    const snapshot = (await this.snapshot())?.items ?? [];
    const { user } = this.auth();
    const queue = mergeQueue(snapshot, ops.filter((o) => o.meta.day === day), ids, { id: user.id, name: user.name });
    const signed = new Map((await this.store.list<'signed', SignedOffline>('signed')).map((r) => [r.id, r.value]));
    return { ops, ids, queue, signed };
  }

  /** Nạp trước (OFF-4 a): tóm tắt và dị ứng của người mới vào hàng chờ mà máy chưa có. Lần gọi trùng lúc dùng chung một lần nạp. */
  prefetch(items: QueueItem[]): Promise<number> {
    if (!this.online) return Promise.resolve(0);
    const run = (this.prefetching ?? Promise.resolve(0)).then(() => this.prefetchNow(items));
    const mine = run.finally(() => {
      if (this.prefetching === mine) this.prefetching = undefined;
    });
    this.prefetching = mine;
    return mine;
  }

  private async prefetchNow(items: QueueItem[]): Promise<number> {
    const active = [...new Set(items.filter((i) => i.status === 'waiting' || i.status === 'in-exam').map((i) => i.patientId))];
    const missing: string[] = [];
    for (const id of active) if ((await this.cachedPatient(id))?.allergies === undefined) missing.push(id);
    let fetched = 0;
    // Chuỗi truy vấn của BFF tối đa 4000 ký tự: tối đa 90 id (36 ký tự + dấu phẩy) mỗi lần.
    for (let i = 0; i < missing.length; i += 90) {
      const { patients } = await this.call(() => api.prefetch(this.auth().token, missing.slice(i, i + 90)));
      const changes: Change[] = [];
      for (const qp of patients) {
        const prev = await this.store.get<'patients', CachedPatient>('patients', qp.patient.id);
        changes.push({ table: 'patients', id: qp.patient.id, plain: { day: this.today() }, value: { ...prev?.value, patient: qp.patient, allergies: qp.allergies } satisfies CachedPatient });
      }
      await this.store.commit(changes);
      fetched += patients.length;
    }
    return fetched;
  }

  /**
   * Tải hàng chờ từ máy chủ, giữ ảnh chụp và nạp trước người mới. Lỗi mạng thì trả undefined.
   * Mỗi lần tải là một dòng nhật ký truy cập: các lần gọi cách nhau dưới `minGapMs` (màn hàng chờ, nạp trước định kỳ,
   * React chạy hiệu ứng hai lần) dùng chung một lần tải.
   */
  refreshQueue(signal?: AbortSignal, minGapMs = REFRESH_GAP_MS): Promise<{ day: string; items: QueueItem[] } | undefined> {
    const last = this.lastRefresh;
    if (last && this.now() - last.at < minGapMs) return last.promise;
    const entry: NonNullable<typeof this.lastRefresh> = { at: this.now(), promise: Promise.resolve(undefined) };
    entry.promise = (async () => {
      try {
        const r = await this.call(() => api.queue(this.auth().token, signal));
        await this.saveSnapshot(r.day, r.items);
        void this.prefetch(r.items).catch(() => undefined);
        return r;
      } catch (e) {
        // Lỗi thì không giữ lại: lần gọi sau thử tải lại ngay.
        if (this.lastRefresh === entry) this.lastRefresh = undefined;
        if (e instanceof ApiError && e.status === 0) return undefined;
        throw e;
      }
    })();
    this.lastRefresh = entry;
    return entry.promise;
  }

  private async opsFor(visitId: string): Promise<{ ops: AnyOp[]; aliases: string[] }> {
    const aliases = await this.aliases(visitId);
    const ops = (await this.engine.ops()).filter((o) => {
      if (o.meta.kind === 'checkin') return aliases.includes((o as Op<'checkin'>).body.payload.visitTmpId ?? '');
      if (o.meta.kind === 'open' || o.meta.kind === 'complete') return aliases.includes((o as Op<'open'>).body.payload.visitId);
      return false;
    });
    return { ops, aliases };
  }

  /** Mục chưa xong mà một thao tác mới trên lượt khám này phải chờ (cấp số lúc mất mạng, mở hồ sơ lúc mất mạng). */
  private async visitDeps(visitId: string, kinds: Array<AnyOp['meta']['kind']> = ['checkin', 'open']): Promise<string[]> {
    return (await this.opsFor(visitId)).ops.filter((o) => o.meta.status !== 'done' && kinds.includes(o.meta.kind)).map((o) => o.id);
  }

  // ------------------------------------------------------------------------------------------- tiếp đón

  /**
   * Tạo bệnh nhân. Có mạng: gửi ngay, trả bệnh nhân của máy chủ. Mất mạng: trả bản trên máy với id tạm, giữ trong bộ đệm
   * (kèm CCCD đầy đủ để tìm được khi mất mạng). Máy chủ từ chối khi gửi ngay: ném `RejectedError` (biểu mẫu còn nguyên).
   */
  async createPatient(input: NewPatient): Promise<{ patient: PatientSummary; created: boolean; tentative: boolean }> {
    const tmpId = newTmpId();
    const local: PatientSummary = { ...toPatientSummary(buildPatient(input)), id: tmpId };
    const cccd = input.cccd ? normalizeCccd(input.cccd) : undefined;
    const cache: Change = { table: 'patients', id: tmpId, plain: { day: this.today() }, value: { patient: local, ...(cccd ? { cccd } : {}) } satisfies CachedPatient };
    const op: NewOp = { id: input.clientUuid, kind: 'patient', payload: { tmpId, input } };
    await this.engine.enqueue([op], [cache]);
    if (!this.online) {
      void this.engine.run();
      return { patient: local, created: true, tentative: true };
    }
    const out = await this.engine.submit(op.id);
    if (out.kind === 'done') {
      const r = out.result as { patient: PatientSummary; created: boolean };
      return { patient: r.patient, created: r.created, tentative: false };
    }
    if (out.kind === 'rejected') {
      await this.engine.discard(op.id);
      await this.store.commit([{ table: 'patients', id: tmpId, delete: true }]);
      throw new RejectedError(out.error.message, out.error.status, out.error.code);
    }
    return { patient: local, created: true, tentative: true };
  }

  /**
   * Cấp số. Mất mạng (OFF-2): số tạm = số lớn nhất máy này biết + 1, gửi kèm giờ đến và số tạm; máy chủ cố giữ số đó.
   * `clientUuid`: một UUID cho mỗi lần bấm "Cấp số" (bấm đúp không cấp hai số).
   */
  async checkIn(
    patient: PatientSummary,
    sel: { clientUuid: string; specialty: Specialty; priority: QueuePriority; reason?: string }
  ): Promise<{ item: LocalQueueItem; created: boolean; tentative: boolean }> {
    const clickAt = iso(this.now());
    const visitTmpId = newTmpId();
    const deps = (await this.engine.ops()).filter((o) => o.meta.kind === 'patient' && o.meta.status !== 'done' && (o as Op<'patient'>).body.payload.tmpId === patient.id).map((o) => o.id);
    const body = { clientUuid: sel.clientUuid, patientId: patient.id, specialty: sel.specialty, priority: sel.priority, ...(sel.reason ? { reason: sel.reason } : {}) };
    const display = { patientName: patient.fullName, ...(patient.birthDate ? { birthDate: patient.birthDate } : {}) };
    // Yêu cầu tới được máy chủ nhưng phản hồi không về, và hàng chờ của máy chủ đã về trước: lượt này đã có dòng của máy chủ
    // (nhận ra theo clientUuid, xem `saveSnapshot`). Số của dòng đó là số thật, không đề xuất số khác.
    const adopted = (queue: LocalQueueItem[]) => queue.find((i) => i.clientUuid === sel.clientUuid.toLowerCase());
    const offlinePayload = async (): Promise<Payloads['checkin']> => {
      const queue = await this.localQueue();
      return { visitTmpId, display, body: { ...body, arrivedAt: clickAt, proposedNumber: adopted(queue)?.number ?? nextLocalNumber(queue) } };
    };
    const tentative = async () => {
      const queue = await this.localQueue();
      const item = adopted(queue) ?? queue.find((i) => i.id === visitTmpId);
      if (!item) throw new Error('Không thấy lượt vừa cấp trong hàng chờ trên máy');
      return { item, created: true, tentative: true };
    };

    if (!this.online) {
      await this.engine.enqueue([{ id: sel.clientUuid, kind: 'checkin', deps, payload: await offlinePayload() }]);
      void this.engine.run();
      return tentative();
    }
    await this.engine.enqueue([{ id: sel.clientUuid, kind: 'checkin', deps, payload: { visitTmpId, display, body } }]);
    const out = await this.engine.submit(sel.clientUuid, async () => ({ payload: await offlinePayload() }));
    if (out.kind === 'done') {
      const r = out.result as { item: QueueItem; created: boolean };
      return { item: r.item, created: r.created, tentative: false };
    }
    if (out.kind === 'rejected') {
      await this.engine.discard(sel.clientUuid);
      throw new RejectedError(out.error.message, out.error.status, out.error.code);
    }
    if (out.kind !== 'offline') {
      // Máy chủ lỗi tạm hoặc mục trước chưa xong: vẫn giữ trên máy, cấp số tạm như khi mất mạng (cùng UUID, máy chủ không cấp trùng).
      await this.engine.enqueue([{ id: sel.clientUuid, kind: 'checkin', deps, payload: await offlinePayload() }]);
    }
    return tentative();
  }

  // ------------------------------------------------------------------------------------------------ khám

  /** Gọi vào khám / tiếp tục khám. Mất mạng: mở bằng dữ liệu trên máy, ghi mục mở hồ sơ kèm giờ máy này. */
  async openVisit(item: LocalQueueItem): Promise<Opened> {
    const clickAt = iso(this.now());
    const { ops } = await this.opsFor(item.id);
    const pendingOpen = ops.find((o) => o.meta.kind === 'open' && o.meta.status !== 'done') as Op<'open'> | undefined;
    const deps = ops.filter((o) => o.meta.kind === 'checkin' && o.meta.status !== 'done').map((o) => o.id);
    const display: OpDisplay = { patientName: item.patientName, number: item.number };

    if (this.online && !pendingOpen) {
      const op: NewOp = { id: crypto.randomUUID(), kind: 'open', deps, payload: { visitId: item.id, display } };
      await this.engine.enqueue([op]);
      const out: Outcome = await this.engine.submit(op.id, (p) => ({ payload: { ...(p as Payloads['open']), openedAt: clickAt } }));
      if (out.kind === 'done') {
        // Mở có mạng: mốc mở lấy lúc nhận phản hồi (OFF-3), máy chủ đo bằng giờ của nó.
        return { context: out.result as VisitContext, openedAt: iso(this.now()), offline: false, allergiesKnown: true, historyLoaded: true };
      }
      if (out.kind === 'rejected') {
        await this.engine.discard(op.id);
        throw new RejectedError(out.error.message, out.error.status, out.error.code);
      }
      if (out.kind !== 'offline') await this.engine.enqueue([{ ...op, payload: { visitId: item.id, openedAt: clickAt, display } }]);
      return this.offlineOpen(item, clickAt);
    }
    if (pendingOpen) return this.offlineOpen(item, pendingOpen.body.payload.openedAt ?? clickAt);
    await this.engine.enqueue([{ id: crypto.randomUUID(), kind: 'open', deps, payload: { visitId: item.id, openedAt: clickAt, display } }]);
    void this.engine.run();
    return this.offlineOpen(item, clickAt);
  }

  private async offlineOpen(item: LocalQueueItem, openedAt: string): Promise<Opened> {
    const cached = await this.cachedPatient(item.patientId);
    const { user } = this.auth();
    const patient: PatientSummary = cached?.patient ?? { id: item.patientId, fullName: item.patientName, ...(item.birthDate ? { birthDate: item.birthDate } : {}) };
    const context: VisitContext = {
      visit: { ...item, status: 'in-exam', doctorUserId: user.id, doctorName: user.name, calledAt: item.calledAt ?? openedAt },
      patient,
      allergies: cached?.allergies ?? [],
      history: cached?.history ?? [],
      previous: cached?.previous ?? [],
    };
    return { context, openedAt, offline: true, allergiesKnown: cached?.allergies !== undefined, historyLoaded: cached?.history !== undefined };
  }

  /** Bản nháp mới nhất của lượt khám (có thể nằm dưới id tạm nếu mở lúc mất mạng rồi đã đồng bộ). */
  async latestDraft(visitId: string): Promise<Draft | undefined> {
    return (await this.store.latestDraft(await this.aliases(visitId)))?.draft;
  }

  /**
   * Ký đơn hoặc kết thúc khám.
   * - Mất mạng: dựng đơn từ dữ liệu trên máy (mã đơn theo giờ ký của máy này), ghi mục hoàn tất, mục ghi nhận in, đơn để in lại
   *   và xóa bản nháp trong CÙNG MỘT giao dịch, rồi mới in. Ghi lỗi thì không in (N1).
   * - Có mạng: gửi ngay; bị từ chối thì hiện tại chỗ như trước (bản nháp còn); gửi mà mất mạng thì chuyển sang ký khi mất mạng.
   */
  async complete(input: { visit: QueueItem; patient: PatientSummary; draft: Draft; withRx: boolean; allergiesKnown: boolean; acks: AckView[] }): Promise<SignOutcome> {
    const { visit, patient, draft, withRx, allergiesKnown, acks } = input;
    const { user, tenant } = this.auth();
    const signedAt = iso(this.now());
    const opId = draft.clientUuid;
    const base: CompleteRequest = toCompleteRequest(draft, withRx);
    const unknown = withRx && !allergiesKnown ? { allergiesUnknown: true } : {};
    const clientTimes = { openedAt: draft.openedAt ?? signedAt, signedAt };
    const deps = await this.visitDeps(visit.id);
    const display: OpDisplay = { patientName: patient.fullName, number: visit.number };

    const offlinePart = async () => {
      const rxTmpId = withRx ? newTmpId() : undefined;
      const followUp = parseNum(draft.followUpDays);
      const detail = rxTmpId
        ? localPrescriptionDetail({
            id: rxTmpId,
            encounterId: visit.id,
            code: await localPrescriptionCode(opId, signedAt),
            signedAt,
            signerName: user.name,
            patient,
            diagnoses: draft.diagnoses,
            lines: draft.lines.map(toLineInput),
            advice: draft.advice,
            followUpDays: followUp !== undefined && !Number.isNaN(followUp) ? followUp : undefined,
            acknowledgements: acks,
          })
        : undefined;
      const changes: Change[] = (await this.aliases(visit.id)).map((id) => ({ table: 'drafts' as const, id, delete: true as const }));
      if (rxTmpId && detail) {
        changes.push({ table: 'signed', id: rxTmpId, plain: { day: this.today() }, value: { detail, clinicName: tenant.name, completeOpId: opId } satisfies SignedOffline });
        changes.push(this.engine.newOpChange({ id: crypto.randomUUID(), kind: 'printed', deps: [opId], payload: { prescriptionId: rxTmpId, printedAt: signedAt, display: { ...display, code: detail.prescription.code } } }));
      }
      const payload: Payloads['complete'] = {
        visitId: visit.id,
        ...(rxTmpId ? { rxTmpId } : {}),
        body: { ...base, ...unknown, clientTimes },
        display: { ...display, ...(detail ? { code: detail.prescription.code } : {}) },
      };
      return { payload, changes, detail };
    };
    const printOffline = async (detail: PrescriptionDetail | undefined): Promise<SignOutcome> => {
      void this.engine.run();
      const printError = detail ? await this.print(detail, tenant.name, true).then(() => undefined, (e: Error) => e.message) : undefined;
      return { kind: 'offline', opId, ...(detail ? { detail } : {}), ...(printError ? { printError } : {}) };
    };
    const notSaved: SignOutcome = { kind: 'failed', message: 'Không lưu được trên máy (bộ nhớ trình duyệt đầy hoặc bị chặn): CHƯA in. Bản nháp vẫn còn; giải phóng bộ nhớ rồi ký lại.' };

    if (!this.online) {
      const off = await offlinePart();
      try {
        await this.engine.enqueue([{ id: opId, kind: 'complete', deps, payload: off.payload }], off.changes);
      } catch {
        return notSaved;
      }
      return printOffline(off.detail);
    }

    const body: CompleteRequest = { ...base, ...unknown, ...(draft.openedOffline ? { clientTimes } : {}) };
    try {
      await this.engine.enqueue([{ id: opId, kind: 'complete', deps, payload: { visitId: visit.id, body, display } }]);
    } catch {
      return notSaved;
    }
    let promoted: Awaited<ReturnType<typeof offlinePart>> | undefined;
    const out = await this.engine.submit(opId, async () => {
      promoted = await offlinePart();
      return { payload: promoted.payload, changes: promoted.changes };
    });
    switch (out.kind) {
      case 'done': {
        const response = out.result as CompleteResponse;
        const detail = response.prescription ? { prescription: response.prescription, patient, diagnoses: response.visit.diagnoses, encounterId: visit.id } : undefined;
        return { kind: 'online', response, ...(detail ? { detail } : {}) };
      }
      case 'offline':
        if (promoted) return printOffline(promoted.detail);
        return { kind: 'failed', message: 'Mất kết nối. Đã giữ trên máy và sẽ tự gửi khi có mạng; đơn sẽ không bị lưu trùng.' };
      case 'rejected':
        await this.engine.discard(opId);
        if (out.status === 'rules') return { kind: 'rules', rejected: out.error.body as RulesRejected };
        return { kind: 'failed', message: out.error.message };
      case 'retrying':
        return { kind: 'failed', message: `${out.error.message} Đã giữ trên máy, máy sẽ tự gửi lại; đơn sẽ không bị lưu trùng.` };
      case 'held':
        return { kind: 'failed', message: 'Chưa gửi được: một thao tác trước đó của lượt khám này đang cần xử lý (xung đột hoặc lỗi). Bản khám được giữ trên máy.' };
      case 'paused':
        return { kind: 'failed', message: 'Phiên đã hết hạn: đăng nhập lại để đồng bộ. Bản khám được giữ trên máy.' };
      case 'waiting':
        return { kind: 'failed', message: 'Đang chờ thao tác trước đó của lượt khám này được máy chủ nhận. Đã giữ trên máy, máy sẽ tự gửi.' };
    }
  }

  /** In (lại) một đơn từ dữ liệu trên máy khi mất mạng: ghi mục ghi nhận in để máy chủ có dòng nhật ký khi có mạng (OFF-1). */
  async recordLocalPrint(prescriptionId: string, completeOpId?: string, display?: OpDisplay): Promise<void> {
    const ops = await this.engine.ops();
    const dep = completeOpId && ops.some((o) => o.id === completeOpId && o.meta.status !== 'done') ? [completeOpId] : [];
    await this.engine.enqueue([{ id: crypto.randomUUID(), kind: 'printed', deps: dep, payload: { prescriptionId, printedAt: iso(this.now()), ...(display ? { display } : {}) } }]);
    void this.engine.run();
  }

  /**
   * In lại một đơn đã ký khi mất mạng mà máy chủ chưa nhận (đang chờ, xung đột, chờ xác nhận): in từ bản giữ trên máy, có nhãn
   * "ký khi mất mạng", rồi ghi mục ghi nhận in (mục này chờ mục hoàn tất như mọi lần in ngoại tuyến).
   */
  async reprintSigned(rxTmpId: string): Promise<void> {
    const signed = await this.signedOffline(rxTmpId);
    if (!signed) throw new Error('Máy này không còn giữ bản đơn đó để in lại');
    await this.print(signed.detail, signed.clinicName, true);
    await this.recordLocalPrint(rxTmpId, signed.completeOpId, { patientName: signed.detail.patient.fullName, code: signed.detail.prescription.code });
  }

  /** Đơn ký khi mất mạng (để in lại) và mục hoàn tất của nó. */
  async signedOffline(rxTmpId: string): Promise<SignedOffline | undefined> {
    return (await this.store.get<'signed', SignedOffline>('signed', rxTmpId))?.value;
  }

  /** Mục hàng đợi theo id (đã giải mã), để màn hình theo dõi trạng thái đồng bộ của nó. */
  async op(id: string): Promise<AnyOp | undefined> {
    return (await this.engine.ops()).find((o) => o.id === id);
  }
}

export { NEED_NETWORK };
