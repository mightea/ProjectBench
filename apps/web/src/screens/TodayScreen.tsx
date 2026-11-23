import type { Agenda, BuyOverview, ItemWithContext, ProjectSummary } from '@projectbench/core/schemas';
import { PriorityBadge, ProgressBar, progressLabel } from '../components/bits.tsx';
import { CalendarIcon, CheckIcon, ChevronRightIcon, SettingsIcon } from '../components/icons.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { groupOrders, type Order, orderAmount } from '../lib/buy.ts';
import { dueTone, dueToneClass, formatDue, KIND_META } from '../lib/format.ts';
import { useAgenda, useBuyOverview, useItemState, useMarkReceived, useProjects } from '../lib/queries.ts';
import { StateMark } from '../project/ItemRow.tsx';
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
  const projects = useProjects({ status: 'open', sort: 'priority', tag: tag ?? undefined });

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
      <main className="flex flex-1 flex-col gap-[18px] px-4 pb-28 md:px-8 md:pb-10">
        {agenda.data ? <AgendaView agenda={agenda.data} buy={buy.data} projects={projects.data ?? []} tag={tag} navigate={navigate} /> : <QueryFallback query={agenda} />}
      </main>
    </>
  );
}

interface AgendaProps {
  agenda: Agenda;
  buy: BuyOverview | undefined;
  projects: ProjectSummary[];
  tag: string | null;
  navigate: Navigate;
}

