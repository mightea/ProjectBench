import type { Note } from '@projectbench/core/schemas';
import { useId, useState, type FormEvent } from 'react';
import { ArrowUpIcon, CloseIcon, DotsIcon, PinIcon } from '../components/icons.tsx';
import { inputClass, Sheet } from '../components/Sheet.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { UploadError, useNoteMutations, useNotes } from '../lib/queries.ts';
import { formatTimestamp } from '../lib/upload.ts';
import { AttachmentList, FilePickers } from './Attachments.tsx';

export function NotesTab({ projectId }: { projectId: string }) {
  const notes = useNotes(projectId);
  const m = useNoteMutations(projectId);
  const [editing, setEditing] = useState<string | null>(null);
  const current = notes.data?.find((n) => n.id === editing);
  const error = m.postNote.error ?? m.updateNote.error ?? m.deleteNote.error;

  return (
    <>
      <main className="flex flex-1 flex-col gap-3">
        {!notes.data && <QueryFallback query={notes} />}
        {notes.data?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
            No notes yet. Write down decisions, measurements or progress, and add photos.
          </p>
        )}
        {notes.data?.map((n) => (
          <NoteCard key={n.id} note={n} onMore={() => setEditing(n.id)} />
        ))}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error.message}
          </p>
        )}
      </main>
      <Composer
        busy={m.postNote.isPending}
        onPost={(body, files, onDone) =>
          m.postNote.mutate(
            { body, files },
            {
              onSuccess: () => onDone([]),
              // The note exists by now: keep only the files that still need sending, so a retry can't post it twice.
              onError: (err) => {
                if (err instanceof UploadError) onDone(err.failed);
              },
            },
          )
        }
      />
      {current && (
        <NoteSheet
          note={current}
          onSave={(body) => m.updateNote.mutate({ id: current.id, body })}
          onPin={() => m.updateNote.mutate({ id: current.id, pinned: !current.pinned })}
          onDelete={() => m.deleteNote.mutate(current.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function NoteCard({ note: n, onMore }: { note: Note; onMore: () => void }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-line bg-surface py-2 pr-2 pb-3.5 pl-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {n.pinned && (
          <>
            <PinIcon width={14} height={14} className="text-accent-ink" />
            <span className="font-semibold text-accent-ink">Pinned</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        {n.source === 'mcp' && <span className="rounded-md bg-claude-soft px-1.5 py-0.5 text-[11px] font-semibold text-claude">via Claude</span>}
        <time dateTime={n.createdAt}>{formatTimestamp(n.createdAt)}</time>
        <button type="button" onClick={onMore} aria-label="Note actions" className="ml-auto flex size-11 items-center justify-center rounded-full text-muted hover:bg-ground">
          <DotsIcon width={18} height={18} />
        </button>
      </div>
      <p className="-mt-1 pr-1.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap">{n.body}</p>
      {n.attachments.length > 0 && (
        <div className="pr-1.5">
          <AttachmentList attachments={n.attachments} />
        </div>
      )}
    </article>
  );
}

function Composer({ busy, onPost }: { busy: boolean; onPost: (body: string, files: File[], onDone: (remaining: File[]) => void) => void }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const inputId = useId();
  const canPost = !busy && (body.trim().length > 0 || files.length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canPost) return;
    onPost(body, files, (remaining) => {
      setBody('');
      setFiles(remaining);
    });
  };

  return (
    <form onSubmit={submit} className="sticky bottom-0 z-30 border-t border-line bg-surface px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),12px)]">
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex h-9 max-w-full items-center gap-1 rounded-lg bg-ground pl-2.5 text-[13px]">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, n) => n !== i))}
                aria-label={`Remove ${f.name}`}
                className="flex size-9 flex-none items-center justify-center text-muted"
              >
                <CloseIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5">
        <FilePickers disabled={busy} onFiles={(added) => setFiles((prev) => [...prev, ...added])} />
        <label htmlFor={inputId} className="sr-only">
          Write a note
        </label>
        <textarea
          id={inputId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={1}
          maxLength={20_000}
          placeholder="Write a note…"
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-line bg-surface px-3.5 py-2.5 text-base leading-snug outline-none [field-sizing:content] focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={!canPost}
          aria-label={busy ? 'Posting note' : 'Post note'}
          className="flex size-11 flex-none items-center justify-center rounded-full bg-accent text-white hover:bg-accent-strong disabled:opacity-50"
        >
          <ArrowUpIcon width={20} height={20} />
        </button>
      </div>
    </form>
  );
}

function NoteSheet({
  note,
  onSave,
  onPin,
  onDelete,
  onClose,
}: {
  note: Note;
  onSave: (body: string) => void;
  onPin: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [confirm, setConfirm] = useState(false);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (body !== note.body) onSave(body);
    onClose();
  };
  return (
    <Sheet
      title="Note"
      onClose={onClose}
      footer={
        <button type="submit" form="note-form" disabled={!body.trim()} className="h-12 w-full rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          Save
        </button>
      }
    >
      <form id="note-form" onSubmit={submit} className="flex flex-col gap-3 pb-2">
        <label htmlFor={id} className="sr-only">
          Note text
        </label>
        <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={20_000} className={`${inputClass} h-auto py-3`} />
        <button type="button" onClick={() => (onPin(), onClose())} className="h-12 rounded-xl border border-line text-[15px] font-semibold">
          {note.pinned ? 'Unpin note' : 'Pin to top'}
        </button>
        {confirm ? (
          <button type="button" onClick={() => (onDelete(), onClose())} className="h-12 rounded-xl bg-danger-fill text-[15px] font-semibold text-white">
            Delete note permanently
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="h-12 rounded-xl border border-line text-[15px] font-semibold text-danger">
            Delete note
          </button>
        )}
        {note.attachments.length > 0 && <p className="text-xs text-muted">Its files stay in the Files tab.</p>}
      </form>
    </Sheet>
  );
}
