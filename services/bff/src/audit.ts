import { mkdirSync, readFileSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Role } from './tenants.js';

export type AuditAction = 'login' | 'search' | 'read' | 'create' | 'audit-read';

/**
 * Nhật ký truy cập do BFF ghi (T-AUD, A3). KHÔNG chứa nội dung truy vấn hay dữ liệu bệnh nhân:
 * chỉ ghi loại truy vấn, số kết quả và id tài nguyên.
 */
export interface AuditEntry {
  ts: string;
  requestId: string;
  tenant: string;
  userId: string;
  userName?: string;
  role: Role;
  action: AuditAction;
  outcome: 'ok' | 'denied' | 'error';
  queryKind?: string;
  resultCount?: number;
  resourceIds?: string[];
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
  /** Mới nhất trước. */
  recent(tenant: string, limit: number): Promise<AuditEntry[]>;
  close(): Promise<void>;
}

export class MemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async recent(tenant: string, limit: number): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.tenant === tenant).slice(-limit).reverse();
  }
  async close(): Promise<void> {}
}

/**
 * Ghi nối tiếp NDJSON, đồng bộ xuống đĩa trước khi trả lời.
 * Chỉ dành cho M0: sang M1 chuyển ra kho bất biến ngoài ứng dụng (T-AUD).
 */
export class NdjsonAuditSink implements AuditSink {
  private handle: Promise<FileHandle>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.handle = open(path, 'a');
  }

  record(entry: AuditEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const write = this.chain.then(async () => {
      const h = await this.handle;
      await h.appendFile(line);
      await h.sync();
    });
    this.chain = write.catch(() => undefined);
    return write;
  }

  async recent(tenant: string, limit: number): Promise<AuditEntry[]> {
    await this.chain;
    let text = '';
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      return [];
    }
    const out: AuditEntry[] = [];
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const e = JSON.parse(line) as AuditEntry;
        if (e.tenant === tenant) out.push(e);
      } catch {
        // dòng hỏng (ví dụ ghi dở khi mất điện) thì bỏ qua
      }
    }
    return out;
  }

  async close(): Promise<void> {
    await this.chain;
    await (await this.handle).close();
  }
}
