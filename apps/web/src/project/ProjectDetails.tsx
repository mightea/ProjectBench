import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus, type ProjectUpdate } from '@projectbench/core/schemas';
import { useId, useState, type FormEvent } from 'react';
import { DateField } from '../components/DateField.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { TagInput } from '../components/TagInput.tsx';
import { PRIORITY_META, STATUS_META } from '../lib/format.ts';
import { useProjects } from '../lib/queries.ts';

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

/** Every project field in one form. */
export function DetailsSheet({ project, onSave, onClose }: { project: ProjectDetail; onSave: (patch: ProjectUpdate) => void; onClose: () => void }) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority);
  const [dueDate, setDueDate] = useState(project.dueDate);
  const [tags, setTags] = useState(project.tags);
  const [parentId, setParentId] = useState(project.parentId ?? '');
  const ids = { title: useId(), description: useId(), status: useId(), priority: useId(), due: useId(), tags: useId(), parent: useId() };
  // Sub-projects are one level deep: only projects that aren't sub-projects themselves can be parents.
  const all = useProjects({ status: 'all' });
  const parents = all.data?.filter((c) => c.id !== project.id && !c.parentId && (c.status !== 'archived' || c.id === project.parentId));
  const isParent = project.subprojects.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const parentChange = (parentId || null) !== project.parentId ? { parentId: parentId || null } : {};
    onSave({ title, description, status, priority, dueDate, tags, ...parentChange });
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
        <Field
          label="Part of"
          htmlFor={ids.parent}
          hint={isParent ? 'It has sub-projects of its own, so it can’t become one.' : 'Makes it a sub-project, shown inside the other project.'}
        >
          <select id={ids.parent} value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={isParent || !parents} className={`${inputClass} disabled:opacity-60`}>
            <option value="">No other project</option>
            {project.parent && !parents?.some((c) => c.id === project.parent!.id) && <option value={project.parent.id}>{project.parent.title}</option>}
            {parents?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Sheet>
  );
}
