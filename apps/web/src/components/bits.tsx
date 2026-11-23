import type { Progress } from '@projectbench/core/schemas';
import { PRIORITY_META } from '../lib/format.ts';

export function PriorityBadge({ priority, long = false }: { priority: number; long?: boolean }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META[3]!;
  const size = long ? 'flex h-8 items-center rounded-lg px-2.5 text-[13px]' : 'rounded-md px-1.5 py-0.5 text-[11px]';
  return (
    <span className={`font-semibold whitespace-nowrap ${size} ${meta.className}`}>
      {meta.short}
      {long && ` · ${meta.label}`}
    </span>
  );
}

export function ProgressBar({ progress, className = 'h-1.5' }: { progress: Progress; className?: string }) {
  const pct = (n: number) => (progress.total ? `${(n / progress.total) * 100}%` : '0%');
  return (
    <div
      className={`flex overflow-hidden rounded-full bg-line-soft ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
      aria-label={`${progress.done} of ${progress.total} done`}
    >
      <div className="bg-accent" style={{ width: pct(progress.done) }} />
      <div className="bg-ordered" style={{ width: pct(progress.ordered) }} />
    </div>
  );
}

export function progressLabel(p: Progress): string {
  if (p.total === 0) return 'No items yet';
  return `${p.done} of ${p.total} done${p.ordered ? ` · ${p.ordered} ordered` : ''}`;
}
