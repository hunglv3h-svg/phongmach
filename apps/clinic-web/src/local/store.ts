// Kho dữ liệu trên máy (kế hoạch, OFF-5): IndexedDB qua Dexie, mỗi bản ghi có dữ liệu bệnh nhân được mã hóa AES-GCM.
// Mỗi (phòng khám, người dùng) một CSDL riêng; trường dạng rõ chỉ có id và thời điểm, không có tên, chẩn đoán hay thuốc.
import Dexie, { type Table } from 'dexie';
import type { Draft } from '../visit/draft';
import { newKey, seal, unseal, type Sealed } from './crypto';

export interface Owner {
  tenant: string;
  userId: string;
}

/** Tên CSDL: chỉ có mã phòng khám và mã người dùng (không phải dữ liệu bệnh nhân). */
export const dbName = (o: Owner): string => `phongmach:${o.tenant}:${o.userId}`;

interface KeyRow {
  k: 'key';
  key: CryptoKey;
}

interface SealedRow extends Sealed {
  id: string;
  updatedAt: number;
}

type SealedTable = 'drafts';

class LocalDb extends Dexie {
  meta!: Table<KeyRow, string>;
  drafts!: Table<SealedRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'k', drafts: 'id' });
  }
}

export class LocalStoreError extends Error {
  constructor(
    readonly code: 'unsupported' | 'unreadable',
    message: string
  ) {
    super(message);
    this.name = 'LocalStoreError';
  }
}

/** Nơi giữ bản nháp lượt khám. */
export interface DraftStore {
  /** false: trình duyệt không có IndexedDB/WebCrypto, bản nháp chỉ nằm trong bộ nhớ của tab. */
  readonly persistent: boolean;
  getDraft(visitId: string): Promise<Draft | undefined>;
  putDraft(visitId: string, draft: Draft): Promise<void>;
  deleteDraft(visitId: string): Promise<void>;
  /** Đóng kho, không xóa (hết phiên, chuyển người dùng). */
  close(): void;
  /** Xóa toàn bộ dữ liệu và khóa của người dùng này trên máy (đăng xuất). */
  destroy(): Promise<void>;
}

class EncryptedStore implements DraftStore {
  readonly persistent = true;
  // Mọi thao tác chạy lần lượt: lần ghi cũ (mã hóa chậm hơn) không thể đè lên lần ghi mới, lần đọc thấy mọi lần ghi trước nó.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: LocalDb,
    private readonly key: CryptoKey
  ) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private put(table: SealedTable, id: string, value: unknown): Promise<void> {
    return this.serial(async () => {
      const sealed = await seal(this.key, `${table}:${id}`, value);
      await this.db[table].put({ id, ...sealed, updatedAt: Date.now() });
    });
  }

  private get<T>(table: SealedTable, id: string): Promise<T | undefined> {
    return this.serial(async () => {
      const row = await this.db[table].get(id);
      if (!row) return undefined;
      try {
        return await unseal<T>(this.key, `${table}:${id}`, row);
      } catch {
        throw new LocalStoreError('unreadable', 'Không đọc được dữ liệu đã lưu trên máy (hỏng hoặc không đúng khóa)');
      }
    });
  }

  getDraft(visitId: string): Promise<Draft | undefined> {
    return this.get<Draft>('drafts', visitId);
  }

  putDraft(visitId: string, draft: Draft): Promise<void> {
    return this.put('drafts', visitId, draft);
  }

  deleteDraft(visitId: string): Promise<void> {
    return this.serial(() => this.db.drafts.delete(visitId));
  }

  close(): void {
    this.db.close();
  }

  destroy(): Promise<void> {
    return this.serial(() => this.db.delete());
  }
}

/** Dự phòng khi trình duyệt không có IndexedDB/WebCrypto: chỉ trong bộ nhớ của tab, mất khi tải lại. */
export class MemoryStore implements DraftStore {
  readonly persistent = false;
  private readonly drafts = new Map<string, Draft>();

  async getDraft(visitId: string) {
    const d = this.drafts.get(visitId);
    return d ? structuredClone(d) : undefined;
  }
  async putDraft(visitId: string, draft: Draft) {
    this.drafts.set(visitId, structuredClone(draft));
  }
  async deleteDraft(visitId: string) {
    this.drafts.delete(visitId);
  }
  close() {}
  async destroy() {
    this.drafts.clear();
  }
}

/**
 * Mở (hoặc tạo) kho mã hóa của một người dùng. Lần đầu sinh khóa mới; hai tab mở cùng lúc vẫn dùng chung một khóa
 * (tab đến sau thấy khóa đã có thì dùng khóa đó, không ghi đè).
 */
export async function openEncryptedStore(owner: Owner): Promise<DraftStore> {
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
  if (!row?.key) throw new LocalStoreError('unreadable', 'Không đọc được khóa của kho trên máy');
  // Xin trình duyệt không tự dọn kho khi thiếu chỗ (không bảo đảm; trình duyệt tự quyết).
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return new EncryptedStore(db, row.key);
}

/** Bản nháp dạng rõ do bản trước (M0-S2) để lại trong sessionStorage: xóa đi khi ứng dụng khởi động. */
export function purgeLegacySessionDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('phongmach.draft.')) sessionStorage.removeItem(k);
  } catch {
    // sessionStorage bị chặn: không có gì để dọn
  }
}
