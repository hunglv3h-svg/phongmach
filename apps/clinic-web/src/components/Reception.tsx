import { classifyQuery, type PatientSummary } from '@phongmach/fhir-vn-model';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { INTENT_LABEL, ageText } from '../format';
import { PatientDetail } from './PatientDetail';
import { PatientForm, type FormInitial } from './PatientForm';

/** `forQuery` là chuỗi tìm mà `results` trả lời; khác với ô nhập hiện tại nghĩa là kết quả đã cũ. */
type Search = { status: 'idle' | 'loading' | 'done' | 'error'; results: PatientSummary[]; forQuery?: string; error?: string };
type Panel = { kind: 'none' } | { kind: 'detail'; patient: PatientSummary } | { kind: 'new'; initial: FormInitial; key: number };

/** Mô tả cách ô tìm kiếm hiểu những gì đang gõ (4 số cuối khác với đoạn số khác). */
function hint(query: string): string | undefined {
  const intent = classifyQuery(query);
  switch (intent.kind) {
    case 'empty':
      return undefined;
    case 'phone-fragment':
      return intent.digits.length === 4 ? 'Đang tìm theo 4 số cuối điện thoại' : `Đang tìm theo ${INTENT_LABEL['phone-fragment']}`;
    default:
      return `Đang tìm theo ${INTENT_LABEL[intent.kind]}`;
  }
}

export function Reception({ token }: { token: string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle', results: [] });
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [notice, setNotice] = useState<string>();
  const formKey = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (classifyQuery(query).kind === 'empty') {
      setSearch({ status: 'idle', results: [] });
      return;
    }
    const abort = new AbortController();
    // Chờ 150 ms sau lần gõ cuối (TL34 D.5) và bỏ kết quả của truy vấn cũ khi gõ tiếp.
    const timer = setTimeout(async () => {
      setSearch((s) => ({ ...s, status: 'loading' }));
      try {
        const r = await api.search(token, query, abort.signal);
        setSearch({ status: 'done', results: r.results, forQuery: query });
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSearch({ status: 'error', results: [], error: (e as Error).message });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, token]);

  const open = (patient: PatientSummary) => {
    setNotice(undefined);
    setPanel({ kind: 'detail', patient });
  };

  const startNew = () => {
    const intent = classifyQuery(query);
    const initial: FormInitial =
      intent.kind === 'name' ? { fullName: query.trim() } : intent.kind === 'phone' ? { phone: intent.phone } : intent.kind === 'cccd' ? { cccd: intent.cccd } : {};
    formKey.current += 1;
    setNotice(undefined);
    setPanel({ kind: 'new', initial, key: formKey.current });
  };

  // Chọn bằng chuột dùng onMouseMove chứ không phải onMouseEnter: con trỏ nằm yên trên danh sách (trình duyệt vẫn
  // phát sự kiện enter khi danh sách đổi) không được giành mất mục đang chọn bằng bàn phím.
  // Kết quả của truy vấn cũ vẫn hiện (mờ) cho đỡ nhấp nháy nhưng KHÔNG được chọn: gõ tên rồi bấm Enter
  // đúng lúc đó không được mở nhầm hồ sơ của bệnh nhân từ lần tìm trước.
  const fresh = search.status === 'done' && search.forQuery === query;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const results = fresh ? search.results : [];
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      open(results[active]);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  const hintText = hint(query);
  const empty = fresh && search.results.length === 0;

  return (
    <main className="reception">
      <section className="search-pane" aria-label="Tìm bệnh nhân">
        <label htmlFor="q" className="sr-only">Tìm bệnh nhân</label>
        <input
          id="q"
          ref={input}
          autoFocus
          autoComplete="off"
          inputMode="search"
          className="search-input"
          placeholder="Tên, số điện thoại, 4 số cuối hoặc CCCD"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-controls="results"
          aria-describedby="search-status"
          data-testid="search"
        />
        <p id="search-status" className="search-status" aria-live="polite" data-testid="search-status">
          {search.status === 'error'
            ? <span className="error">{search.error}</span>
            : !hintText
              ? 'Gõ tên (có dấu hay không đều được), số điện thoại, 4 số cuối hoặc CCCD'
              : fresh
                ? `${search.results.length} kết quả`
                : 'Đang tìm…'}
          {hintText && <span className="chip">{hintText}</span>}
        </p>

        <ul id="results" role="listbox" className={fresh ? 'results' : 'results stale'} aria-label="Kết quả tìm kiếm" aria-busy={!fresh} data-testid="results">
          {search.results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button className={i === active ? 'result active' : 'result'} disabled={!fresh} onClick={() => open(p)} onMouseMove={() => active !== i && setActive(i)} data-testid="result">
                <span className="result-name">{p.fullName}</span>
                <span className="result-meta">
                  {[p.phone, ageText(p.birthDate), p.cccdMasked].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {empty && <p className="muted">Không có bệnh nhân khớp.</p>}
        {(empty || search.status === 'idle' || fresh) && (
          <button className="secondary" onClick={startNew} data-testid="new-patient">+ Thêm bệnh nhân mới</button>
        )}
      </section>

      <section className="detail-pane" aria-label="Chi tiết" aria-live="polite">
        {notice && <p className="notice" role="status" data-testid="notice">{notice}</p>}
        {panel.kind === 'none' && <p className="muted">Chọn một bệnh nhân hoặc thêm bệnh nhân mới.</p>}
        {panel.kind === 'detail' && <PatientDetail key={panel.patient.id} token={token} summary={panel.patient} />}
        {panel.kind === 'new' && (
          <PatientForm
            key={panel.key}
            token={token}
            initial={panel.initial}
            onCancel={() => setPanel({ kind: 'none' })}
            onCreated={(patient, created) => {
              setNotice(created ? 'Đã tạo bệnh nhân mới.' : 'Bệnh nhân này đã được tạo trước đó, không tạo trùng.');
              setPanel({ kind: 'detail', patient });
              input.current?.focus();
            }}
          />
        )}
      </section>
    </main>
  );
}
