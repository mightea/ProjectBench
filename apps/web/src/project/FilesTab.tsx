import type { Attachment } from '@projectbench/core/schemas';
import { useState } from 'react';
import { TrashIcon } from '../components/icons.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { useAttachments, useNoteMutations } from '../lib/queries.ts';
import { formatBytes } from '../lib/upload.ts';
import { FilePickers, FileRow } from './Attachments.tsx';

export function FilesTab({ projectId }: { projectId: string }) {
  const files = useAttachments(projectId);
  const m = useNoteMutations(projectId);
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const images = files.data?.filter((a) => a.hasThumbnail) ?? [];
  const others = files.data?.filter((a) => !a.hasThumbnail) ?? [];
  const error = m.upload.error ?? m.deleteAttachment.error;

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-10 md:px-8">
      <div className="flex items-center gap-2">
        <FilePickers disabled={m.upload.isPending} onFiles={(picked) => m.upload.mutate({ files: picked })} />
        <span role="status" className="text-sm text-muted">
          {m.upload.isPending ? 'Uploading…' : 'Add a photo or file, up to 50 MB'}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error.message}
        </p>
      )}
      {!files.data && <QueryFallback query={files} />}
      {files.data?.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-muted">
          No files yet. Photos, PDFs, datasheets and STL files will show up here.
        </p>
      )}
      {images.length > 0 && (
        <section aria-label="Images">
          <ul className="grid grid-cols-3 gap-1.5 md:grid-cols-5">
            {images.map((a) => (
              <li key={a.id} className="relative">
                <a href={`/files/${encodeURIComponent(a.id)}`} target="_blank" rel="noopener" aria-label={`Open ${a.filename}`} className="block aspect-square overflow-hidden rounded-[10px] bg-line">
                  <img src={`/files/${encodeURIComponent(a.id)}/thumb`} alt={a.caption ?? a.filename} loading="lazy" className="size-full object-cover" />
                </a>
                <button
                  type="button"
                  onClick={() => setDeleting(a)}
                  aria-label={`Delete ${a.filename}`}
                  className="absolute top-0 right-0 flex size-11 items-center justify-center text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.7))]"
                >
                  <TrashIcon width={18} height={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-label="Other files">
          <ul className="flex flex-col gap-1.5">
            {others.map((a) => (
              <li key={a.id}>
                <FileRow attachment={a} onDelete={() => setDeleting(a)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {deleting && (
        <Sheet title="Delete file?" onClose={() => setDeleting(null)}>
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-sm break-words text-muted">
              {deleting.filename} ({formatBytes(deleting.sizeBytes)}) will be removed from this project. This can’t be undone.
            </p>
            <button
              type="button"
              data-autofocus
              onClick={() => {
                m.deleteAttachment.mutate(deleting.id);
                setDeleting(null);
              }}
              className="h-12 rounded-xl bg-danger text-[15px] font-semibold text-white"
            >
              Delete file
            </button>
            <button type="button" onClick={() => setDeleting(null)} className="h-12 rounded-xl border border-line text-[15px] font-semibold">
              Keep
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
