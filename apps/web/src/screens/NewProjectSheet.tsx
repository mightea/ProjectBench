import type { ProjectDetail } from '@projectbench/core/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { DateField } from '../components/DateField.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { TagInput } from '../components/TagInput.tsx';
import { PRIORITY_META } from '../lib/format.ts';
import { useCreateProject } from '../lib/queries.ts';

const STARTER_LISTS = [
  { kind: 'buy', title: 'To buy' },
  { kind: 'clarify', title: 'To clarify' },
  { kind: 'todo', title: 'To do' },
] as const;

interface Props {
  /** Creates a sub-project of this project, with its look and tags. */
  parent?: ProjectDetail;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function NewProjectSheet({ parent, onClose, onCreated }: Props) {
  const create = useCreateProject();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(parent?.priority ?? 3);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(parent?.tags ?? []);
  const [lists, setLists] = useState<string[]>(['buy', 'todo']);
  const ids = { title: useId(), due: useId(), tags: useId() };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const project = await create.mutateAsync({
      title,
      priority,
      status: 'active',
      dueDate,
      tags,
      parentId: parent?.id,
    });
    // Starter checklists, in the usual order.
    for (const list of STARTER_LISTS.filter((l) => lists.includes(l.kind))) {
      await api.post(`/api/projects/${project.id}/checklists`, list);
    }
    await qc.invalidateQueries({ queryKey: ['project', project.id] });
    if (parent) await qc.invalidateQueries({ queryKey: ['project', parent.id] });
    onCreated(project.id);
  };

  return (
    <Sheet
      title={parent ? 'New sub-project' : 'New project'}
      onClose={onClose}
      footer={
        <button
          type="submit"
          form="new-project"
          disabled={!title.trim() || create.isPending}
          className="h-[52px] w-full rounded-2xl bg-accent text-base font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : parent ? 'Create sub-project' : 'Create project'}
        </button>
      }
    >
      <form id="new-project" onSubmit={submit} className="flex flex-col gap-4">
        {parent && (
          <div className="flex items-center gap-3 rounded-xl bg-line-soft px-3 py-2.5">
            <ProjectTile project={parent} size={32} />
            <p className="min-w-0 text-[13px] leading-snug text-ink-soft">
              Part of <span className="font-semibold text-ink">{parent.title}</span>. It keeps its own lists, notes and files, and shows up inside{' '}
              {parent.title}.
            </p>
          </div>
        )}
        <Field label="Title" htmlFor={ids.title}>
          <input
            id={ids.title}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className={inputClass}
            placeholder={parent ? 'e.g. Order first test PCB' : 'e.g. Rack fan controller'}
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Priority</legend>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={priority === p}
                onClick={() => setPriority(p)}
                className={`flex h-12 flex-col items-center justify-center rounded-xl text-[13px] ${
                  priority === p ? `${PRIORITY_META[p]!.className} font-semibold ring-2 ring-current` : 'border border-line font-medium'
                }`}
              >
                <span>{PRIORITY_META[p]!.short}</span>
                <span className="text-[11px] opacity-80">{PRIORITY_META[p]!.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Due date" htmlFor={ids.due} hint="Optional">
          <DateField id={ids.due} value={dueDate} onCommit={setDueDate} />
        </Field>

        <Field label="Tags" htmlFor={ids.tags} hint="Press Enter or type a comma to add">
          <TagInput id={ids.tags} value={tags} onChange={setTags} />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Start with these lists</legend>
          <div className="flex flex-wrap gap-2">
            {STARTER_LISTS.map((l) => {
              const on = lists.includes(l.kind);
              return (
                <button
                  key={l.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLists(on ? lists.filter((k) => k !== l.kind) : [...lists, l.kind])}
                  className={`h-11 rounded-xl px-4 text-sm ${on ? 'border-2 border-accent bg-accent-soft font-semibold text-accent-ink' : 'border border-line font-medium'}`}
                >
                  {l.title}
                </button>
              );
            })}
          </div>
        </fieldset>

        {create.isError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {create.error.message}
          </p>
        )}
      </form>
    </Sheet>
  );
}
