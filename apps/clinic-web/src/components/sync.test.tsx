// Dựng thành phần ra HTML tĩnh (không cần trình duyệt): kiểm đúng cái người dùng thấy ở chỉ báo, danh sách chờ đồng bộ
// và màn hình đăng nhập, và kiểm rằng danh sách không có nút nào ngoài những nút đã chốt.
import type { Finding } from '@phongmach/rules';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SyncListActions } from '../local/syncActions';
import { indicatorView, type IndicatorView, type SyncNotice, type SyncRow } from '../local/syncList';
import { Login } from './Login';
import { SyncBar } from './SyncBar';
import { SyncNotices, SyncPanel } from './SyncPanel';

const noop = () => undefined;
const state = { online: true, paused: false as const, counted: true, pending: 0, attention: 0, version: 1 };
const bar = (view: IndicatorView) => renderToStaticMarkup(<SyncBar view={view} open={false} onToggle={noop} onSyncNow={noop} />);
const actions: SyncListActions = { syncNow: async () => undefined, acknowledge: async () => undefined, reprint: async () => undefined };
const panel = (view: IndicatorView, rows: SyncRow[] | undefined) => renderToStaticMarkup(<SyncPanel view={view} rows={rows} actions={actions} onClose={noop} />);
/** data-testid của mọi nút bấm trong HTML. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => /data-testid="([^"]+)"/.exec(m[0])?.[1] ?? m[0]);
const attr = (html: string, name: string) => new RegExp(`data-testid="sync-status"[^>]*\\b${name}="([^"]*)"`).exec(html)?.[1];

const finding: Finding = { key: 'allergy:class:penicillin:amox', rule: 'allergy', severity: 'ack', lines: [0], message: 'Bệnh nhân có ghi nhận dị ứng Penicillin: Amoxicillin 500 mg thuộc nhóm này.' };
const row = (over: Partial<SyncRow>): SyncRow => ({ id: crypto.randomUUID(), kind: 'complete', kindLabel: 'Ký đơn', patientName: 'Zq Thử', number: 5, label: 'Ký đơn · Zq Thử · số 005', status: 'pending', statusLabel: 'Chờ gửi', attention: false, ...over });
const rows: SyncRow[] = [
  row({ kind: 'open', kindLabel: 'Mở hồ sơ khám', status: 'conflict', statusLabel: 'Xung đột', attention: true, conflict: 'Lượt khám 005 đã do BS. B mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.', error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. B khám' } }),
  row({ status: 'held', statusLabel: 'Bị giữ: mục «Mở hồ sơ khám · Zq Thử · số 005» đang xung đột', attention: true, code: 'PM-261020-ABC123', reprint: 'tmp-rx' }),
  row({ status: 'rules', statusLabel: 'Chờ bác sĩ xác nhận', attention: true, rules: { unacknowledged: [finding], blocking: [] }, error: { status: 422, code: 'rules-not-satisfied', message: 'Lỗi 422' } }),
  row({ kind: 'patient', kindLabel: 'Tạo bệnh nhân', status: 'error', statusLabel: 'Cần xử lý', attention: true, error: { status: 400, code: 'invalid', message: 'Thiếu họ tên' } }),
  row({ kind: 'checkin', kindLabel: 'Cấp số', status: 'retry', statusLabel: 'Thử lại lúc 10:00:04 (lần gửi thứ 3)', tentative: true, number: 7, error: { status: 0, code: 'network', message: 'Không kết nối được máy chủ' } }),
  row({ kind: 'printed', kindLabel: 'Ghi nhận in đơn', status: 'sending', statusLabel: 'Đang gửi…', patientName: undefined }),
];

describe('chỉ báo mạng và đồng bộ', () => {
  it('chưa đếm xong: hiện "đang đếm", không hiện con số nào và không có nút "Đồng bộ ngay"', () => {
    const html = bar(indicatorView({ ...state, counted: false }, true));
    expect(html).toContain('Đang đếm mục chờ…');
    expect(attr(html, 'data-pending')).toBe('counting');
    expect(html).not.toMatch(/\d+ mục chờ|Đã đồng bộ hết/);
    expect(buttons(html)).toEqual(['sync-open']);
  });

  it('có mạng, hết mục chờ: "Có mạng", "Đã đồng bộ hết", lần gửi cuối; không có huy hiệu cần xử lý', () => {
    const html = bar(indicatorView({ ...state, lastSyncAt: Date.parse('2026-10-20T07:32:00Z') }, true));
    expect(html).toContain('data-testid="online-badge"');
    expect(html).not.toContain('data-testid="offline-badge"');
    expect(html).toContain('Đã đồng bộ hết');
    expect(html).toContain('Gửi lần cuối 14:32');
    expect(attr(html, 'data-pending')).toBe('0');
    expect(html).not.toContain('attention-badge');
  });

  it('mất mạng, 3 mục chờ, 2 cần xử lý, đang gửi: đủ cả; "Đồng bộ ngay" bị khóa khi mất mạng', () => {
    const html = bar(indicatorView({ ...state, pending: 3, attention: 2, sending: 'op' }, false));
    expect(html).toContain('data-testid="offline-badge"');
    expect(html).toContain('3 mục chờ đồng bộ · đang gửi…');
    expect(html).toMatch(/data-testid="attention-badge"[^>]*>2 cần xử lý</);
    expect([attr(html, 'data-online'), attr(html, 'data-pending'), attr(html, 'data-attention')]).toEqual(['false', '3', '2']);
    expect(html).toMatch(/<button[^>]*\bdisabled=""[^>]*data-testid="sync-now"/);
    expect(buttons(html)).toEqual(['sync-open', 'attention-badge', 'sync-now']);
  });

  it('hết phiên (401): "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục"', () => {
    const html = bar(indicatorView({ ...state, pending: 4, paused: 'unauthorized' }, true));
    expect(html).toMatch(/data-testid="session-expired"[^>]*>Phiên đã hết hạn: đăng nhập lại để đồng bộ 4 mục</);
  });
});

describe('danh sách chờ đồng bộ', () => {
  const view = indicatorView({ ...state, pending: 6, attention: 4 }, true);

  it('mỗi dòng: loại thao tác, bệnh nhân, số hoặc mã đơn, trạng thái, lỗi gần nhất của máy chủ', () => {
    const html = panel(view, rows);
    expect([...html.matchAll(/data-testid="sync-row" data-kind="(\w+)" data-status="(\w+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['open', 'conflict'],
      ['complete', 'held'],
      ['complete', 'rules'],
      ['patient', 'error'],
      ['checkin', 'retry'],
      ['printed', 'sending'],
    ]);
    for (const text of [
      'Mở hồ sơ khám',
      'Zq Thử · số 005 · mã đơn PM-261020-ABC123',
      'Lượt khám 005 đã do BS. B mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.',
      'Bị giữ: mục «Mở hồ sơ khám · Zq Thử · số 005» đang xung đột',
      'đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc',
      finding.message,
      'Máy chủ trả lời gần nhất (HTTP 400): Thiếu họ tên',
      'số 007 (tạm)',
      'Thử lại lúc 10:00:04 (lần gửi thứ 3)',
      'Máy chủ trả lời gần nhất (không kết nối được): Không kết nối được máy chủ',
      'Không rõ bệnh nhân',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('6 mục chờ đồng bộ · 4 cần xử lý');
  });

  it('không có nút xóa hay hủy: mỗi dòng chỉ có đúng các nút của trạng thái đó ("Xác nhận và gửi lại" cho 422, "In lại đơn" khi máy còn giữ đơn)', () => {
    const frame = ['sync-list-close', 'sync-list-now'];
    const perRow: string[][] = [[], ['sync-reprint'], ['sync-ack-submit'], [], [], []];
    expect(perRow).toHaveLength(rows.length);
    for (const [i, r] of rows.entries()) expect(buttons(panel(view, [r])), `${r.kind}/${r.status}`).toEqual([...frame, ...perRow[i]!]);
    expect(buttons(panel(view, rows))).toEqual([...frame, ...perRow.flat()]);
    for (const html of [panel(view, rows), panel(view, []), panel(view, undefined)]) {
      expect(html).not.toMatch(/>\s*(Xóa|Hủy|Bỏ|Gỡ)(?=[\s<])/);
      expect(html).not.toMatch(/data-testid="[^"]*(delete|discard|remove|cancel)[^"]*"/);
    }
  });

  it('422: mỗi phát hiện một ô lý do; "Xác nhận và gửi lại" bị khóa khi chưa ghi lý do; ghi rõ đơn đã in', () => {
    const second: Finding = { ...finding, key: 'allergy:class:penicillin:other', message: 'Phát hiện thứ hai' };
    const html = panel(view, [row({ status: 'rules', statusLabel: 'Chờ bác sĩ xác nhận', attention: true, rules: { unacknowledged: [finding, second], blocking: [] } })]);
    expect(html.match(/data-testid="sync-ack-reason"/g)).toHaveLength(2);
    expect(html).toContain('ít nhất 5 ký tự');
    expect(html).toMatch(/<button[^>]*\bdisabled=""[^>]*data-testid="sync-ack-submit"[^>]*>Xác nhận và gửi lại</);
    expect(html).toContain('đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc');
  });

  it('422 có lỗi chặn: hiện lỗi, không có ô lý do và không có nút gửi lại', () => {
    const block: Finding = { ...finding, key: 'max-days', rule: 'max-days', severity: 'block', message: 'Vượt số ngày tối đa' };
    const html = panel(view, [row({ status: 'rules', statusLabel: 'Chờ bác sĩ xác nhận', attention: true, rules: { unacknowledged: [finding], blocking: [block] } })]);
    expect(html).toContain('Vượt số ngày tối đa');
    expect(html).toContain(finding.message);
    expect(html).not.toContain('sync-ack-reason');
    expect(buttons(html)).toEqual(['sync-list-close', 'sync-list-now']);
    expect(html).toContain('không gửi lại được bằng cách xác nhận');
  });

  it('chưa đọc xong kho thì ghi "đang đọc", không ghi "không có mục nào"', () => {
    expect(panel(view, undefined)).toContain('Đang đọc dữ liệu trên máy…');
    expect(panel(view, undefined)).not.toContain('sync-list-empty');
    expect(panel(indicatorView(state, true), [])).toContain('data-testid="sync-list-empty"');
  });
});

describe('thông báo đồng bộ', () => {
  const notices: SyncNotice[] = [
    { id: 'conflict:a:1', kind: 'conflict', opId: 'a', text: 'Lượt khám 005 đã do BS. B mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.' },
    { id: 'renumbered:b', kind: 'renumbered', opId: 'b', text: 'Số 007 (cấp khi mất mạng) của Zq Số Tạm đã đổi thành 009: máy khác đã cấp số đó trước.' },
    { id: 'code-mismatch:c', kind: 'code-mismatch', opId: 'c', text: 'Mã đơn trên máy chủ (X) khác mã đã in (Y): hãy in lại đơn.' },
  ];
  const render = (list: SyncNotice[]) => renderToStaticMarkup(<SyncNotices notices={list} onDismiss={noop} onOpenList={noop} />);

  it('mỗi thông báo có nội dung và nút tắt; không có thông báo thì không dựng gì', () => {
    const html = render(notices);
    expect([...html.matchAll(/data-testid="sync-notice" data-kind="([\w-]+)"/g)].map((m) => m[1])).toEqual(['conflict', 'renumbered', 'code-mismatch']);
    for (const n of notices) expect(html).toContain(n.text);
    expect(buttons(html)).toEqual(['sync-notice-open', 'sync-notice-dismiss', 'sync-notice-dismiss', 'sync-notice-dismiss']);
    expect(render([])).toBe('');
  });
});

describe('màn hình đăng nhập sau khi hết phiên', () => {
  it('có dòng "Phiên đã hết hạn: đăng nhập lại để đồng bộ…"; đăng nhập thường thì không có', () => {
    const expired = renderToStaticMarkup(<Login onLogin={noop} expired={{ tenant: 'noi', userId: 'doc' }} />);
    expect(expired).toMatch(/data-testid="session-expired"[^>]*>Phiên đã hết hạn: đăng nhập lại để đồng bộ/);
    expect(renderToStaticMarkup(<Login onLogin={noop} />)).not.toContain('session-expired');
  });
});
