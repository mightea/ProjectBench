import { PROJECT_COLORS, PROJECT_ICONS, type ProjectColor, type ProjectIcon } from '@projectbench/core/schemas';
import type { CSSProperties } from 'react';

export const COLOR_LABELS: Record<ProjectColor, string> = {
  teal: 'Teal',
  amber: 'Amber',
  rust: 'Rust',
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  rose: 'Rose',
  slate: 'Slate',
};

export const ICON_LABELS: Record<ProjectIcon, string> = {
  chip: 'Chip',
  light: 'Light',
  motorcycle: 'Motorcycle',
  power: 'Power',
  wrench: 'Wrench',
  home: 'Home',
  garden: 'Garden',
  box: 'Box',
};

export const ICON_PATHS: Record<ProjectIcon, string> = {
  chip: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 15h3M2 9h3M2 15h3',
  light: 'M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7V17h6v-1c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5z',
  motorcycle: 'M2 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 16l4-6h6l4 6M9 10L7.5 7H5M15 10l1.5-3H19',
  power: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  garden: 'M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l7-7',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
};

/** Fills the window at xl; from 2xl, 1600 px of content plus the page gutters, centred. */
export const CONTENT_WIDTH = 'max-w-[84rem] xl:max-w-none 2xl:max-w-[104rem]';

interface Look {
  id: string;
  color: string | null;
  icon?: string | null;
}

/** The stored color, or a stable one derived from the id, so a project is never without one. */
export function projectColor({ id, color }: Look): ProjectColor {
  if (PROJECT_COLORS.includes(color as ProjectColor)) return color as ProjectColor;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!;
}

export const projectIcon = ({ icon }: Look): ProjectIcon => (PROJECT_ICONS.includes(icon as ProjectIcon) ? (icon as ProjectIcon) : 'box');

/** Sets --look, --look-soft and --look-ink for everything inside the element. */
export const lookStyle = (color: ProjectColor) =>
  ({
    '--look': `var(--project-${color})`,
    '--look-soft': `var(--project-${color}-soft)`,
    '--look-ink': `var(--project-${color}-ink)`,
  }) as CSSProperties;
