import type { ProjectRef, ProjectSummary } from '@projectbench/core/schemas';
import type { MouseEvent } from 'react';
import { ChevronRightIcon, PlusIcon, SubprojectIcon } from '../components/icons.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { dueTone, dueToneClass, formatDue, STATUS_META } from '../lib/format.ts';
import { lookStyle, projectColor } from '../lib/look.ts';

type Navigate = (to: string) => void;

const follow = (navigate: Navigate, to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(to);
};

/** Shown above a sub-project's title: where it belongs. */
export function ParentLink({ parent, navigate }: { parent: ProjectRef; navigate: Navigate }) {
  return (
    <a
      href={`/projects/${parent.id}`}
      onClick={follow(navigate, `/projects/${parent.id}`)}
      className="flex min-h-11 items-center gap-2 self-start rounded-full bg-surface/70 py-1 pr-3 pl-1.5 text-[13px] text-ink-soft hover:bg-surface"
    >
      <ProjectTile project={parent} size={22} />
      <span>
        Sub-project of <span className="font-semibold text-ink">{parent.title}</span>
      </span>
      <ChevronRightIcon width={14} height={14} className="text-muted" />
    </a>
  );
}

/** Thin bar of done (and ordered) items. */
function Meter({ project: p, className = 'w-10' }: { project: ProjectSummary; className?: string }) {
  const { total, done, ordered } = p.progress;
  if (total === 0) return null;
  return (
    <span className={`flex h-1 shrink-0 overflow-hidden rounded-full bg-line-soft ${className}`} aria-hidden="true">
      <span className="bg-(--look)" style={{ width: `${(done / total) * 100}%` }} />
      <span className="bg-ordered" style={{ width: `${(ordered / total) * 100}%` }} />
    </span>
  );
}

const counts = ({ progress: { total, done } }: ProjectSummary) => (total ? `${done}/${total}` : 'No items');

/** The parent's sub-projects as cards, with a way to start another. */
export function SubprojectsSection({ projects, navigate, onNew }: { projects: ProjectSummary[]; navigate: Navigate; onNew: () => void }) {
  if (projects.length === 0) return null;
  const finished = projects.filter((p) => p.status === 'done' || p.status === 'archived').length;
  return (
    <section aria-labelledby="subprojects" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <SubprojectIcon width={16} height={16} className="text-(--look-ink)" />
        <h2 id="subprojects" className="text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
          Sub-projects · {projects.length}
        </h2>
        {finished > 0 && <span className="text-xs text-muted">{finished} finished</span>}
        <button
          type="button"
          onClick={onNew}
          className="-my-2 ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-accent-ink hover:bg-surface"
        >
          <PlusIcon width={15} height={15} />
          New sub-project
        </button>
      </div>
      <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
        {projects.map((p) => (
          <li key={p.id}>
            <SubprojectCard project={p} navigate={navigate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubprojectCard({ project: p, navigate }: { project: ProjectSummary; navigate: Navigate }) {
  const finished = p.status === 'done' || p.status === 'archived';
  return (
    <a
      href={`/projects/${p.id}`}
      onClick={follow(navigate, `/projects/${p.id}`)}
      style={lookStyle(projectColor(p))}
      className={`flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-3 hover:border-line-strong ${finished ? 'opacity-70' : ''}`}
    >
      <span className="flex items-start gap-2.5">
        <ProjectTile project={p} size={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`line-clamp-2 text-[15px] leading-snug font-semibold ${p.status === 'done' ? 'line-through decoration-faint' : ''}`}>{p.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`size-1.5 rounded-full ${STATUS_META[p.status].dot}`} aria-hidden="true" />
            {STATUS_META[p.status].label}
            {p.dueDate && (
              <>
                {' · '}
                <span className={dueToneClass[dueTone(p.dueDate)]}>{formatDue(p.dueDate)}</span>
              </>
            )}
          </span>
        </span>
        <ChevronRightIcon width={16} height={16} className="mt-2 shrink-0 text-faint" />
      </span>
      <span className="flex items-center gap-2 text-xs text-ink-soft">
        <Meter project={p} className="flex-1" />
        <span className="shrink-0 font-semibold">{counts(p)}</span>
      </span>
      {p.nextStep && !finished && (
        <span className="truncate text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">Next</span> {p.nextStep.text}
        </span>
      )}
    </a>
  );
}

/**
 * Sub-projects inside their parent's card on the overview, one compact row each.
 * The status shows only where it differs from the parent's section.
 */
export function SubprojectRows({ projects, parentStatus, navigate }: { projects: ProjectSummary[]; parentStatus: string; navigate: Navigate }) {
  return (
    <ul aria-label="Sub-projects" className="flex flex-col border-t border-line-soft px-1.5 py-1">
      {projects.map((p) => (
        <li key={p.id}>
          <a
            href={`/projects/${p.id}`}
            onClick={follow(navigate, `/projects/${p.id}`)}
            style={lookStyle(projectColor(p))}
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-ground"
          >
            <SubprojectIcon width={14} height={14} className="shrink-0 text-faint" />
            <ProjectTile project={p} size={24} />
            <span className={`min-w-0 flex-1 truncate text-sm font-medium ${p.status === 'done' ? 'text-muted line-through' : ''}`}>{p.title}</span>
            {p.status !== parentStatus && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <span className={`size-1.5 rounded-full ${STATUS_META[p.status].dot}`} aria-hidden="true" />
                {STATUS_META[p.status].label}
              </span>
            )}
            <Meter project={p} className="w-8" />
            <span className="w-9 shrink-0 text-right text-xs font-semibold text-ink-soft tabular-nums">{p.progress.total ? counts(p) : '–'}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
