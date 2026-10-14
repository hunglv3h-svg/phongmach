import type { ThemeMode } from '../theme';
import { useTheme } from '../theme';

const OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Chủ đề giao diện">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={mode === o.value ? 'theme-opt active' : 'theme-opt'}
          aria-pressed={mode === o.value}
          data-testid={`theme-${o.value}`}
          onClick={() => setMode(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
