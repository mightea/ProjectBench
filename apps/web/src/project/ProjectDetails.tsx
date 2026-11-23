import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus, type ProjectUpdate } from '@projectbench/core/schemas';
import { useId, useState, type FormEvent } from 'react';
import { ProgressBar, progressLabel } from '../components/bits.tsx';
import { DateField } from '../components/DateField.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { TagInput } from '../components/TagInput.tsx';
import { PRIORITY_META, STATUS_META } from '../lib/format.ts';

const StatusOptions = () =>
  PROJECT_STATUSES.map((s) => (
    <option key={s} value={s}>
      {STATUS_META[s].label}
    </option>
  ));

const PriorityOptions = () =>
  [1, 2, 3, 4].map((n) => (
    <option key={n} value={n}>
      {PRIORITY_META[n]!.short} · {PRIORITY_META[n]!.label}
    </option>
  ));

/** Always-visible fields beside the project on desktop. Each change saves right away. */
export function ProjectProperties({ project: p, onChange }: { project: ProjectDetail; onChange: (patch: ProjectUpdate) => void }) {
  const ids = { status: useId(), priority: useId(), due: useId(), tags: useId() };
  return (
    <aside aria-label="Project details" className="sticky top-5 mt-5 hidden flex-col gap-4 rounded-2xl border border-line bg-surface p-4 lg:flex">
      <Field label="Status" htmlFor={ids.status}>
        <select id={ids.status} value={p.status} onChange={(e) => onChange({ status: e.target.value as ProjectStatus })} className={inputClass}>
          <StatusOptions />
        </select>
      </Field>
      <Field label="Priority" htmlFor={ids.priority}>
        <select id={ids.priority} value={p.priority} onChange={(e) => onChange({ priority: Number(e.target.value) })} className={inputClass}>
          <PriorityOptions />
        </select>
      </Field>
      <Field label="Due date" htmlFor={ids.due}>
        <DateField id={ids.due} value={p.dueDate} onCommit={(dueDate) => onChange({ dueDate })} />
      </Field>
      <Field label="Tags" htmlFor={ids.tags}>
        <TagInput id={ids.tags} value={p.tags} onChange={(tags) => onChange({ tags })} />
      </Field>
      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
        <ProgressBar progress={p.progress} className="h-1.5" />
        <span className="text-xs text-muted">{progressLabel(p.progress)}</span>
      </div>
    </aside>
  );
}

/** Every project field in one form; the way to edit on phones and to change title or description. */
export function DetailsSheet({ project, onSave, onClose }: { project: ProjectDetail; onSave: (patch: ProjectUpdate) => void; onClose: () => void }) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority);
  const [dueDate, setDueDate] = useState(project.dueDate);
  const [tags, setTags] = useState(project.tags);
  const ids = { title: useId(), description: useId(), status: useId(), priority: useId(), due: useId(), tags: useId() };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title, description, status, priority, dueDate, tags });
    onClose();
  };

  return (
    <Sheet
      title="Edit project"
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
          <textarea id={ids.description} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={`${inputClass} h-auto py-3`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" htmlFor={ids.status}>
            <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={inputClass}>
              <StatusOptions />
            </select>
          </Field>
          <Field label="Priority" htmlFor={ids.priority}>
            <select id={ids.priority} value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={inputClass}>
              <PriorityOptions />
            </select>
          </Field>
        </div>
        <Field label="Due date" htmlFor={ids.due}>
          <DateField id={ids.due} value={dueDate} onCommit={setDueDate} />
        </Field>
        <Field label="Tags" htmlFor={ids.tags} hint="Press Enter or type a comma to add">
          <TagInput id={ids.tags} value={tags} onChange={setTags} />
        </Field>
      </form>
    </Sheet>
  );
}
