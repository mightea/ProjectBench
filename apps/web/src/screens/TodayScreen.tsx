import type { Agenda, ItemWithContext, ProjectSummary } from '@projectbench/core/schemas';
import { PriorityBadge, ProgressBar, progressLabel } from '../components/bits.tsx';
import { SettingsIcon } from '../components/icons.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { dueTone, dueToneClass, formatDue, KIND_META } from '../lib/format.ts';
import { useAgenda, useBuyOverview } from '../lib/queries.ts';
import { useTagFilter } from '../useRoute.ts';
import { appLink, DailyItem, type Navigate } from './DailyItem.tsx';

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/** An ordered item can be both due and expected; it is listed once, under its earlier date. */
function mergeItems(due: ItemWithContext[], deliveries: ItemWithContext[]) {
  const dateOf = (i: ItemWithContext) => [i.dueDate, i.expectedDate].filter((d): d is string => d !== null).sort()[0]!;
  const unique = new Map([...deliveries, ...due].map((i) => [i.id, i]));
  return [...unique.values()].sort((a, b) => dateOf(a).localeCompare(dateOf(b))).map((item) => ({ item, date: dateOf(item) }));
}

export function TodayScreen({ navigate }: { navigate: Navigate }) {
  const [tag, setTag] = useTagFilter();
  const agenda = useAgenda(tag);
  const buy = useBuyOverview(tag);
  const toBuy = buy.data?.byShop.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <header className="flex items-end justify-between px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-muted">{longDate.format(new Date())}</span>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Today</h1>
        </div>
        <a {...appLink('/settings', navigate)} aria-label="Settings" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface md:hidden">
          <SettingsIcon width={20} height={20} />
        </a>
      </header>
      <div className="px-5 pb-3 md:px-8">
        <TagFilter value={tag} onChange={setTag} />
      </div>
      <main className="flex flex-1 flex-col gap-5 px-4 pb-28 md:px-8 md:pb-10">
        {agenda.data ? <AgendaView agenda={agenda.data} toBuy={toBuy} tag={tag} navigate={navigate} /> : <QueryFallback query={agenda} />}
      </main>
    </>
  );
}

function AgendaView({ agenda: a, toBuy, tag, navigate }: { agenda: Agenda; toBuy: number | undefined; tag: string | null; navigate: Navigate }) {
  const overdue = mergeItems(a.overdueItems, a.lateDeliveries);
  const overdueIds = new Set(overdue.map((o) => o.item.id));
  const week = mergeItems(a.upcomingItems, a.upcomingDeliveries).filter((w) => !overdueIds.has(w.item.id));
  const overdueCount = overdue.length + a.overdueProjects.length;
  const weekCount = week.length + a.upcomingProjects.length;
  const nothing = overdueCount + weekCount + a.urgentProjects.length === 0;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-3">
        <Stat value={overdueCount} label="Overdue" danger={overdueCount > 0} />
        <Stat value={weekCount} label="This week" />
        <Stat value={a.openQuestions.length} label="To clarify" />
        <div className="hidden md:block">
          <Stat value={toBuy ?? '–'} label="To buy" />
        </div>
      </div>

      {nothing && (
        <p className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-muted">
          {tag ? `Nothing due this week for #${tag}.` : 'Nothing due this week and no urgent projects.'}
        </p>
      )}

      <div className={`grid gap-5 lg:items-start ${overdueCount + weekCount > 0 && a.urgentProjects.length > 0 ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
      {overdueCount + weekCount > 0 && (
      <div className="flex min-w-0 flex-col gap-5">
      {overdueCount > 0 && (
        <Section title="Overdue" danger>
          {overdue.map(({ item, date }) => (
            <AgendaItem key={item.id} item={item} date={date} navigate={navigate} />
          ))}
          {a.overdueProjects.map((p) => (
            <ProjectRow key={p.id} project={p} navigate={navigate} />
          ))}
        </Section>
      )}

      {weekCount > 0 && (
        <Section title="Next 7 days">
          {week.map(({ item, date }) => (
            <AgendaItem key={item.id} item={item} date={date} navigate={navigate} />
          ))}
          {a.upcomingProjects.map((p) => (
            <ProjectRow key={p.id} project={p} navigate={navigate} />
          ))}
        </Section>
      )}
      </div>
      )}

      {a.urgentProjects.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>Urgent projects</SectionTitle>
          <div className={`grid grid-cols-2 gap-2.5 ${overdueCount + weekCount > 0 ? 'lg:grid-cols-1' : 'lg:grid-cols-3 xl:grid-cols-4'}`}>
            {a.urgentProjects.map((p) => (
              <a key={p.id} {...appLink(`/projects/${p.id}`, navigate)} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 hover:border-line-strong">
                <span className="flex items-center justify-between gap-2">
                  <PriorityBadge priority={p.priority} />
                  {p.dueDate && <span className={`text-xs whitespace-nowrap ${dueToneClass[dueTone(p.dueDate)]}`}>{formatDue(p.dueDate)}</span>}
                </span>
                <span className="text-[15px] leading-tight font-semibold">{p.title}</span>
                <span className="mt-auto flex flex-col gap-1.5">
                  <ProgressBar progress={p.progress} />
                  <span className="text-xs text-muted">{progressLabel(p.progress)}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      </div>
    </>
  );
}

function Stat({ value, label, danger = false }: { value: number | string; label: string; danger?: boolean }) {
  return (
    <div className={`flex h-full flex-col gap-0.5 rounded-xl px-3 py-2.5 ${danger ? 'bg-danger-soft' : 'border border-line bg-surface'}`}>
      <span className={`font-display text-[22px] font-semibold ${danger ? 'text-danger' : ''}`}>{value}</span>
      <span className={`text-xs font-medium ${danger ? 'text-danger-ink' : 'text-muted'}`}>{label}</span>
    </div>
  );
}

function SectionTitle({ children, danger = false }: { children: string; danger?: boolean }) {
  return <h2 className={`mx-1 text-[13px] font-semibold tracking-[0.06em] uppercase ${danger ? 'text-danger' : 'text-muted'}`}>{children}</h2>;
}

function Section({ title, danger = false, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle danger={danger}>{title}</SectionTitle>
      <ul className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</ul>
    </section>
  );
}

function AgendaItem({ item, date, navigate }: { item: ItemWithContext; date: string; navigate: Navigate }) {
  const label = item.state === 'ordered' ? 'On the way' : KIND_META[item.checklistKind].label;
  return (
    <DailyItem
      item={item}
      navigate={navigate}
      meta={`${label} · ${item.projectTitle}`}
      trailing={<span className={`text-xs font-semibold whitespace-nowrap ${dueToneClass[dueTone(date)]}`}>{formatDue(date)}</span>}
    />
  );
}

function ProjectRow({ project: p, navigate }: { project: ProjectSummary; navigate: Navigate }) {
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <a {...appLink(`/projects/${p.id}`, navigate)} className="flex min-h-14 items-center gap-3 px-3.5 py-2 hover:bg-ground">
        <PriorityBadge priority={p.priority} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-medium">{p.title}</span>
          <span className="text-xs text-muted">Project · {progressLabel(p.progress)}</span>
        </span>
        {p.dueDate && <span className={`text-xs font-semibold whitespace-nowrap ${dueToneClass[dueTone(p.dueDate)]}`}>{formatDue(p.dueDate)}</span>}
      </a>
    </li>
  );
}
