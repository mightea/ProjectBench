import { ICON_PATHS, lookStyle, projectColor, projectIcon } from '../lib/look.ts';

interface Props {
  project: { id: string; color: string | null; icon?: string | null };
  size?: number;
}

/** A project's color and glyph, the way to recognise it in any list. */
export function ProjectTile({ project, size = 40 }: Props) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-(--look) text-white"
      style={{ ...lookStyle(projectColor(project)), width: size, height: size, borderRadius: Math.round(size * 0.27) }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATHS[projectIcon(project)]} />
      </svg>
    </span>
  );
}
