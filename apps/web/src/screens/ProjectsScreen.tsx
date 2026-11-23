import type { ProjectSummary } from '@projectbench/core/schemas';
import { useState, type MouseEvent } from 'react';
import { PriorityBadge, ProgressBar } from '../components/bits.tsx';
import { PlusIcon, SearchIcon, SettingsIcon } from '../components/icons.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { dueTone, dueToneClass, formatDue, STATUS_META } from '../lib/format.ts';
import { useProjects } from '../lib/queries.ts';
import { NewProjectSheet } from './NewProjectSheet.tsx';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'idea', label: 'Ideas' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

const SORTS = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'updated', label: 'Recently changed' },
];

export function ProjectsScreen({ navigate }: { navigate: (to: string) => void }) {
  const [status, setStatus] = useState('open');
  const [sort, setSort] = useState('priority');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const projects = useProjects({ status, sort, q: q.trim() || undefined });

  const open = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(`/projects/${id}`);
  };

  return (
    <>
      <header className="flex flex-col gap-3.5 px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Projects</h1>
          <div className="flex items-center gap-2">
            <a
              href="/settings"
              aria-label="Settings"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                navigate('/settings');
              }}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-surface md:hidden"
            >
              <SettingsIcon width={20} height={20} />
            </a>
            <label className="sr-only" htmlFor="sort">
              Sort by
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-9 rounded-full border border-line bg-surface px-3 text-[13px] font-medium"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="hidden h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-strong md:flex"
            >
              <PlusIcon width={16} height={16} />
              New project
            </button>
          </div>
        </div>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-muted md:max-w-md">
          <SearchIcon width={18} height={18} />
          <span className="sr-only">Filter projects by title</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by title"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none"
          />
        </label>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] whitespace-nowrap ${
                status === f.value ? 'bg-ink font-semibold text-white' : 'border border-line bg-surface font-medium'
              }`}
            >
              {f.label}
              {status === f.value && projects.data ? ` · ${projects.data.length}` : ''}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 pb-32 md:px-8 md:pb-10">
        {!projects.data ? (
          <QueryFallback query={projects} />
        ) : projects.data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
            <p className="font-semibold">{q || status !== 'open' ? 'No matching projects' : 'No projects yet'}</p>
            <p className="max-w-sm text-sm text-muted">
              {q || status !== 'open' ? 'Try another filter.' : 'Start with the project that’s on your bench right now.'}
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
          <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {projects.data.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} href={`/projects/${p.id}`} onClick={open(p.id)} />
              </li>
            ))}
          </ul>
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

      {creating && (
        <NewProjectSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/projects/${id}`);
          }}
        />
      )}
    </>
  );
}

function ProjectCard({ project: p, href, onClick }: { project: ProjectSummary; href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const status = STATUS_META[p.status];
  const due = p.dueDate;
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 hover:border-[#C9CDD6]"
    >
      <div className="flex items-center gap-2">
        <PriorityBadge priority={p.priority} />
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span className={`size-2 rounded-full ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>
        {due && (
          <span className={`ml-auto text-xs font-medium whitespace-nowrap ${dueToneClass[dueTone(due)]}`}>
            {formatDue(due)}
          </span>
        )}
      </div>
      <span className="text-base leading-snug font-semibold">{p.title}</span>
      <div className="mt-auto flex items-center gap-2.5">
        <ProgressBar progress={p.progress} className="h-1.5 flex-1" />
        <span className="text-xs whitespace-nowrap text-muted">
          {p.progress.total ? `${p.progress.done} / ${p.progress.total}` : 'Empty'}
        </span>
      </div>
      {p.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {p.tags.map((t) => (
            <span key={t} className="text-xs text-muted">
              #{t}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}
