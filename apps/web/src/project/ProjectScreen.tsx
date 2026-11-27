import type { ProjectDetail } from '@projectbench/core/schemas';
import { useEffect, useState, type MouseEvent } from 'react';
import { ApiError } from '../api.ts';
import { BackIcon, DotsIcon, PencilIcon, PlusIcon, SubprojectIcon } from '../components/icons.tsx';
import { LinkedText } from '../components/LinkedText.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { dueTone, dueToneClass, formatDue, PRIORITY_META, STATUS_META } from '../lib/format.ts';
import { CONTENT_WIDTH, lookStyle, projectColor } from '../lib/look.ts';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { useAttachments, useNotes, useProject, useProjectMutations } from '../lib/queries.ts';
import { NewProjectSheet } from '../screens/NewProjectSheet.tsx';
import { ChecklistCard } from './ChecklistCard.tsx';
import { ChecklistSheet } from './ChecklistSheet.tsx';
import { FilesTab } from './FilesTab.tsx';
import { ItemSheet } from './ItemSheet.tsx';
import { LookSheet } from './LookSheet.tsx';
import { NotesTab } from './NotesTab.tsx';
import { DetailsSheet } from './ProjectDetails.tsx';
import { LatestNote, OverviewTiles, UpNext } from './ProjectOverview.tsx';
import { ParentLink, SubprojectsSection } from './Subprojects.tsx';

/** Tags shown in the header before "+n". */
const HERO_TAGS = 3;
/** Descriptions longer than this are clamped to three lines. */
const LONG_DESCRIPTION = 180;

