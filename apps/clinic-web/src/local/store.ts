// Kho dữ liệu trên máy (kế hoạch, OFF-5): IndexedDB qua Dexie, mỗi bản ghi có dữ liệu bệnh nhân được mã hóa AES-GCM.
// Mỗi (phòng khám, người dùng) một CSDL riêng. Trường dạng rõ chỉ có id, trạng thái, thời điểm, loại thao tác, thứ tự và phụ thuộc:
// không có tên, số điện thoại, chẩn đoán hay thuốc.
import Dexie, { type Table } from 'dexie';
import type { Draft } from '../visit/draft';
import { newKey, seal, unseal, type Sealed } from './crypto';

export interface Owner {
  tenant: string;
  userId: string;
}

export const DB_PREFIX = 'phongmach:';

/** Tên CSDL: chỉ có mã phòng khám và mã người dùng (không phải dữ liệu bệnh nhân). */
export const dbName = (o: Owner): string => `${DB_PREFIX}${o.tenant}:${o.userId}`;

/** Loại thao tác trong hàng đợi đồng bộ (kế hoạch, N4 và OFF-7), theo thứ tự phụ thuộc. */
export type OpKind = 'patient' | 'checkin' | 'open' | 'complete' | 'printed';

/**
 * Trạng thái lưu bền của một mục (N3). "Đang gửi" chỉ có trong bộ nhớ của tab đang gửi: trình duyệt sập giữa chừng thì mục
 * vẫn là `pending`/`retry` và được gửi lại cùng `clientUuid`.
 * - `retry`: lỗi tạm (mạng, 5xx, 503, 429), tự gửi lại.
 * - `conflict` (409), `rules` (422 quy tắc kê đơn), `error` (lỗi khác): cần người xử lý, không tự gửi lại, không tự bỏ.
 */
export type OpStatus = 'pending' | 'retry' | 'conflict' | 'rules' | 'error' | 'done';

/** Phần dạng rõ của một mục hàng đợi: id (khóa), thứ tự, loại, trạng thái, phụ thuộc, thời điểm. */
export interface OpMeta {
  seq: number;
  kind: OpKind;
  status: OpStatus;
  /** id các mục phải xong trước mục này. */
  deps: string[];
  /** Ngày tạo theo giờ Việt Nam: mục đã xong của ngày cũ được dọn khi mở ứng dụng. */
  day: string;
  createdAt: number;
  attempts: number;
  /** Lần gửi lại sớm nhất (ms kể từ epoch); 0 là gửi được ngay. */
  nextAt: number;
}

/** Phần dạng rõ của bản ghi bộ đệm (bệnh nhân, hàng chờ, đơn ký khi mất mạng): ngày, để dọn bộ đệm ngày cũ. */
export interface DayMeta {
  day: string;
}

interface PlainOf {
  drafts: Record<string, never>;
  ops: OpMeta;
  patients: DayMeta;
  snapshots: DayMeta;
  signed: DayMeta;
}

/** Các bảng có dữ liệu mã hóa. */
export type SealedTable = keyof PlainOf;

export interface Stored<K extends SealedTable, T> {
  id: string;
  plain: PlainOf[K];
  value: T;
  updatedAt: number;
}

/** Một thay đổi trong `commit`: mọi thay đổi của một lần `commit` được ghi trong cùng một giao dịch (cùng xong hoặc cùng không). */
export type Change =
  | { [K in SealedTable]: { table: K; id: string; plain: PlainOf[K]; value: unknown } }[SealedTable]
  | { table: SealedTable; id: string; delete: true }
  /** Ánh xạ id tạm (tạo trên máy khi mất mạng) sang id máy chủ. Chỉ có id. */
  | { table: 'ids'; id: string; serverId: string; day: string };

const SEALED_TABLES: readonly SealedTable[] = ['drafts', 'ops', 'patients', 'snapshots', 'signed'];

type MetaRow = { k: 'key'; key: CryptoKey } | { k: 'owner'; userName: string };

interface SealedRow extends Sealed {
  id: string;
  updatedAt: number;
  [plain: string]: unknown;
}

interface IdRow {
  id: string;
  serverId: string;
  day: string;
}

