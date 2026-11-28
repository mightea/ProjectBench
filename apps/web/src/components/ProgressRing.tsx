import type { Progress } from '@projectbench/core/schemas';
import { progressLabel } from './bits.tsx';

/** Gives the circle a circumference of 100, so dash lengths are percentages. */
const RADIUS = 15.9155;

interface Props {
  progress: Progress;
  size?: number;
  /** The percentage in the middle; leave it out for small rings. */
  label?: boolean;
  /** Stroke class of the empty track: `stroke-surface` on a tinted background. */
  track?: string;
  strokeWidth?: number;
  className?: string;
}

/** Done items in the project's color (the accent outside a project), ordered ones after them. */
export function ProgressRing({ progress, size = 44, label = true, track = 'stroke-line-soft', strokeWidth = 3.2, className = '' }: Props) {
  const share = (n: number) => (progress.total ? (n / progress.total) * 100 : 0);
  const done = share(progress.done);
  const ordered = share(progress.ordered);
  return (
    <span role="img" aria-label={progressLabel(progress)} className={`relative flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" className="-rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={RADIUS} className={track} />
        {ordered > 0 && <circle cx="18" cy="18" r={RADIUS} className="ring-arc stroke-ordered" strokeDasharray={`${ordered} 100`} strokeDashoffset={-done} />}
        {done > 0 && <circle cx="18" cy="18" r={RADIUS} className="ring-arc" style={{ stroke: 'var(--look, var(--color-accent))' }} strokeDasharray={`${done} 100`} />}
      </svg>
      {label && (
        <span className="absolute font-display font-semibold" style={{ fontSize: Math.max(10, Math.round(size * 0.25)) }}>
          {Math.round(done)}%
        </span>
      )}
    </span>
  );
}
