import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus } from '@projectbench/core/schemas';
import { useEffect, useId, useState, type FormEvent, type MouseEvent } from 'react';
import { ApiError } from '../api.ts';
import { PriorityBadge, ProgressBar, progressLabel } from '../components/bits.tsx';
import { BackIcon, ChevronDownIcon, DotsIcon, PlusIcon } from '../components/icons.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { dueTone, dueToneClass, formatDue, PRIORITY_META, STATUS_META } from '../lib/format.ts';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { useAttachments, useNotes, useProject, useProjectMutations } from '../lib/queries.ts';
import { ChecklistCard } from './ChecklistCard.tsx';
import { ChecklistSheet } from './ChecklistSheet.tsx';
import { FilesTab } from './FilesTab.tsx';
import { ItemSheet } from './ItemSheet.tsx';
import { NotesTab } from './NotesTab.tsx';

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
  | { type: 'actions' };

export function ProjectScreen({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const project = useProject(id);

  const missing = project.error instanceof ApiError && project.error.status === 404;
  // Cached data stays on screen when a refresh fails, unless the project is really gone.
  if (project.data && !missing) return <ProjectView project={project.data} navigate={navigate} />;
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
      <a href="/projects" onClick={(e) => (e.preventDefault(), navigate('/projects'))} className="font-semibold text-accent">
        Back to projects
      </a>
    </div>
  );
}

function ProjectView({ project: p, navigate }: { project: ProjectDetail; navigate: (to: string) => void }) {
  const m = useProjectMutations(p.id);
  const notes = useNotes(p.id);
  const files = useAttachments(p.id);
  const [tab, setTab] = useState<TabId>('checklists');
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = () => setPanel(null);
  const statusId = useId();
  const priorityId = useId();
  const dueId = useId();

  useEffect(() => {
    document.title = `${p.title} · ProjectBench`;
    return () => {
      document.title = 'ProjectBench';
    };
  }, [p.title]);

  const back = (e: MouseEvent) => {
    e.preventDefault();
    navigate('/projects');
  };

  const item = panel?.type === 'item' ? p.checklists.flatMap((c) => c.items).find((i) => i.id === panel.id) : undefined;
  const editing = panel?.type === 'checklist' ? p.checklists.find((c) => c.id === panel.id) : undefined;

  return (
    <div className="flex min-h-dvh w-full flex-col md:min-h-0 md:max-w-[50rem]">
      <div className="border-b border-line bg-surface md:border-b-0 md:bg-transparent">
        <div className="flex items-center justify-between px-2 pt-3 md:px-6 md:pt-5">
          <a href="/projects" onClick={back} className="flex h-11 items-center gap-1 rounded-full pr-3 pl-1.5 text-[15px] font-medium hover:bg-ground">
            <BackIcon width={22} height={22} />
            <span className="md:inline">Projects</span>
          </a>
          <button
            type="button"
            onClick={() => setPanel({ type: 'actions' })}
            aria-label="More actions"
            className="flex size-11 items-center justify-center rounded-full hover:bg-ground"
          >
            <DotsIcon width={22} height={22} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 pt-1 pb-4 md:px-8">
          <button type="button" onClick={() => setPanel({ type: 'details' })} className="text-left">
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight md:text-[30px]">{p.title}</h1>
            {p.description ? (
              <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed whitespace-pre-line text-muted">{p.description}</p>
            ) : (
              <p className="mt-1 text-sm text-muted">Add a description</p>
            )}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={statusId} className="sr-only">
              Status
            </label>
            <span className="relative flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface pr-7 pl-2.5 text-[13px] font-medium">
              <span className={`size-2 rounded-full ${STATUS_META[p.status].dot}`} aria-hidden="true" />
              {STATUS_META[p.status].label}
              <ChevronDownIcon width={14} height={14} className="absolute right-2 text-muted" />
              <select
                id={statusId}
                value={p.status}
                onChange={(e) => m.updateProject.mutate({ status: e.target.value as ProjectStatus })}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </span>

            <label htmlFor={priorityId} className="sr-only">
              Priority
            </label>
            <span className="relative flex h-8 items-center">
              <PriorityBadge priority={p.priority} long />
              <select
                id={priorityId}
                value={p.priority}
                onChange={(e) => m.updateProject.mutate({ priority: Number(e.target.value) })}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {PRIORITY_META[n]!.short} · {PRIORITY_META[n]!.label}
                  </option>
                ))}
              </select>
            </span>

            <label htmlFor={dueId} className="sr-only">
              Due date
            </label>
            <span
              className={`relative flex h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium ${
                p.dueDate ? dueToneClass[dueTone(p.dueDate)] : 'text-muted'
              }`}
            >
              {p.dueDate ? `Due ${formatDue(p.dueDate)}` : 'No due date'}
              <input
                id={dueId}
                type="date"
                value={p.dueDate ?? ''}
                onChange={(e) => m.updateProject.mutate({ dueDate: e.target.value || null })}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </span>

            {p.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPanel({ type: 'details' })}
                className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-muted"
              >
                #{t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <ProgressBar progress={p.progress} className="h-1.5 flex-1" />
            <span className="text-xs whitespace-nowrap text-muted">{progressLabel(p.progress)}</span>
          </div>
        </div>

        <div role="tablist" aria-label="Project sections" className="flex px-3 md:px-6">
          {TABS.map((t) => {
            const count = t.id === 'notes' ? notes.data?.length : t.id === 'files' ? files.data?.length : undefined;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`h-11 flex-1 border-b-2 text-sm md:flex-none md:px-5 ${
                  tab === t.id ? 'border-accent font-semibold text-accent' : 'border-transparent font-medium text-muted'
                }`}
              >
                {t.label}
                {count ? ` · ${count}` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'notes' && <NotesTab projectId={p.id} />}
      {tab === 'files' && <FilesTab projectId={p.id} />}
      {tab === 'checklists' && (
      <main className="flex flex-1 flex-col gap-3.5 px-4 pt-4 pb-10 md:px-8">
        {p.checklists.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
            No checklists yet. Add one for things to buy, questions to clarify or steps to do.
          </p>
        )}
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
        <button
          type="button"
          onClick={() => setPanel({ type: 'new-checklist' })}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-[#C9CDD6] text-[15px] font-semibold text-accent hover:bg-surface"
        >
          <PlusIcon width={18} height={18} />
          Add checklist
        </button>
        {(m.updateItem.isError || m.addItems.isError || m.updateProject.isError) && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {(m.updateItem.error ?? m.addItems.error ?? m.updateProject.error)?.message}
          </p>
        )}
      </main>
      )}

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
      {panel?.type === 'actions' && (
        <ActionsSheet
          project={p}
          onArchive={() => m.updateProject.mutate({ status: p.status === 'archived' ? 'active' : 'archived' })}
          onDelete={() => m.deleteProject.mutate(undefined, { onSuccess: () => navigate('/projects') })}
          onClose={close}
        />
      )}
    </div>
  );
}