class LocalDb extends Dexie {
  meta!: Table<MetaRow, string>;
  drafts!: Table<SealedRow, string>;
  ops!: Table<SealedRow, string>;
  ids!: Table<IdRow, string>;
  patients!: Table<SealedRow, string>;
  snapshots!: Table<SealedRow, string>;
  signed!: Table<SealedRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'k', drafts: 'id' });
    // M0-S3 lát 3b: hàng đợi đồng bộ, ánh xạ id tạm, bộ đệm bệnh nhân và hàng chờ, đơn ký khi mất mạng. Bản nháp của version 1 giữ nguyên.
    this.version(2).stores({ ops: 'id, seq, status, day', ids: 'id, day', patients: 'id, day', snapshots: 'id, day', signed: 'id, day' });
  }
}

export class LocalStoreError extends Error {
  constructor(
    readonly code: 'unsupported' | 'unreadable' | 'stalled',
    message: string
  ) {
    super(message);
    this.name = 'LocalStoreError';
  }
}

/** Kho trên máy của một người dùng: bản nháp, hàng đợi đồng bộ, bộ đệm cho lúc mất mạng. */
export interface LocalStore {
  /** false: trình duyệt không có IndexedDB/WebCrypto, mọi thứ chỉ nằm trong bộ nhớ của tab. */
  readonly persistent: boolean;
  getDraft(visitId: string): Promise<Draft | undefined>;
  /** Bản nháp mới nhất trong các id (id máy chủ và các id tạm của cùng một lượt khám). */
  latestDraft(visitIds: string[]): Promise<{ id: string; draft: Draft } | undefined>;
  putDraft(visitId: string, draft: Draft): Promise<void>;
  deleteDraft(visitId: string): Promise<void>;
  get<K extends SealedTable, T>(table: K, id: string): Promise<Stored<K, T> | undefined>;
  list<K extends SealedTable, T>(table: K): Promise<Array<Stored<K, T>>>;
  /** Ánh xạ id tạm → id máy chủ. */
  ids(): Promise<Map<string, string>>;
  /** Ghi nhiều thay đổi trong một giao dịch. Ghi lỗi (ví dụ đầy bộ nhớ) thì không thay đổi nào được ghi và hàm ném lỗi. */
  commit(changes: Change[]): Promise<void>;
  /** Số mục chưa đồng bộ xong (mọi trạng thái trừ `done`). */
  pendingCount(): Promise<number>;
  /** Tên nhân viên ở dạng rõ, để màn hình đăng nhập báo "máy này còn N mục chưa đồng bộ của …" (OFF-6). */
  setOwnerName(userName: string): Promise<void>;
  /**
   * Dọn bộ đệm của các ngày trước `day` và mục đã đồng bộ xong của các ngày đó. Không bao giờ dọn mục chưa xong;
   * còn mục cũ chưa xong thì giữ cả đơn đã ký khi mất mạng của ngày cũ (để in lại).
   */
  purgeBefore(day: string): Promise<void>;
  /** Đóng kho, không xóa (hết phiên, chuyển người dùng). */
  close(): void;
  /** Xóa toàn bộ dữ liệu và khóa của người dùng này trên máy (đăng xuất khi không còn mục chờ). */
  destroy(): Promise<void>;
}

// ------------------------------------------------------------------------------------------------- hàng rào in
// Chromium bỏ mất sự kiện trả về của yêu cầu IndexedDB đang dở khi trang gọi `print()` (vòng lặp sự kiện lồng nhau của hộp thoại
// in): lời hứa của yêu cầu đó không bao giờ xong, chuỗi thao tác lần lượt của kho treo, hàng đợi đồng bộ không gửi được nữa.
// [Đã đo trên Chromium không giao diện: 8–14 trên 200 yêu cầu đang dở bị mất, vẫn mất sau 10 giây; fetch, hẹn giờ, WebCrypto không bị.]
// Cách tránh: trước khi in, đóng hàng rào (thao tác mới chờ), đợi các thao tác đang dở xong, in, rồi mở hàng rào.

/** Mỗi thao tác với kho xong trong thời hạn này; quá hạn thì báo lỗi để chuỗi thao tác chạy tiếp thay vì treo mãi. */
export const STALL_MS = 20_000;
let inFlight = 0;
let fence: Promise<void> | undefined;
const drained: Array<() => void> = [];

