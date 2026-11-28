import type { ProjectStatus, ProjectSummary } from '@projectbench/core/schemas';
import { useId, useState, type ComponentType, type MouseEvent, type ReactNode, type SVGProps } from 'react';
import {
  BoltIcon,
  BoxIcon,
  CalendarIcon,
  CartIcon,
  CheckIcon,
  FilterIcon,
  FlagIcon,
  kindIcon,
  PlusIcon,
  QuestionIcon,
  SearchIcon,
  SettingsIcon,
  SubprojectIcon,
} from '../components/icons.tsx';
import { ProgressRing } from '../components/ProgressRing.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { dayAndMonth, daysUntil, dueTone, formatDue, PRIORITY_META, STATUS_META, type DueTone } from '../lib/format.ts';
import { lookStyle, projectColor } from '../lib/look.ts';
import { useProjects } from '../lib/queries.ts';
import { SubprojectRows } from '../project/Subprojects.tsx';
import { useTagFilter } from '../useRoute.ts';
import { NewProjectSheet } from './NewProjectSheet.tsx';

/** `column` places the section on the wide status board, where Waiting comes after Ideas. */
const SECTIONS: { status: ProjectStatus; label: string; column: string }[] = [
  { status: 'active', label: 'Active', column: '2xl:order-1' },
  { status: 'waiting', label: 'Waiting', column: '2xl:order-4' },
  { status: 'planned', label: 'Planned', column: '2xl:order-2' },
  { status: 'idea', label: 'Ideas', column: '2xl:order-3' },
  { status: 'done', label: 'Done', column: '2xl:order-5' },
  { status: 'archived', label: 'Archived', column: '2xl:order-6' },
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
  const [layout, setLayout] = useState<'board' | 'grid'>('grid');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  const board = layout === 'board';
  const [tag, setTag] = useTagFilter();
  const status = showDone || showArchived ? 'all' : 'open';
  const projects = useProjects({ status, sort, q: q.trim() || undefined, tag: tag ?? undefined });
  // The strip and the side rail describe every open project, whatever is filtered below.
  const open = useProjects({ status: 'open', sort: 'priority' });
  const visible = projects.data?.filter((p) => (p.status !== 'done' || showDone) && (p.status !== 'archived' || showArchived));
  // Sub-projects sit inside their parent's card; they stand on their own only when the parent isn't shown.
  const visibleIds = new Set(visible?.map((p) => p.id));
  const childrenOf = new Map<string, ProjectSummary[]>();
  for (const p of visible ?? []) {
    if (p.parentId && visibleIds.has(p.parentId)) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
  }
  const shown = visible?.filter((p) => (!p.parentId || !visibleIds.has(p.parentId)) && (!statusFilter || p.status === statusFilter));
  const filtered = Boolean(q || tag || showDone || showArchived || statusFilter);
  const countOf = (s: ProjectStatus) => visible?.filter((p) => p.status === s).length ?? 0;
  const hasRail = Boolean(open.data?.some((p) => p.dueDate || p.nextItemDue || p.kinds.clarify.total > p.kinds.clarify.done));
  let cardIndex = 0;

  const follow = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(`/projects/${id}`);
  };

  return (
    <>
      <header className="flex flex-col gap-3 px-5 pt-5 pb-2 md:px-8 md:pt-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3.5">
            <h1 className="font-display text-[32px] font-semibold tracking-tight">Projects</h1>
            {visible && <span className="hidden text-sm text-muted xl:inline">{visible.length} shown</span>}
          </div>
          <div className="flex items-center gap-2">
            <label className="hidden h-11 w-65 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-muted xl:flex">
              <SearchIcon width={16} height={16} />
              <span className="sr-only">Filter projects</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
            </label>
            <div role="group" aria-label="Layout" className="hidden rounded-[10px] bg-line p-[3px] 2xl:flex">
              {(['grid', 'board'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  onClick={() => setLayout(l)}
                  className={`h-[38px] rounded-lg px-3 text-[13px] font-semibold transition-colors ${layout === l ? 'bg-surface shadow-sm' : 'text-ink-soft'}`}
                >
                  {l === 'grid' ? 'Cards' : 'Board'}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Search projects"
              aria-pressed={searching}
              onClick={() => {
                if (searching) setQ('');
                setSearching(!searching);
              }}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-surface xl:hidden"
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
          <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-muted md:max-w-md xl:hidden">
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
        {!!open.data?.length && <Pulse projects={open.data} navigate={navigate} onActive={() => setStatusFilter(statusFilter === 'active' ? null : 'active')} />}
        {!!visible?.length && (
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Filter by status" className="-mx-5 flex min-w-0 flex-1 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              <button
                type="button"
                aria-pressed={statusFilter === null}
                onClick={() => setStatusFilter(null)}
                className={`h-11 shrink-0 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors ${
                  statusFilter === null ? 'bg-ink font-semibold text-surface' : 'border border-line bg-surface font-medium text-ink-soft hover:border-line-strong'
                }`}
              >
                All · {visible.length}
              </button>
              {SECTIONS.filter((s) => countOf(s.status) > 0 || statusFilter === s.status).map((s) => (
                <button
                  key={s.status}
                  type="button"
                  aria-pressed={statusFilter === s.status}
                  onClick={() => setStatusFilter(statusFilter === s.status ? null : s.status)}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors ${
                    statusFilter === s.status ? 'bg-ink font-semibold text-surface' : 'border border-line bg-surface font-medium text-ink-soft hover:border-line-strong'
                  }`}
                >
                  <span className={`size-2 rounded-full ${STATUS_META[s.status].dot}`} aria-hidden="true" />
                  {s.label}
                  <span className={statusFilter === s.status ? 'opacity-75' : 'text-muted'}>{countOf(s.status)}</span>
                </button>
              ))}
            </div>
            <label className="hidden h-11 shrink-0 items-center gap-1.5 self-start rounded-xl border border-line bg-surface pr-1.5 pl-3 text-[13px] text-ink-soft md:flex">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-lg bg-transparent pr-1 font-semibold text-ink">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <TagFilter value={tag} onChange={setTag} />
      </header>

      <div className="flex flex-1 items-start gap-6 px-4 pt-1 pb-32 md:px-8 md:pb-10">
      <main
        className={`flex min-w-0 flex-1 flex-col gap-2.5 ${
          board && shown?.length ? '2xl:grid 2xl:flex-none 2xl:auto-cols-[minmax(0,1fr)] 2xl:grid-flow-col 2xl:items-start 2xl:gap-4' : ''
        }`}
      >
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
          SECTIONS.map(({ status: s, label, column }) => {
            const members = shown.filter((p) => p.status === s);
            // The board keeps its Waiting column even when nothing is waiting.
            const emptyColumn = members.length === 0 && s === 'waiting' && board && !filtered;
            if (members.length === 0 && !emptyColumn) return null;
            const compact = s === 'idea' || s === 'archived';
            return (
              <section
                key={s}
                className={`flex-col gap-2.5 ${emptyColumn ? 'hidden 2xl:flex' : 'flex'} ${board ? `${column} 2xl:rounded-2xl 2xl:bg-line-soft 2xl:p-3` : ''}`}
                aria-labelledby={`section-${s}`}
              >
                <h2 id={`section-${s}`} className="mx-1 mt-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
                  <span className={`size-2 rounded-full ${STATUS_META[s].dot}`} aria-hidden="true" />
                  {label} · {members.length}
                </h2>
                {emptyColumn ? (
                  <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-5 text-center text-[13px] leading-snug text-muted">Projects waiting on someone else show up here.</p>
                ) : (
                  <ul className={`grid gap-3 md:grid-cols-2 ${hasRail ? '2xl:grid-cols-3' : 'xl:grid-cols-3'} ${board ? '2xl:grid-cols-1' : ''}`}>
                    {members.map((p) => {
                      const subs = childrenOf.get(p.id) ?? [];
                      const card = (
                        <ProjectCard project={p} href={`/projects/${p.id}`} onClick={follow(p.id)} index={cardIndex++}>
                          {subs.length > 0 && <SubprojectRows projects={subs} parentStatus={p.status} navigate={navigate} />}
                        </ProjectCard>
                      );
                      return (
                        <li key={p.id}>
                          {compact ? (
                            <>
                              {/* Ideas and archived projects stay one line on a phone. */}
                              <div className="md:hidden">
                                <ProjectRow project={p} subprojects={subs.length} href={`/projects/${p.id}`} onClick={follow(p.id)} />
                              </div>
                              <div className="hidden h-full md:block">{card}</div>
                            </>
                          ) : (
                            card
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </main>
      {hasRail && open.data && <Rail projects={open.data} navigate={navigate} className={board ? '2xl:hidden' : ''} />}
      </div>

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

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** What matters most about the parts: on the way, then still to buy, then all in. */
function buyBadge({ kinds: { buy } }: ProjectSummary) {
  if (buy.total === 0) return null;
  if (buy.ordered > 0) return { text: `${buy.ordered} on the way`, Icon: BoxIcon, className: 'bg-warning-soft text-warning-ink' };
  const open = buy.total - buy.done;
  if (open > 0) return { text: `${open} to buy`, Icon: CartIcon, className: 'bg-accent-soft text-accent-ink' };
  return { text: 'All parts in', Icon: CheckIcon, className: 'bg-success-soft text-success' };
}

const dueChipClass: Record<DueTone, string> = {
  overdue: 'bg-danger-soft text-danger',
  soon: 'bg-warning-soft text-warning-ink',
  normal: 'bg-line-soft text-ink-soft',
};

const openQuestions = (p: ProjectSummary) => p.kinds.clarify.total - p.kinds.clarify.done;

function NextLine({ project: p }: { project: ProjectSummary }) {
  const questions = openQuestions(p);
  if (p.status === 'planned' && questions > 0) {
    return (
      <p className="line-clamp-2 text-sm leading-snug text-ink-soft">
        <span className="font-semibold text-warning-ink">
          Blocked by {questions} {questions === 1 ? 'question' : 'questions'}
        </span>
        {p.nextStep && ` · ${p.nextStep.text}`}
      </p>
    );
  }
  if (!p.nextStep) return null;
  return (
    <p className="line-clamp-2 text-sm leading-snug text-ink-soft">
      <span className="font-semibold text-ink">Next</span> {p.nextStep.text}
    </p>
  );
}

interface CardProps {
  project: ProjectSummary;
  href: string;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Position on the page, which staggers the entrance. */
  index?: number;
  /** Sub-projects, shown below the card's own content. */
  children?: ReactNode;
}

function ProjectCard({ project: p, href, onClick, index = 0, children }: CardProps) {
  const badge = buyBadge(p);
  const tags = tagLine(p.tags);
  const meters = METERS.filter((m) => p.kinds[m.kind].total > 0);
  return (
    <div
      style={{ ...lookStyle(projectColor(p)), animationDelay: `${Math.min(index, 8) * 60}ms` }}
      className="flex h-full animate-rise flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-(--look) hover:shadow-lift"
    >
      <a href={href} onClick={onClick} className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 bg-(--look-soft) py-3 pr-3 pl-3.5">
          <ProjectTile project={p} size={44} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base leading-snug font-semibold">{p.title}</span>
            {p.parentTitle ? (
              <span className="flex items-center gap-1 text-xs font-medium text-(--look-ink)">
                <SubprojectIcon width={12} height={12} className="shrink-0" />
                <span className="truncate">Sub-project of {p.parentTitle}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-(--look-ink)">
                <FlagIcon width={12} height={12} className="shrink-0" />
                {PRIORITY_META[p.priority]?.short} · {PRIORITY_META[p.priority]?.label}
              </span>
            )}
          </span>
          {p.progress.total > 0 && <ProgressRing progress={p.progress} size={46} track="stroke-surface" />}
        </div>
        <div className="flex flex-1 flex-col gap-3 px-3.5 pt-3 pb-3.5">
          <NextLine project={p} />
          {meters.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {meters.map((m) => {
                const counts = p.kinds[m.kind];
                const Icon = kindIcon[m.kind];
                return (
                  <span key={m.kind} className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-center gap-1 text-xs font-semibold text-ink-soft">
                      <Icon width={14} height={14} strokeWidth={2.2} className={`shrink-0 ${m.icon}`} />
                      <span className="truncate">{m.label}</span>
                      <span className="ml-auto font-medium text-muted tabular-nums">
                        {counts.done}/{counts.total}
                      </span>
                    </span>
                    <span className="flex h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
                      <span className={`meter-fill ${m.bar}`} style={{ width: `${(counts.done / counts.total) * 100}%` }} />
                      <span className="meter-fill bg-ordered" style={{ width: `${(counts.ordered / counts.total) * 100}%` }} />
                    </span>
                  </span>
                );
              })}
            </div>
          )}
          {(p.dueDate || badge || tags) && (
            <div className="mt-auto flex flex-wrap items-center gap-1.5">
              {p.dueDate && (
                <span className={`flex h-[26px] items-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap ${dueChipClass[dueTone(p.dueDate)]}`}>
                  <CalendarIcon width={13} height={13} strokeWidth={2.2} />
                  {formatDue(p.dueDate)}
                </span>
              )}
              {badge && (
                <span className={`flex h-[26px] items-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap ${badge.className}`}>
                  <badge.Icon width={13} height={13} strokeWidth={2.2} />
                  {badge.text}
                </span>
              )}
              {tags && <span className="ml-auto truncate text-xs text-muted">{tags}</span>}
            </div>
          )}
        </div>
      </a>
      {children}
    </div>
  );
}

function ProjectRow({ project: p, subprojects, href, onClick }: Omit<CardProps, 'children' | 'index'> & { subprojects: number }) {
  return (
    <a
      href={href}
      onClick={onClick}
      style={lookStyle(projectColor(p))}
      className="flex min-h-15 animate-rise items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2 transition-transform active:scale-[0.98]"
    >
      <ProjectTile project={p} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold">{p.title}</span>
        <span className="truncate text-xs text-muted">
          {subprojects > 0 && `${subprojects} sub · `}
          {p.progress.total} {p.progress.total === 1 ? 'item' : 'items'} · {PRIORITY_META[p.priority]?.short}
        </span>
      </span>
      {p.progress.total > 0 && <ProgressRing progress={p.progress} size={36} />}
    </a>
  );
}

/** Four numbers about every open project. Each tile leads to where that number is worked on. */
function Pulse({ projects, navigate, onActive }: { projects: ProjectSummary[]; navigate: (to: string) => void; onActive: () => void }) {
  const count = (s: ProjectStatus) => projects.filter((p) => p.status === s).length;
  const waitingInLine = [
    [count('planned'), 'planned'],
    [count('idea'), count('idea') === 1 ? 'idea' : 'ideas'],
    [count('waiting'), 'waiting'],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ');
  const due = projects.filter((p) => p.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const ordered = projects.filter((p) => p.kinds.buy.ordered > 0).sort((a, b) => b.kinds.buy.ordered - a.kinds.buy.ordered);
  const orderedCount = ordered.reduce((n, p) => n + p.kinds.buy.ordered, 0);
  const asking = projects.filter((p) => openQuestions(p) > 0).sort((a, b) => openQuestions(b) - openQuestions(a));
  const questionCount = asking.reduce((n, p) => n + openQuestions(p), 0);
  const nextDue = due[0];
  const dueClass = nextDue ? { overdue: 'bg-danger-soft text-danger', soon: 'bg-warning-soft text-warning-ink', normal: 'bg-line-soft text-ink-soft' }[dueTone(nextDue.dueDate!)] : 'bg-line-soft text-ink-soft';

  return (
    <section aria-label="Across all open projects" className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
      <PulseTile Icon={BoltIcon} iconClass="bg-success-soft text-success" label="In progress" value={count('active')} unit="active" detail={waitingInLine || 'Nothing else in line'} onClick={onActive} index={0} />
      <PulseTile
        Icon={CalendarIcon}
        iconClass={dueClass}
        label="Next due"
        value={nextDue ? formatDue(nextDue.dueDate!) : '–'}
        detail={nextDue ? [nextDue.title, due[1] && `then ${due[1].title}`].filter(Boolean).join(' · ') : 'No due dates set'}
        onClick={nextDue ? () => navigate(`/projects/${nextDue.id}`) : undefined}
        index={1}
      />
      <PulseTile
        Icon={BoxIcon}
        iconClass="bg-warning-soft text-warning-ink"
        label="On the way"
        value={orderedCount}
        unit={orderedCount === 1 ? 'part' : 'parts'}
        detail={ordered.length ? ordered.slice(0, 2).map((p) => `${p.title} ${p.kinds.buy.ordered}`).join(' · ') : 'Nothing ordered'}
        onClick={() => navigate('/buy')}
        live={orderedCount > 0}
        index={2}
      />
      <PulseTile
        Icon={QuestionIcon}
        iconClass="bg-accent-soft text-accent-ink"
        label="Open questions"
        value={questionCount}
        unit="to clarify"
        detail={asking[0] ? `${openQuestions(asking[0])} in ${asking[0].title}` : 'Nothing to clarify'}
        onClick={asking[0] ? () => navigate(`/projects/${asking[0]!.id}`) : undefined}
        index={3}
      />
    </section>
  );
}

interface PulseTileProps {
  Icon: Icon;
  iconClass: string;
  label: string;
  value: number | string;
  unit?: string;
  detail: string;
  onClick?: () => void;
  /** Shows the "on the way" dot. */
  live?: boolean;
  index: number;
}

function PulseTile({ Icon, iconClass, label, value, unit, detail, onClick, live, index }: PulseTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{ animationDelay: `${index * 50}ms` }}
      className="flex min-h-16 animate-rise items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left shadow-card transition duration-200 enabled:hover:-translate-y-0.5 enabled:hover:border-line-strong enabled:active:scale-[0.98] lg:p-4"
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] lg:size-10 ${iconClass}`}>
        <Icon width={18} height={18} strokeWidth={2.2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className="truncate">{label}</span>
          {live && <span className="ping-dot" aria-hidden="true" />}
        </span>
        <span className="truncate font-display text-xl leading-tight font-semibold lg:text-2xl">
          {value}
          {unit && <span className="font-sans text-[13px] font-medium text-muted"> {unit}</span>}
        </span>
        <span className="hidden truncate text-xs text-muted lg:block">{detail}</span>
      </span>
    </button>
  );
}

/** Dates and questions across the open projects, beside the cards on a wide screen. */
function Rail({ projects, navigate, className = '' }: { projects: ProjectSummary[]; navigate: (to: string) => void; className?: string }) {
  const dates = projects
    .flatMap((p) => [
      ...(p.dueDate ? [{ date: p.dueDate, project: p, what: 'Project due' }] : []),
      ...(p.nextItemDue && p.nextItemDue !== p.dueDate ? [{ date: p.nextItemDue, project: p, what: 'Next item due' }] : []),
    ])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);
  const asking = projects
    .filter((p) => openQuestions(p) > 0)
    .sort((a, b) => openQuestions(b) - openQuestions(a))
    .slice(0, 6);
  const most = asking[0] ? openQuestions(asking[0]) : 1;
  const go = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(`/projects/${id}`);
  };
  const card = 'flex animate-rise flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-card';
  const title = 'text-[13px] font-semibold tracking-[0.06em] text-muted uppercase';

  return (
    <aside aria-label="At a glance" className={`mt-9 hidden w-80 shrink-0 flex-col gap-4 xl:flex ${className}`}>
      {dates.length > 0 && (
        <section aria-labelledby="rail-dates" className={card} style={{ animationDelay: '200ms' }}>
          <h2 id="rail-dates" className={title}>
            Coming up
          </h2>
          <ol className="flex flex-col gap-1">
            {dates.map(({ date, project: p, what }) => {
              const { day, month } = dayAndMonth(date);
              const days = daysUntil(date);
              const when = days < 0 ? `${-days} ${days === -1 ? 'day' : 'days'} late` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
              return (
                <li key={`${p.id}-${what}`}>
                  <a href={`/projects/${p.id}`} onClick={go(p.id)} className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-ground">
                    <span className={`flex size-11 shrink-0 flex-col items-center justify-center rounded-xl ${dueChipClass[dueTone(date)]}`}>
                      <span className="text-[10px] leading-none font-bold tracking-[0.06em] uppercase">{month}</span>
                      <span className="font-display text-[17px] leading-tight font-semibold">{day}</span>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{p.title}</span>
                      <span className="truncate text-xs text-muted">
                        {what} · {when}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {asking.length > 0 && (
        <section aria-labelledby="rail-questions" className={card} style={{ animationDelay: '260ms' }}>
          <h2 id="rail-questions" className={title}>
            Open questions by project
          </h2>
          <ul className="flex flex-col">
            {asking.map((p) => (
              <li key={p.id}>
                <a
                  href={`/projects/${p.id}`}
                  onClick={go(p.id)}
                  style={lookStyle(projectColor(p))}
                  className="-mx-2 grid min-h-9 grid-cols-[7.5rem_minmax(0,1fr)_1.25rem] items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-ground"
                >
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="flex h-2 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
                    <span className="meter-fill rounded-full bg-(--look)" style={{ width: `${(openQuestions(p) / most) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{openQuestions(p)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
