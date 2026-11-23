import type { ProjectStatus, ProjectSummary } from '@projectbench/core/schemas';
import { useId, useState, type MouseEvent } from 'react';
import { FilterIcon, kindIcon, PlusIcon, SearchIcon, SettingsIcon } from '../components/icons.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { dueTone, dueToneClass, formatDue, PRIORITY_META } from '../lib/format.ts';
import { useProjects } from '../lib/queries.ts';
import { useTagFilter } from '../useRoute.ts';
import { NewProjectSheet } from './NewProjectSheet.tsx';

const SECTIONS: { status: ProjectStatus; label: string }[] = [
  { status: 'active', label: 'Active' },
  { status: 'waiting', label: 'Waiting' },
  { status: 'planned', label: 'Planned' },
  { status: 'idea', label: 'Ideas' },
  { status: 'done', label: 'Done' },
  { status: 'archived', label: 'Archived' },
];

const SORTS = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'updated', label: 'Recently changed' },
];

const METERS = [
  { kind: 'buy', label: 'Parts', icon: 'text-accent-ink', bar: 'bg-accent' },
  { kind: 'clarify', label: 'Questions', icon: 'text-warning-ink', bar: 'bg-warning' },
  { kind: 'todo', label: 'Steps', icon: 'text-success', bar: 'bg-success' },
] as const;