async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  while (fence) await fence;
  inFlight++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LocalStoreError('stalled', 'Kho trên máy không phản hồi: tải lại trang (dữ liệu đã lưu không mất)')), STALL_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (--inFlight === 0) for (const r of drained.splice(0)) r();
  }
}

/** Số thao tác kho đang dở (IndexedDB), cho kiểm thử và chẩn đoán. */
export const localStoreInFlight = (): number => inFlight;

/**
 * Chạy `fn` (đồng bộ, ví dụ `print()`) khi kho trên máy không có thao tác IndexedDB nào đang dở, và không cho thao tác mới bắt đầu
 * trong lúc `fn` chạy. Thao tác đang dở quá `maxWaitMs` thì vẫn chạy `fn` (không để việc in chờ mãi).
 */
export async function whileLocalStoreQuiet(fn: () => void, maxWaitMs = 3000): Promise<void> {
  while (fence) await fence;
  let open!: () => void;
  fence = new Promise<void>((r) => (open = r));
  try {
    if (inFlight > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([new Promise<void>((r) => drained.push(r)), new Promise<void>((r) => (timer = setTimeout(r, maxWaitMs)))]);
      clearTimeout(timer);
    }
    fn();
  } finally {
    fence = undefined;
    open();
  }
}

/** Tên cũ (lát 2), giữ để không phải đổi mọi chỗ dùng. */
export type DraftStore = LocalStore;

const ROW_KEYS = new Set(['id', 'iv', 'ct', 'updatedAt']);
const plainOf = (row: SealedRow): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k]) => !ROW_KEYS.has(k)));

class EncryptedStore implements LocalStore {
  readonly persistent = true;
  // Mọi thao tác chạy lần lượt: lần ghi cũ (mã hóa chậm hơn) không thể đè lên lần ghi mới, lần đọc thấy mọi lần ghi trước nó.
  private chain: Promise<unknown> = Promise.resolve();
  // Thời điểm ghi tăng ngặt trong tab: hai lần ghi trong cùng một mili giây vẫn phân biệt được bản mới hơn.
  private lastWrite = 0;