function AgendaView({ agenda: a, buy, projects, tag, navigate }: AgendaProps) {
  const overdue = mergeItems(a.overdueItems, a.lateDeliveries);
  const overdueIds = new Set(overdue.map((o) => o.item.id));
  const week = mergeItems(a.upcomingItems, a.upcomingDeliveries).filter((w) => !overdueIds.has(w.item.id));
  const overdueCount = overdue.length + a.overdueProjects.length;
  const weekCount = week.length + a.upcomingProjects.length;
  const toBuy = buy?.byShop.reduce((n, g) => n + g.items.length, 0);
  const nextSteps = projects.filter((p) => p.status === 'active' && p.nextStep);
  const blocked = projects.filter((p) => p.status === 'planned' && p.kinds.clarify.total > p.kinds.clarify.done);

  return (
    <>
      <div className="grid grid-cols-3 gap-2 md:gap-3 xl:grid-cols-4 2xl:grid-cols-5">
        <Stat value={buy?.ordered.length ?? '–'} label="On the way" to="/buy" navigate={navigate} warn={(buy?.ordered.length ?? 0) > 0} />
        <Stat value={toBuy ?? '–'} label="To buy" to="/buy" navigate={navigate} />
        <Stat value={a.openQuestions.length} label="To clarify" to="/projects" navigate={navigate} />
        <Stat value={overdueCount} label="Overdue" to="/today" navigate={navigate} display="hidden xl:flex" />
        <Stat value={projects.filter((p) => p.status === 'active').length} label="Active projects" to="/projects" navigate={navigate} display="hidden 2xl:flex" />
      </div>

      {overdueCount + weekCount === 0 && (
        <p className="mx-1 flex items-center gap-1.5 text-[13px] text-muted">
          <CheckIcon width={16} height={16} className="text-success" />
          {tag ? `Nothing overdue or due this week for #${tag}.` : 'Nothing overdue or due this week.'}
        </p>
      )}

      <div className="grid gap-[18px] lg:grid-cols-2 lg:items-start xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-[18px] xl:col-start-1 xl:row-start-1">
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

          {nextSteps.length > 0 && (
            <Section title="Up next in your projects">
              {nextSteps.map((p) => (
                <NextStepRow key={p.id} project={p} navigate={navigate} />
              ))}
            </Section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[18px] xl:col-start-2 xl:row-span-2 xl:row-start-1 2xl:row-span-1">
          {buy && buy.ordered.length > 0 && <Deliveries items={buy.ordered} projects={projects} navigate={navigate} />}

          {blocked.length > 0 && (
            <section className="flex flex-col gap-2 xl:hidden">
              <SectionTitle>Questions blocking work</SectionTitle>
              <div className="flex flex-col gap-2">
                {blocked.map((p) => {
                  const questions = p.kinds.clarify.total - p.kinds.clarify.done;
                  return (
                    <a key={p.id} {...appLink(`/projects/${p.id}`, navigate)} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 hover:border-line-strong">
                      <ProjectTile project={p} size={36} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[15px] font-semibold">{p.title}</span>
                        <span className="text-xs text-muted">
                          {questions} {questions === 1 ? 'question' : 'questions'} before work can start
                        </span>
                      </span>
                      <ChevronRightIcon width={18} height={18} className="text-muted" />
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {a.urgentProjects.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionTitle>Urgent projects</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                {a.urgentProjects.map((p) => (
                  <a key={p.id} {...appLink(`/projects/${p.id}`, navigate)} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 hover:border-line-strong">
                    <span className="flex items-center justify-between gap-2">
                      <ProjectTile project={p} size={28} />
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

        {a.openQuestions.length > 0 && <OpenQuestions items={a.openQuestions} projects={projects} navigate={navigate} />}
      </div>
    </>
  );
}

/** Wide screens only: open questions per project, with the first one to answer. */
function OpenQuestions({ items, projects, navigate }: { items: ItemWithContext[]; projects: ProjectSummary[]; navigate: Navigate }) {
  const ids = [...new Set(items.map((i) => i.projectId))];
  const groups = ids
    .map((id) => ({ id, members: items.filter((i) => i.projectId === id) }))
    .sort((a, b) => b.members.length - a.members.length);
  return (
    <section className="hidden min-w-0 flex-col gap-2 xl:col-start-1 xl:row-start-2 xl:flex 2xl:col-start-3 2xl:row-start-1">
      <SectionTitle>{`Open questions · ${items.length}`}</SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {groups.map(({ id, members }) => (
          <a key={id} {...appLink(`/projects/${id}`, navigate)} className="flex min-h-14 items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 hover:bg-ground">
            <ProjectTile project={projects.find((p) => p.id === id) ?? { id, color: null }} size={32} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{members[0]!.projectTitle}</span>
              <span className="truncate text-xs text-muted">{members[0]!.text}</span>
            </span>
            <span className="font-display text-lg font-semibold text-warning-ink">{members.length}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  to,
  navigate,
  warn = false,
  display = 'flex',
}: {
  value: number | string;
  label: string;
  to: string;
  navigate: Navigate;
  warn?: boolean;
  display?: string;
}) {
  return (
    <a {...appLink(to, navigate)} className={`${display} h-full min-h-11 flex-col gap-0.5 rounded-xl border border-line bg-surface px-3 py-2.5 hover:border-line-strong`}>
      <span className={`font-display text-[22px] font-semibold ${warn ? 'text-warning-ink' : ''}`}>{value}</span>
      <span className="text-xs font-medium text-muted">{label}</span>
    </a>
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

function NextStepRow({ project: p, navigate }: { project: ProjectSummary; navigate: Navigate }) {
  const change = useItemState();
  const step = p.nextStep!;
  return (
    <li className={`flex items-start gap-0.5 border-b border-line-soft py-1 pr-3.5 pl-1 last:border-b-0 ${change.isPending ? 'opacity-60' : ''}`}>
      <button
        type="button"
        disabled={change.isPending}
        onClick={() => change.mutate({ id: step.id, projectId: p.id, state: 'done' })}
        aria-label={`Mark as done: ${step.text}`}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <StateMark state="open" />
      </button>
      <a {...appLink(`/projects/${p.id}`, navigate)} className="flex min-w-0 flex-1 flex-col gap-1 py-[9px]">
        <span className="text-[15px] leading-snug font-medium">{step.text}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <ProjectTile project={p} size={14} />
          {p.title}
        </span>
        {change.isError && (
          <span role="alert" className="text-xs text-danger">
            {change.error.message}
          </span>
        )}
      </a>
    </li>
  );
}

function Deliveries({ items, projects, navigate }: { items: ItemWithContext[]; projects: ProjectSummary[]; navigate: Navigate }) {
  const orders = groupOrders(items);
  const withoutDate = items.filter((i) => !i.expectedDate).length;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="mx-1 text-[13px] font-semibold tracking-[0.06em] text-warning-ink uppercase">On the way · {items.length}</h2>
        <span className="mr-1 text-xs text-muted">tap to mark received</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {orders.map((order) => (
          <DeliveryRow key={order.key} order={order} projects={projects} />
        ))}
        {withoutDate > 0 && (
          <a {...appLink('/buy', navigate)} className="flex min-h-12 items-center gap-2 bg-warning-soft px-3.5 py-2 text-[13px] font-semibold text-warning-ink">
            <CalendarIcon width={16} height={16} />
            {withoutDate === items.length ? 'No delivery dates yet.' : `${withoutDate} without a delivery date.`} Add them to see arrivals here.
          </a>
        )}
      </div>
    </section>
  );
}

function DeliveryRow({ order, projects }: { order: Order; projects: ProjectSummary[] }) {
  const received = useMarkReceived();
  const { items } = order;
  const first = items[0]!;
  const shop = order.shop ?? 'No shop';
  const projectIds = [...new Set(items.map((i) => i.projectId))];
  const project = projects.find((p) => p.id === first.projectId) ?? { id: first.projectId, color: null };
  const orderedAt = items.map((i) => i.orderedAt).filter((d): d is string => d !== null).sort()[0];
  const details = [
    projectIds.length === 1 ? first.projectTitle : `${projectIds.length} projects`,
    orderedAt && `ordered ${formatDue(orderedAt.slice(0, 10))}`,
    orderAmount(order),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`flex items-center gap-2.5 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 ${received.isPending ? 'opacity-60' : ''}`}>
      <ProjectTile project={project} size={14} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">
          {shop} · {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        <span className="text-xs text-muted">{details}</span>
        {received.isError && (
          <span role="alert" className="text-xs text-danger">
            {received.error.message}
          </span>
        )}
      </span>
      <button
        type="button"
        disabled={received.isPending}
        onClick={() => received.mutate(items.map((i) => ({ id: i.id, projectId: i.projectId })))}
        aria-label={`Mark ${items.length} ${items.length === 1 ? 'item' : 'items'} from ${shop} as received`}
        className="h-11 shrink-0 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-ground"
      >
        Received
      </button>
    </div>
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
        <ProjectTile project={p} size={32} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-medium">{p.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <PriorityBadge priority={p.priority} />
            {progressLabel(p.progress)}
          </span>
        </span>
        {p.dueDate && <span className={`text-xs font-semibold whitespace-nowrap ${dueToneClass[dueTone(p.dueDate)]}`}>{formatDue(p.dueDate)}</span>}
      </a>
    </li>
  );
}