export function ProjectsScreen({ navigate }: { navigate: (to: string) => void }) {
  const [sort, setSort] = useState('priority');
  const [showDone, setShowDone] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tag, setTag] = useTagFilter();
  const status = showDone || showArchived ? 'all' : 'open';
  const projects = useProjects({ status, sort, q: q.trim() || undefined, tag: tag ?? undefined });
  const shown = projects.data?.filter((p) => (p.status !== 'done' || showDone) && (p.status !== 'archived' || showArchived));
  const filtered = Boolean(q || tag || showDone || showArchived);

  const open = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(`/projects/${id}`);
  };

  return (
    <>
      <header className="flex flex-col gap-3 px-5 pt-5 pb-2 md:px-8 md:pt-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Projects</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Search projects"
              aria-pressed={searching}
              onClick={() => {
                if (searching) setQ('');
                setSearching(!searching);
              }}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-surface"
            >
              <SearchIcon width={20} height={20} />
            </button>
            <button
              type="button"
              aria-label="Sort and show done or archived"
              onClick={() => setViewOpen(true)}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-surface"
            >
              <FilterIcon width={20} height={20} />
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="hidden h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-strong md:flex"
            >
              <PlusIcon width={16} height={16} />
              New project
            </button>
          </div>
        </div>
        {searching && (
          <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-muted md:max-w-md">
            <SearchIcon width={18} height={18} />
            <span className="sr-only">Filter projects by title</span>
            <input
              type="search"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none"
            />
          </label>
        )}
        <TagFilter value={tag} onChange={setTag} allCount={shown?.length} />
      </header>

      <main className="flex flex-1 flex-col gap-2.5 px-4 pt-1 pb-32 md:px-8 md:pb-10">
        {!shown ? (
          <QueryFallback query={projects} />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
            <p className="font-semibold">{filtered ? 'No matching projects' : 'No projects yet'}</p>
            <p className="max-w-sm text-sm text-muted">
              {filtered ? 'Try another filter.' : 'Start with the project that’s on your bench right now.'}
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="h-11 rounded-xl bg-accent px-5 font-semibold text-white hover:bg-accent-strong"
            >
              New project
            </button>
          </div>
        ) : (
          SECTIONS.map(({ status: s, label }) => {
            const members = shown.filter((p) => p.status === s);
            if (members.length === 0) return null;
            const compact = s === 'idea' || s === 'archived';
            return (
              <section key={s} className="flex flex-col gap-2.5" aria-labelledby={`section-${s}`}>
                <h2 id={`section-${s}`} className="mx-1 mt-1.5 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
                  {label} · {members.length}
                </h2>
                <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {members.map((p) => (
                    <li key={p.id}>
                      {compact ? (
                        <ProjectRow project={p} href={`/projects/${p.id}`} onClick={open(p.id)} />
                      ) : (
                        <ProjectCard project={p} href={`/projects/${p.id}`} onClick={open(p.id)} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>

      <button
        type="button"
        aria-label="New project"
        onClick={() => setCreating(true)}
        className="fixed right-5 bottom-[calc(max(env(safe-area-inset-bottom),12px)+80px)] flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_16px_rgba(47,91,234,0.35)] md:hidden"
      >
        <PlusIcon />
      </button>

      {viewOpen && (
        <ViewSheet
          sort={sort}
          showDone={showDone}
          showArchived={showArchived}
          onSort={setSort}
          onShowDone={setShowDone}
          onShowArchived={setShowArchived}
          onSettings={() => navigate('/settings')}
          onClose={() => setViewOpen(false)}
        />
      )}

      {creating && (
        <NewProjectSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/projects/${id}?look`);
          }}
        />
      )}
    </>
  );
}

interface ViewProps {
  sort: string;
  showDone: boolean;
  showArchived: boolean;
  onSort: (sort: string) => void;
  onShowDone: (show: boolean) => void;
  onShowArchived: (show: boolean) => void;
  onSettings: () => void;
  onClose: () => void;
}

function ViewSheet({ sort, showDone, showArchived, onSort, onShowDone, onShowArchived, onSettings, onClose }: ViewProps) {
  const sortId = useId();
  const toggle = 'flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line px-3.5 text-[15px] font-medium';
  return (
    <Sheet title="View" onClose={onClose}>
      <div className="flex flex-col gap-3 pb-2">
        <Field label="Sort by" htmlFor={sortId}>
          <select id={sortId} value={sort} onChange={(e) => onSort(e.target.value)} className={inputClass}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <label className={toggle}>
          Show done projects
          <input type="checkbox" checked={showDone} onChange={(e) => onShowDone(e.target.checked)} className="size-5 accent-accent" />
        </label>
        <label className={toggle}>
          Show archived projects
          <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} className="size-5 accent-accent" />
        </label>
        <button
          type="button"
          onClick={() => {
            onClose();
            onSettings();
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-semibold md:hidden"
        >
          <SettingsIcon width={18} height={18} />
          Settings
        </button>
      </div>
    </Sheet>
  );
}

const tagLine = (tags: string[]) => {
  if (tags.length === 0) return null;
  const first = tags.slice(0, 2).map((t) => `#${t}`).join(' · ');
  return tags.length > 2 ? `${first} +${tags.length - 2}` : first;
};

/** What matters most about the parts: on the way, then still to buy, then all in. */
function buyBadge({ kinds: { buy } }: ProjectSummary) {
  if (buy.total === 0) return null;
  if (buy.ordered > 0) return { text: `${buy.ordered} on the way`, className: 'bg-warning-soft text-warning-ink' };
  const open = buy.total - buy.done;
  if (open > 0) return { text: `${open} to buy`, className: 'bg-accent-soft text-accent-ink' };
  return { text: 'All parts in', className: 'bg-success-soft text-success' };
}

function NextLine({ project: p }: { project: ProjectSummary }) {
  const questions = p.kinds.clarify.total - p.kinds.clarify.done;
  if (p.status === 'planned' && questions > 0) {
    return (
      <p className="text-sm leading-snug text-ink-soft">
        <span className="font-semibold text-ink">
          Blocked by {questions} {questions === 1 ? 'question' : 'questions'}
        </span>
        {p.nextStep && ` · ${p.nextStep.text}`}
      </p>
    );
  }
  if (!p.nextStep) return null;
  return (
    <p className="text-sm leading-snug text-ink-soft">
      <span className="font-semibold text-ink">Next</span> {p.nextStep.text}
    </p>
  );
}

function ProjectCard({ project: p, href, onClick }: { project: ProjectSummary; href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const badge = buyBadge(p);
  const tags = tagLine(p.tags);
  return (
    <a href={href} onClick={onClick} className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 hover:border-line-strong">
      <div className="flex items-center gap-3">
        <ProjectTile project={p} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base leading-snug font-semibold">{p.title}</span>
          {tags && <span className="truncate text-xs text-muted">{tags}</span>}
        </span>
        {badge && <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${badge.className}`}>{badge.text}</span>}
      </div>
      <NextLine project={p} />
      <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {METERS.filter((m) => p.kinds[m.kind].total > 0).map((m) => {
          const counts = p.kinds[m.kind];
          const Icon = kindIcon[m.kind];
          return (
            <span key={m.kind} className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <Icon width={14} height={14} strokeWidth={2.2} className={m.icon} />
              <span className="flex h-1 w-7 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
                <span className={m.bar} style={{ width: `${(counts.done / counts.total) * 100}%` }} />
                <span className="bg-ordered" style={{ width: `${(counts.ordered / counts.total) * 100}%` }} />
              </span>
              <span className="sr-only">{m.label}:</span>
              {counts.done}/{counts.total}
            </span>
          );
        })}
        {p.dueDate && <span className={`ml-auto text-xs font-medium whitespace-nowrap ${dueToneClass[dueTone(p.dueDate)]}`}>{formatDue(p.dueDate)}</span>}
      </div>
    </a>
  );
}

function ProjectRow({ project: p, href, onClick }: { project: ProjectSummary; href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <a href={href} onClick={onClick} className="flex min-h-11 items-center gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-2.5 hover:border-line-strong">
      <ProjectTile project={p} size={32} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.title}</span>
      <span className="text-xs whitespace-nowrap text-muted">
        {p.progress.total} {p.progress.total === 1 ? 'item' : 'items'} · {PRIORITY_META[p.priority]?.short}
      </span>
    </a>
  );
}