function DetailsSheet({
  project,
  onSave,
  onClose,
}: {
  project: ProjectDetail;
  onSave: (patch: { title: string; description: string; tags: string[] }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [tags, setTags] = useState(project.tags.join(', '));
  const ids = { title: useId(), description: useId(), tags: useId() };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title, description, tags: tags.split(/[,\s]+/).filter(Boolean) });
    onClose();
  };

  return (
    <Sheet
      title="Project details"
      onClose={onClose}
      footer={
        <button type="submit" form="details-form" disabled={!title.trim()} className="h-12 w-full rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          Save
        </button>
      }
    >
      <form id="details-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Title" htmlFor={ids.title}>
          <input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} className={inputClass} />
        </Field>
        <Field label="Description" htmlFor={ids.description}>
          <textarea id={ids.description} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={`${inputClass} h-auto py-3`} />
        </Field>
        <Field label="Tags" htmlFor={ids.tags} hint="Separate with commas">
          <input id={ids.tags} value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="none" className={inputClass} />
        </Field>
      </form>
    </Sheet>
  );
}

function ActionsSheet({
  project,
  onArchive,
  onDelete,
  onClose,
}: {
  project: ProjectDetail;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title={project.title} onClose={onClose}>
      <div className="flex flex-col gap-2 pb-2">
        <button type="button" onClick={() => (onArchive(), onClose())} className="h-12 rounded-xl border border-line text-[15px] font-semibold" data-autofocus>
          {project.status === 'archived' ? 'Restore project' : 'Archive project'}
        </button>
        {confirm ? (
          <button type="button" onClick={() => (onDelete(), onClose())} className="h-12 rounded-xl bg-danger text-[15px] font-semibold text-white">
            Delete permanently, with all checklists, notes and files
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="h-12 rounded-xl border border-line text-[15px] font-semibold text-danger">
            Delete project
          </button>
        )}
        <p className="px-1 pt-1 text-xs text-muted">Archived projects keep everything and can be restored. Deleting can’t be undone.</p>
      </div>
    </Sheet>
  );
}