  constructor(
    private readonly db: LocalDb,
    private readonly key: CryptoKey
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => tracked(fn);
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async open<K extends SealedTable, T>(table: K, row: SealedRow): Promise<Stored<K, T>> {
    try {
      const value = await unseal<T>(this.key, `${table}:${row.id}`, row);
      return { id: row.id, plain: plainOf(row) as PlainOf[K], value, updatedAt: row.updatedAt };
    } catch {
      throw new LocalStoreError('unreadable', 'Không đọc được dữ liệu đã lưu trên máy (hỏng hoặc không đúng khóa)');
    }
  }

  get<K extends SealedTable, T>(table: K, id: string): Promise<Stored<K, T> | undefined> {
    return this.serial(async () => {
      const row = await this.db[table].get(id);
      return row ? this.open<K, T>(table, row) : undefined;
    });
  }

  list<K extends SealedTable, T>(table: K): Promise<Array<Stored<K, T>>> {
    return this.serial(async () => Promise.all((await this.db[table].toArray()).map((row) => this.open<K, T>(table, row))));
  }

  ids(): Promise<Map<string, string>> {
    return this.serial(async () => new Map((await this.db.ids.toArray()).map((r) => [r.id, r.serverId])));
  }

  commit(changes: Change[]): Promise<void> {
    return this.serial(async () => {
      // WebCrypto không chạy được bên trong giao dịch IndexedDB (giao dịch tự đóng khi chờ việc khác): mã hóa trước, ghi sau.
      const now = (this.lastWrite = Math.max(Date.now(), this.lastWrite + 1));
      const rows = await Promise.all(
        changes.map(async (c) => {
          if ('delete' in c || c.table === 'ids') return undefined;
          const sealed = await seal(this.key, `${c.table}:${c.id}`, c.value);
          return { ...c.plain, id: c.id, ...sealed, updatedAt: now } as SealedRow;
        })
      );
      const tables = [...new Set(changes.map((c) => this.db[c.table]))];
      if (tables.length === 0) return;
      await this.db.transaction('rw', tables, async () => {
        for (const [i, c] of changes.entries()) {
          if ('delete' in c) await this.db[c.table].delete(c.id);
          else if (c.table === 'ids') await this.db.ids.put({ id: c.id, serverId: c.serverId, day: c.day });
          else await this.db[c.table].put(rows[i]!);
        }
      });
    });
  }

  getDraft(visitId: string): Promise<Draft | undefined> {
    return this.get<'drafts', Draft>('drafts', visitId).then((r) => r?.value);
  }

  latestDraft(visitIds: string[]): Promise<{ id: string; draft: Draft } | undefined> {
    return this.serial(async () => {
      const rows = (await this.db.drafts.bulkGet(visitIds)).filter((r): r is SealedRow => !!r);
      const newest = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return newest ? { id: newest.id, draft: (await this.open<'drafts', Draft>('drafts', newest)).value } : undefined;
    });
  }

  putDraft(visitId: string, draft: Draft): Promise<void> {
    return this.commit([{ table: 'drafts', id: visitId, plain: {}, value: draft }]);
  }

  deleteDraft(visitId: string): Promise<void> {
    return this.serial(() => this.db.drafts.delete(visitId));
  }

  pendingCount(): Promise<number> {
    return this.serial(() => this.db.ops.where('status').notEqual('done').count());
  }

  setOwnerName(userName: string): Promise<void> {
    return this.serial(() => this.db.meta.put({ k: 'owner', userName }).then(() => undefined));
  }

  purgeBefore(day: string): Promise<void> {
    return this.serial(async () => {
      await this.db.transaction('rw', [this.db.ops, this.db.ids, this.db.patients, this.db.snapshots, this.db.signed], async () => {
        for (const t of [this.db.patients, this.db.snapshots]) await t.where('day').below(day).delete();
        await this.db.ops.where('day').below(day).and((r) => r['status'] === 'done').delete();
        // Ánh xạ id cũ và đơn đã ký khi mất mạng chỉ còn cần khi còn mục cũ chưa xong: mục đó có thể tham chiếu id tạm của ngày cũ,
        // và bản khám của một mục đang xung đột hoặc chờ xác nhận phải in lại được cho tới khi xử lý xong (OFF-7).
        if ((await this.db.ops.where('day').below(day).count()) === 0) {
          await this.db.ids.where('day').below(day).delete();
          await this.db.signed.where('day').below(day).delete();
        }
      });
    });
  }

  close(): void {
    this.db.close();
  }

  destroy(): Promise<void> {
    return this.serial(() => this.db.delete());
  }
}

/** Dự phòng khi trình duyệt không có IndexedDB/WebCrypto: chỉ trong bộ nhớ của tab, mất khi tải lại. */
export class MemoryStore implements LocalStore {
  readonly persistent = false;
  private readonly tables = new Map<SealedTable, Map<string, { plain: unknown; value: unknown; updatedAt: number }>>(SEALED_TABLES.map((t) => [t, new Map()]));
  private readonly idMap = new Map<string, { serverId: string; day: string }>();
  private clock = 0;

  private table(t: SealedTable) {
    return this.tables.get(t)!;
  }

