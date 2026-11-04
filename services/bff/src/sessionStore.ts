import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Kho phiên/refresh có thu hồi (§3.2, MEDIUM-2). Hợp đồng:
 *  - mỗi phiên có một `sid`; thu hồi `sid` ⇒ mọi access token mang `sid` đó bị từ chối tức thì (mọi route).
 *  - refresh là OPAQUE, một-lần (single-use), xoay mỗi lần dùng. Consume phải NGUYÊN TỬ:
 *    hai refresh song song cùng token ⇒ đúng MỘT thành công; refresh dùng lại (replay) ⇒ thu hồi `sid`.
 *
 * Lớp lỗi phải tránh (F11): KHÔNG dùng file JSON ghi ngây thơ (hai refresh song song cùng kiểm hợp lệ
 * trước khi bên nào kịp xoay). Dùng SQLite với UNIQUE(refresh_hash) + UPDATE…WHERE state='current' rồi
 * kiểm số dòng = 1 (compare-and-set nguyên tử). M1 chuyển Redis GETDEL — chỉ cần giữ interface này.
 */
export interface SessionStore {
  /** Tạo phiên mới, trả `sid` + refresh token thô (chỉ lúc này mới thấy bản thô). */
  create(input: { userId: string; tenant: string; refreshTtlMs: number; now: number }): { sid: string; refresh: string };
  /** `sid` còn hiệu lực? (dùng cho SidRevocationCheck). */
  isActive(sid: string): boolean;
  /** Thông tin phiên theo sid (userId, tenant), để dựng lại access token sau refresh. */
  sessionInfo(sid: string): { userId: string; tenant: string } | undefined;
  /**
   * Tiêu thụ refresh thô một-lần và xoay. Kết quả:
   *  - { kind:'ok', sid, refresh } : hợp lệ, đã xoay sang refresh mới.
   *  - { kind:'replay', sid } : token đúng dạng nhưng đã bị tiêu thụ (hoặc không là 'current') ⇒ sid đã bị thu hồi.
   *  - { kind:'invalid' } : không khớp phiên nào / hết hạn.
   */
  consume(refresh: string, input: { refreshTtlMs: number; now: number }): { kind: 'ok'; sid: string; refresh: string } | { kind: 'replay'; sid: string } | { kind: 'invalid' };
  /** Thu hồi một phiên theo `sid` (logout / DELETE sessions/:sid). */
  revoke(sid: string): void;
  /** Liệt kê sid còn hiệu lực của một người (để quản trị). */
  activeSids(userId: string): string[];
  close(): void;
}

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');
const newRefresh = (): string => randomBytes(32).toString('base64url');

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(url: string) {
    // Ở M0 `url` là đường dẫn file (hoặc ':memory:'). redis:// để dành M1.
    this.db = new DatabaseSync(url);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant TEXT NOT NULL,
        refresh_hash TEXT NOT NULL UNIQUE,  -- băm refresh HIỆN HÀNH ('current')
        revoked INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
      -- Băm của mọi refresh ĐÃ TIÊU THỤ: dùng để phát hiện dùng-lại (replay) ⇒ thu hồi sid.
      CREATE TABLE IF NOT EXISTS consumed_refresh (
        refresh_hash TEXT PRIMARY KEY,
        sid TEXT NOT NULL
      );
    `);
  }

  create(input: { userId: string; tenant: string; refreshTtlMs: number; now: number }): { sid: string; refresh: string } {
    const sid = randomUUID();
    const refresh = newRefresh();
    this.db
      .prepare('INSERT INTO sessions (sid, user_id, tenant, refresh_hash, revoked, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(sid, input.userId, input.tenant, hashToken(refresh), input.now + input.refreshTtlMs, input.now);
    return { sid, refresh };
  }

  isActive(sid: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE sid = ? AND revoked = 0').get(sid);
    return row !== undefined;
  }

  sessionInfo(sid: string): { userId: string; tenant: string } | undefined {
    const row = this.db.prepare('SELECT user_id, tenant FROM sessions WHERE sid = ? AND revoked = 0').get(sid) as
      | { user_id: string; tenant: string }
      | undefined;
    return row ? { userId: row.user_id, tenant: row.tenant } : undefined;
  }

  consume(refresh: string, input: { refreshTtlMs: number; now: number }): { kind: 'ok'; sid: string; refresh: string } | { kind: 'replay'; sid: string } | { kind: 'invalid' } {
    const h = hashToken(refresh);
    // Dùng lại một refresh ĐÃ tiêu thụ (replay) ⇒ thu hồi sid của nó.
    const consumed = this.db.prepare('SELECT sid FROM consumed_refresh WHERE refresh_hash = ?').get(h) as { sid: string } | undefined;
    if (consumed) {
      this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sid = ?').run(consumed.sid);
      return { kind: 'replay', sid: consumed.sid };
    }
    const row = this.db.prepare('SELECT sid, revoked, expires_at FROM sessions WHERE refresh_hash = ?').get(h) as
      | { sid: string; revoked: number; expires_at: number }
      | undefined;
    if (!row || row.revoked) return { kind: 'invalid' };
    const sid = row.sid;
    if (row.expires_at <= input.now) {
      this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sid = ?').run(sid);
      return { kind: 'invalid' };
    }
    // Compare-and-set nguyên tử: chỉ một lời gọi đổi được refresh_hash hiện hành sang token mới.
    // (node:sqlite đồng bộ: mỗi consume chạy trọn vẹn; UNIQUE(refresh_hash) + điều kiện WHERE bảo đảm một thắng.)
    const next = newRefresh();
    const nextHash = hashToken(next);
    const res = this.db
      .prepare('UPDATE sessions SET refresh_hash = ?, expires_at = ? WHERE sid = ? AND refresh_hash = ? AND revoked = 0')
      .run(nextHash, input.now + input.refreshTtlMs, sid, h);
    if (Number(res.changes) !== 1) {
      // Có người khác đã xoay trước (dòng không còn khớp h): coi như replay ⇒ thu hồi sid.
      this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sid = ?').run(sid);
      return { kind: 'replay', sid };
    }
    // Ghi băm cũ vào bảng đã-tiêu-thụ để lần dùng lại tiếp theo bị bắt là replay.
    this.db.prepare('INSERT OR IGNORE INTO consumed_refresh (refresh_hash, sid) VALUES (?, ?)').run(h, sid);
    return { kind: 'ok', sid, refresh: next };
  }

  revoke(sid: string): void {
    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sid = ?').run(sid);
  }

  activeSids(userId: string): string[] {
    const rows = this.db.prepare('SELECT sid FROM sessions WHERE user_id = ? AND revoked = 0').all(userId) as Array<{ sid: string }>;
    return rows.map((r) => r.sid);
  }

  close(): void {
    this.db.close();
  }
}
