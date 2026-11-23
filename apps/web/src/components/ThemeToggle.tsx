import { setTheme, useTheme, type ThemeChoice } from '../lib/theme.ts';
import { MonitorIcon, MoonIcon, SunIcon } from './icons.tsx';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

/** Compact shows icons only, for the sidebar. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Appearance" className="flex rounded-[10px] bg-line p-[3px]">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={compact ? `${label} theme` : undefined}
          title={compact ? `${label} theme` : undefined}
          onClick={() => setTheme(value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg text-sm ${compact ? 'h-8' : 'h-11'} ${
            theme === value ? 'bg-surface font-semibold shadow-sm' : 'font-medium text-ink-soft'
          }`}
        >
          <Icon width={16} height={16} />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
