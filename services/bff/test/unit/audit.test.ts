import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NdjsonAuditSink, type AuditEntry } from '../../src/audit.js';

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  ts: new Date().toISOString(),
  requestId: 'r',
  tenant: 'a',
  userId: 'u',
  role: 'assistant',
  action: 'search',
  outcome: 'ok',
  ...over,
});

describe('nhật ký NDJSON', () => {
  it('ghi đồng thời nhiều dòng mà không xen lẫn', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'sub', 'audit.ndjson');
    const sink = new NdjsonAuditSink(path);
    await Promise.all(Array.from({ length: 50 }, (_, i) => sink.record(entry({ requestId: `r${i}`, resultCount: i }))));
    await sink.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(50);
    expect(new Set(lines.map((l) => (JSON.parse(l) as AuditEntry).requestId)).size).toBe(50);
  });

  it('recent lọc theo phòng khám, mới nhất trước, bỏ qua dòng hỏng', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.ndjson');
    const sink = new NdjsonAuditSink(path);
    await sink.record(entry({ requestId: '1', tenant: 'a' }));
    await sink.record(entry({ requestId: '2', tenant: 'b' }));
    await sink.record(entry({ requestId: '3', tenant: 'a' }));
    appendFileSync(path, '{dòng ghi dở khi mất điện\n');
    await sink.record(entry({ requestId: '4', tenant: 'a' }));
    const recent = await sink.recent('a', 10);
    expect(recent.map((e) => e.requestId)).toEqual(['4', '3', '1']);
    expect((await sink.recent('a', 2)).map((e) => e.requestId)).toEqual(['4', '3']);
    await sink.close();
  });

  it('chưa có file thì recent trả về rỗng', async () => {
    const sink = new NdjsonAuditSink(join(mkdtempSync(join(tmpdir(), 'audit-')), 'x.ndjson'));
    expect(await sink.recent('a', 5)).toEqual([]);
    await sink.close();
  });
});