const TABS = [
  { id: 'checklists', label: 'Checklists' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Panel =
  | { type: 'item'; id: string }
  | { type: 'checklist'; id: string }
  | { type: 'new-checklist' }
  | { type: 'details' }
  | { type: 'look' }
  | { type: 'new-subproject' }
  | { type: 'actions' };

export interface BackLink {
  to: string;
  label: string;
}

export function ProjectScreen({ id, navigate, back }: { id: string; navigate: (to: string) => void; back: BackLink }) {
  const project = useProject(id);

  const missing = project.error instanceof ApiError && project.error.status === 404;
  // Cached data stays on screen when a refresh fails, unless the project is really gone.
  if (project.data && !missing) return <ProjectView project={project.data} navigate={navigate} backLink={back} />;
  if (project.isPending && project.fetchStatus !== 'paused') return <p className="p-6 text-muted">Loading…</p>;
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      {missing ? (
        <p role="alert" className="text-danger">
          This project doesn’t exist (any more).
        </p>
      ) : (
        <QueryFallback query={project} />
      )}
      <a href="/projects" onClick={(e) => (e.preventDefault(), navigate('/projects'))} className="font-semibold text-accent-ink">
        Back to projects
      </a>
    </div>
  );
}

function ProjectView({ project: p, navigate, backLink }: { project: ProjectDetail; navigate: (to: string) => void; backLink: BackLink }) {
  const m = useProjectMutations(p.id);
  const notes = useNotes(p.id);
  const files = useAttachments(p.id);
  const [tab, setTab] = useState<TabId>('checklists');
  // A new project arrives with ?look to choose its color and icon first.
  const [panel, setPanel] = useState<Panel | null>(() => (new URLSearchParams(window.location.search).has('look') ? { type: 'look' } : null));
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const close = () => setPanel(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('look')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    document.title = `${p.title} · ProjectBench`;
    return () => {
      document.title = 'ProjectBench';
    };
  }, [p.title]);

  const jumpTo = (checklistId: string) => {
    setTab('checklists');
    requestAnimationFrame(() => document.getElementById(`${checklistId}-title`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const cover = p.coverAttachmentId ? files.data?.find((a) => a.id === p.coverAttachmentId) : undefined;
  const coverUrl = p.coverAttachmentId ? `/files/${encodeURIComponent(p.coverAttachmentId)}` : null;
  const longDescription = (p.description?.length ?? 0) > LONG_DESCRIPTION || (p.description?.split('\n').length ?? 0) > 3;

  const back = (e: MouseEvent) => {
    e.preventDefault();
    navigate(backLink.to);
  };

  const item = panel?.type === 'item' ? p.checklists.flatMap((c) => c.items).find((i) => i.id === panel.id) : undefined;
  const editing = panel?.type === 'checklist' ? p.checklists.find((c) => c.id === panel.id) : undefined;
  // Matches what UpNext and LatestNote render, so an empty side column never takes up space.
  const hasOpenStep = p.checklists.some((c) => c.kind === 'todo' && c.items.some((i) => i.state === 'open' && !i.id.startsWith('pending-')));
  const hasHighlights = hasOpenStep || Boolean(notes.data?.length);

  return (
    <div className="w-full flex-1" style={lookStyle(projectColor(p))}>
      <header className="bg-(--look-soft) pb-4">
        {coverUrl && (
          <img
            src={`${coverUrl}/thumb`}
            srcSet={cover?.width && cover.width > 480 ? `${coverUrl}/thumb 480w, ${coverUrl} ${cover.width}w` : undefined}
            sizes="100vw"
            alt=""
            className="h-36 w-full object-cover md:h-48"
          />
        )}
        <div className={`mx-auto flex w-full items-center justify-between px-2 pt-2.5 md:px-6 md:pt-5 ${CONTENT_WIDTH}`}>
          <a href={backLink.to} onClick={back} className="flex h-11 items-center gap-1 rounded-full pr-3 pl-1.5 text-[15px] font-medium hover:bg-surface/60">
            <BackIcon width={22} height={22} />
            <span>{backLink.label}</span>
          </a>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPanel({ type: 'look' })} className="hidden h-11 rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] font-semibold md:block">
              Edit look
            </button>
            <button type="button" onClick={() => setPanel({ type: 'details' })} aria-label="Edit project" className="flex size-11 items-center justify-center rounded-full hover:bg-surface/60">
              <PencilIcon width={20} height={20} />
            </button>
            <button type="button" onClick={() => setPanel({ type: 'actions' })} aria-label="More actions" className="flex size-11 items-center justify-center rounded-full hover:bg-surface/60">
              <DotsIcon width={20} height={20} />
            </button>
          </div>
        </div>

        <div className={`mx-auto flex w-full flex-col gap-3 px-5 pt-1.5 md:px-8 ${CONTENT_WIDTH}`}>
          {p.parent && <ParentLink parent={p.parent} navigate={navigate} />}
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => setPanel({ type: 'look' })} aria-label="Change project look" className="shrink-0 rounded-[14px]">
              <ProjectTile project={p} size={52} />
            </button>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="font-display text-[28px] leading-[1.1] font-semibold tracking-tight md:text-[32px]">{p.title}</h1>
              <button type="button" onClick={() => setPanel({ type: 'details' })} className="flex min-h-6 items-center gap-1.5 self-start text-left text-[13px] text-ink-soft">
                <span className={`size-2 shrink-0 rounded-full ${STATUS_META[p.status].dot}`} aria-hidden="true" />
                <span>
                  {STATUS_META[p.status].label} · {PRIORITY_META[p.priority]?.label} ·{' '}
                  {p.dueDate ? <span className={dueToneClass[dueTone(p.dueDate)]}>due {formatDue(p.dueDate)}</span> : 'no due date'}
                </span>
              </button>
            </div>
          </div>

          {p.description ? (
            <div className="flex max-w-3xl flex-col items-start gap-0.5">
              <p className={`text-sm leading-normal whitespace-pre-line text-ink-soft ${longDescription && !descriptionOpen ? 'line-clamp-3' : ''}`}>
                <LinkedText text={p.description} />
              </p>
              {longDescription && (
                <button type="button" onClick={() => setDescriptionOpen(!descriptionOpen)} aria-expanded={descriptionOpen} className="flex min-h-11 items-center text-[13px] font-semibold text-(--look-ink)">
                  {descriptionOpen ? 'Show less' : 'More'}
                </button>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setPanel({ type: 'details' })} className="min-h-11 self-start text-sm text-ink-soft hover:text-ink">
              Add a description
            </button>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {p.tags.slice(0, HERO_TAGS).map((t) => (
              <a
                key={t}
                href={`/projects?tag=${encodeURIComponent(t)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  navigate(`/projects?tag=${encodeURIComponent(t)}`);
                }}
                className="flex h-11 items-center rounded-full bg-surface/70 px-3 text-xs font-medium text-ink-soft"
              >
                #{t}
              </a>
            ))}
            {p.tags.length > HERO_TAGS && (
              <button type="button" onClick={() => setPanel({ type: 'details' })} aria-label={`Show all ${p.tags.length} tags`} className="h-11 rounded-full bg-surface/70 px-3 text-xs font-medium text-ink-soft">
                +{p.tags.length - HERO_TAGS}
              </button>
            )}
            {p.tags.length === 0 && (
              <button type="button" onClick={() => setPanel({ type: 'details' })} className="h-11 rounded-full border border-dashed border-line-strong px-3 text-xs font-medium text-ink-soft">
                Add tags
              </button>
            )}
          </div>
          {m.updateProject.isError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {m.updateProject.error.message}
            </p>
          )}
        </div>
      </header>

      {/* Highlights: beside the content at lg and 2xl, as a row above it at xl. */}
      <div
        className={`mx-auto flex w-full flex-col gap-3.5 px-4 pt-3.5 pb-10 md:px-8 md:pt-6 ${
          hasHighlights ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-x-6 lg:gap-y-4 xl:grid-cols-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_22.5rem]' : ''
        } ${CONTENT_WIDTH}`}
      >
        <OverviewTiles project={p} onJump={jumpTo} />

        {hasHighlights && (
          <div className="flex min-w-0 flex-col gap-3.5 lg:col-start-2 lg:row-span-2 lg:row-start-1 xl:col-start-1 xl:row-span-1 xl:grid xl:auto-cols-fr xl:grid-flow-col xl:items-start 2xl:col-start-2 2xl:row-span-2 2xl:flex 2xl:items-stretch">
            <UpNext project={p} onDone={(itemId) => m.updateItem.mutate({ id: itemId, state: 'done' })} />
            <LatestNote notes={notes.data} onAll={() => setTab('notes')} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3.5 lg:col-start-1 xl:row-start-3 2xl:row-start-2">
          <SubprojectsSection projects={p.subprojects} navigate={navigate} onNew={() => setPanel({ type: 'new-subproject' })} />
          <div role="tablist" aria-label="Project sections" className="flex rounded-[10px] bg-line p-[3px] md:gap-1 md:rounded-none md:border-b md:border-line md:bg-transparent md:p-0">
            {TABS.map((t) => {
              const count = t.id === 'notes' ? notes.data?.length : t.id === 'files' ? files.data?.length : undefined;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-11 flex-1 rounded-lg text-sm md:flex-none md:rounded-none md:border-b-2 md:px-4 ${
                    tab === t.id
                      ? 'bg-surface font-semibold shadow-sm md:border-accent md:bg-transparent md:text-accent-ink md:shadow-none'
                      : 'font-medium text-ink-soft md:border-transparent md:text-muted'
                  }`}
                >
                  {t.label}
                  {count ? ` · ${count}` : ''}
                </button>
              );
            })}
          </div>

          {tab === 'notes' && <NotesTab projectId={p.id} />}
          {tab === 'files' && <FilesTab projectId={p.id} />}
          {tab === 'checklists' && (
            <main className="flex flex-col gap-3.5">
              {p.checklists.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
                  No checklists yet. Add one for things to buy, questions to clarify or steps to do.
                </p>
              )}
              <div className="grid items-start gap-3.5 xl:grid-cols-2 2xl:grid-cols-3">
                {p.checklists.map((c) => (
                  <ChecklistCard
                    key={c.id}
                    checklist={c}
                    onAddItems={(items) => m.addItems.mutate({ checklistId: c.id, items })}
                    onToggle={(itemId, state) => m.updateItem.mutate({ id: itemId, state })}
                    onMove={(itemId, position) => m.updateItem.mutate({ id: itemId, position })}
                    onOpenItem={(itemId) => setPanel({ type: 'item', id: itemId })}
                    onEdit={() => setPanel({ type: 'checklist', id: c.id })}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPanel({ type: 'new-checklist' })}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[15px] font-semibold text-accent-ink hover:bg-surface"
              >
                <PlusIcon width={18} height={18} />
                Add checklist
              </button>
              {(m.updateItem.isError || m.addItems.isError) && (
                <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  {(m.updateItem.error ?? m.addItems.error)?.message}
                </p>
              )}
            </main>
          )}
        </div>
      </div>

      {item && <ItemSheet projectId={p.id} item={item} checklists={p.checklists} mutations={m} onClose={close} />}
      {editing && (
        <ChecklistSheet
          checklist={editing}
          index={p.checklists.indexOf(editing)}
          count={p.checklists.length}
          onSave={(data) => m.updateChecklist.mutate({ id: editing.id, ...data })}
          onMove={(position) => m.updateChecklist.mutate({ id: editing.id, position })}
          onDelete={() => m.deleteChecklist.mutate(editing.id)}
          onClose={close}
        />
      )}
      {panel?.type === 'new-checklist' && <ChecklistSheet onSave={(data) => m.createChecklist.mutate(data)} onClose={close} />}
      {panel?.type === 'details' && <DetailsSheet project={p} onSave={(patch) => m.updateProject.mutate(patch)} onClose={close} />}
      {panel?.type === 'look' && <LookSheet project={p} onChange={(patch) => m.updateProject.mutate(patch)} onClose={close} />}
      {panel?.type === 'new-subproject' && <NewProjectSheet parent={p} onClose={close} onCreated={(subId) => (close(), navigate(`/projects/${subId}`))} />}
      {panel?.type === 'actions' && (
        <ActionsSheet
          project={p}
          onNewSubproject={() => setPanel({ type: 'new-subproject' })}
          onDetach={() => m.updateProject.mutate({ parentId: null })}
          onArchive={() => m.updateProject.mutate({ status: p.status === 'archived' ? 'active' : 'archived' })}
          onDelete={() => m.deleteProject.mutate(undefined, { onSuccess: () => navigate('/projects') })}
          onClose={close}
        />
      )}
    </div>
  );
}

function ActionsSheet({
  project,
  onNewSubproject,
  onDetach,
  onArchive,
  onDelete,
  onClose,
}: {
  project: ProjectDetail;
  onNewSubproject: () => void;
  onDetach: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title={project.title} onClose={onClose}>
      <div className="flex flex-col gap-2 pb-2">
        {project.parent ? (
          <button type="button" onClick={() => (onDetach(), onClose())} className="h-12 rounded-xl border border-line text-[15px] font-semibold" data-autofocus>
            Make it a project of its own
          </button>
        ) : (
          <button type="button" onClick={onNewSubproject} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-semibold" data-autofocus>
            <SubprojectIcon width={18} height={18} />
            New sub-project
          </button>
        )}
        <button type="button" onClick={() => (onArchive(), onClose())} className="h-12 rounded-xl border border-line text-[15px] font-semibold">
          {project.status === 'archived' ? 'Restore project' : 'Archive project'}
        </button>
        {confirm ? (
          <button type="button" onClick={() => (onDelete(), onClose())} className="h-12 rounded-xl bg-danger-fill text-[15px] font-semibold text-white">
            Delete permanently, with all checklists, notes and files
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="h-12 rounded-xl border border-line text-[15px] font-semibold text-danger">
            Delete project
          </button>
        )}
        <p className="px-1 pt-1 text-xs text-muted">
          Archived projects keep everything and can be restored. Deleting can’t be undone
          {project.subprojects.length > 0 ? '; its sub-projects stay, as projects of their own.' : '.'}
        </p>
      </div>
    </Sheet>
  );
}