  async get<K extends SealedTable, T>(table: K, id: string): Promise<Stored<K, T> | undefined> {
    const r = this.table(table).get(id);
    return r ? (structuredClone({ id, ...r }) as Stored<K, T>) : undefined;
  }
  async list<K extends SealedTable, T>(table: K): Promise<Array<Stored<K, T>>> {
    return [...this.table(table)].map(([id, r]) => structuredClone({ id, ...r }) as Stored<K, T>);
  }
  async ids() {
    return new Map([...this.idMap].map(([k, v]) => [k, v.serverId]));
  }
  async commit(changes: Change[]) {
    // Thời điểm tăng dần (không dùng đồng hồ): hai lần ghi liên tiếp không bao giờ cùng thời điểm.
    const updatedAt = ++this.clock;
    for (const c of structuredClone(changes)) {
      if ('delete' in c) this.table(c.table).delete(c.id);
      else if (c.table === 'ids') this.idMap.set(c.id, { serverId: c.serverId, day: c.day });
      else this.table(c.table).set(c.id, { plain: c.plain, value: c.value, updatedAt });
    }
  }
  async getDraft(visitId: string) {
    return (await this.get<'drafts', Draft>('drafts', visitId))?.value;
  }
  async latestDraft(visitIds: string[]) {
    const found = (await Promise.all(visitIds.map((id) => this.get<'drafts', Draft>('drafts', id)))).filter((r) => !!r);
    const newest = found.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return newest ? { id: newest.id, draft: newest.value } : undefined;
  }
  async putDraft(visitId: string, draft: Draft) {
    await this.commit([{ table: 'drafts', id: visitId, plain: {}, value: draft }]);
  }
  async deleteDraft(visitId: string) {
    this.table('drafts').delete(visitId);
  }
  async pendingCount() {
    return [...this.table('ops').values()].filter((r) => (r.plain as OpMeta).status !== 'done').length;
  }
  async setOwnerName() {}
  async purgeBefore(day: string) {
    for (const t of ['patients', 'snapshots'] as const) for (const [id, r] of this.table(t)) if ((r.plain as DayMeta).day < day) this.table(t).delete(id);
    for (const [id, r] of this.table('ops')) if ((r.plain as OpMeta).day < day && (r.plain as OpMeta).status === 'done') this.table('ops').delete(id);
    if (![...this.table('ops').values()].some((r) => (r.plain as OpMeta).day < day)) {
      for (const [id, r] of this.table('signed')) if ((r.plain as DayMeta).day < day) this.table('signed').delete(id);
    }
  }
  close() {}
  async destroy() {
    for (const t of this.tables.values()) t.clear();
    this.idMap.clear();
  }
}

/**
 * Mở (hoặc tạo) kho mã hóa của một người dùng. Lần đầu sinh khóa mới; hai tab mở cùng lúc vẫn dùng chung một khóa
 * (tab đến sau thấy khóa đã có thì dùng khóa đó, không ghi đè).
 */
export async function openEncryptedStore(owner: Owner): Promise<LocalStore> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) {
    throw new LocalStoreError('unsupported', 'Trình duyệt không có IndexedDB hoặc WebCrypto');
  }
  const db = new LocalDb(dbName(owner));
  await db.open();
  let row = await db.meta.get('key');
  if (!row) {
    // Sinh khóa ngoài giao dịch (WebCrypto không chạy được trong giao dịch IndexedDB), rồi chỉ thêm nếu chưa có.
    const candidate = await newKey();
    try {
      await db.meta.add({ k: 'key', key: candidate });
    } catch (err) {
      if ((err as Error).name !== 'ConstraintError') throw err;
    }
    row = await db.meta.get('key');
  }
  if (row?.k !== 'key' || !row.key) throw new LocalStoreError('unreadable', 'Không đọc được khóa của kho trên máy');
  // Xin trình duyệt không tự dọn kho khi thiếu chỗ (không bảo đảm; trình duyệt tự quyết).
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return new EncryptedStore(db, row.key);
}

/** Mục chưa đồng bộ còn trên máy này, theo từng người dùng (màn hình đăng nhập, OFF-6). Chỉ đọc số đếm và tên nhân viên. */
export interface DevicePending {
  tenant: string;
  userId: string;
  userName?: string;
  count: number;
}

export async function pendingOnDevice(): Promise<DevicePending[]> {
  if (typeof indexedDB === 'undefined') return [];
  const out: DevicePending[] = [];
  for (const name of await Dexie.getDatabaseNames().catch(() => [] as string[])) {
    if (!name.startsWith(DB_PREFIX)) continue;
    const [tenant = '', userId = ''] = name.slice(DB_PREFIX.length).split(':');
    // Mở ở chế độ không khai báo phiên bản (đọc đúng lược đồ đang có), đọc xong đóng ngay để không cản tab khác nâng cấp.
    const db = new Dexie(name);
    try {
      await db.open();
      if (!db.tables.some((t) => t.name === 'ops')) continue;
      const count = await db.table('ops').where('status').notEqual('done').count();
      if (count === 0) continue;
      const owner = (await db.table('meta').get('owner')) as { userName?: string } | undefined;
      out.push({ tenant, userId, count, ...(owner?.userName ? { userName: owner.userName } : {}) });
    } catch {
      // kho đang bị xóa hoặc bị tab khác giữ: bỏ qua, đây chỉ là thông báo
    } finally {
      db.close();
    }
  }
  return out;
}

/** Bản nháp dạng rõ do bản trước (M0-S2) để lại trong sessionStorage: xóa đi khi ứng dụng khởi động. */
export function purgeLegacySessionDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('phongmach.draft.')) sessionStorage.removeItem(k);
  } catch {
    // sessionStorage bị chặn: không có gì để dọn
  }
}
