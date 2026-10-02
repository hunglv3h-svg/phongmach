import { useId, useState, type KeyboardEvent } from 'react';

/**
 * Ô gõ tắt có gợi ý (chẩn đoán, thuốc). Tìm trong danh mục có sẵn ở máy nên kết quả đến ngay,
 * không có kết quả "cũ" như tìm bệnh nhân. Mũi tên chọn, Enter lấy, Esc đóng; chuột chỉ đổi mục chọn khi con trỏ DI CHUYỂN.
 */
export function Typeahead<T>({
  label,
  placeholder,
  search,
  render,
  getKey,
  onPick,
  testId,
}: {
  label: string;
  placeholder: string;
  search: (query: string) => T[];
  render: (item: T) => { primary: string; secondary?: string };
  getKey: (item: T) => string;
  onPick: (item: T) => void;
  testId: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const items = query.trim() ? search(query) : [];
  const index = Math.min(active, Math.max(items.length - 1, 0));

  const pick = (item: T) => {
    onPick(item);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      setActive(Math.min(index + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      setActive(Math.max(index - 1, 0));
    } else if (e.key === 'Enter' && items[index]) {
      e.preventDefault();
      pick(items[index]!);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className="typeahead">
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        data-testid={testId}
      />
      {items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="suggest" data-testid={`${testId}-list`}>
          {items.map((item, i) => {
            const r = render(item);
            return (
              <li key={getKey(item)} role="option" aria-selected={i === index}>
                <button type="button" className={i === index ? 'suggest-item active' : 'suggest-item'} onClick={() => pick(item)} onMouseMove={() => i !== index && setActive(i)} data-testid={`${testId}-item`}>
                  <span>{r.primary}</span>
                  {r.secondary && <small>{r.secondary}</small>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
