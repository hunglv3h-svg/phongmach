import { useCallback, useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api';
import { ACTION_LABEL, INTENT_LABEL, ROLE_LABEL, formatTime, shortId } from '../format';

/** Mô tả ngắn gọn một dòng nhật ký, không có dấu chấm thừa và dùng đúng đơn vị theo hành động. */
function detail(e: AuditEntry): string {
  const parts: string[] = [];
  if (e.queryKind) parts.push(`theo ${INTENT_LABEL[e.queryKind] ?? e.queryKind}`);
  if (e.resultCount !== undefined) {
    if (e.action === 'audit-read') parts.push(`${e.resultCount} dòng nhật ký`);
    else if (e.action === 'create') parts.push(e.resultCount ? 'bệnh nhân mới' : 'đã có sẵn, không tạo trùng');
    else parts.push(`${e.resultCount} hồ sơ`);
  }
  return parts.join(' · ');
}

export function AuditLog({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setEntries((await api.audit(token, 50)).entries);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="audit">
      <div className="audit-head">
        <h1>Nhật ký truy cập</h1>
        <button className="secondary" onClick={() => void load()}>Làm mới</button>
      </div>
      <p className="muted">Ai đã đăng nhập, tìm, mở hoặc tạo hồ sơ nào, lúc nào. Nhật ký không lưu nội dung tìm kiếm, chỉ lưu loại truy vấn, số kết quả và mã hồ sơ.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!entries && !error && <p className="muted">Đang tải…</p>}
      {entries && (
        <div className="table-wrap">
          <table data-testid="audit-table">
            <thead>
              <tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Chi tiết</th><th>Kết quả</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.requestId + e.action}>
                  <td>{formatTime(e.ts)}</td>
                  <td>{e.userName ?? e.userId}<small> · {ROLE_LABEL[e.role]}</small></td>
                  <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td>
                    {detail(e)}
                    {e.resourceIds && e.resourceIds.length > 0 && <small className="mono"> {detail(e) ? '· ' : ''}{e.resourceIds.slice(0, 3).map(shortId).join(', ')}{e.resourceIds.length > 3 ? '…' : ''}</small>}
                  </td>
                  <td><span className={e.outcome === 'ok' ? 'badge ok' : 'badge bad'}>{e.outcome === 'ok' ? 'Thành công' : e.outcome === 'denied' ? 'Bị từ chối' : 'Lỗi'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
