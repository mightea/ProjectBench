import type { Attachment } from '@projectbench/core/schemas';
import { useRef, type ChangeEvent } from 'react';
import { CameraIcon, DownloadIcon, PaperclipIcon, TrashIcon } from '../components/icons.tsx';
import { fileBadge, formatBytes } from '../lib/upload.ts';

const fileUrl = (id: string) => `/files/${encodeURIComponent(id)}`;

/** Opens the camera on phones and a file dialog elsewhere, then hands over the chosen files. */
export function FilePickers({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  const button = 'flex size-11 flex-none items-center justify-center rounded-full bg-ground text-ink hover:bg-line-soft disabled:opacity-50';
  return (
    <>
      <button type="button" onClick={() => camera.current?.click()} disabled={disabled} aria-label="Take photo" className={button}>
        <CameraIcon width={20} height={20} />
      </button>
      <button type="button" onClick={() => picker.current?.click()} disabled={disabled} aria-label="Attach file" className={button}>
        <PaperclipIcon width={20} height={20} />
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" onChange={picked} tabIndex={-1} aria-hidden="true" className="hidden" />
      <input ref={picker} type="file" multiple onChange={picked} tabIndex={-1} aria-hidden="true" className="hidden" />
    </>
  );
}

export function ImageGrid({ images }: { images: Attachment[] }) {
  return (
    <ul className="grid grid-cols-3 gap-1.5">
      {images.map((a) => (
        <li key={a.id}>
          <a href={fileUrl(a.id)} target="_blank" rel="noopener" aria-label={`Open ${a.filename}`} className="block aspect-square overflow-hidden rounded-[10px] bg-line">
            <img src={`${fileUrl(a.id)}/thumb`} alt={a.caption ?? a.filename} loading="lazy" className="size-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function FileRow({ attachment: a, onDelete }: { attachment: Attachment; onDelete?: () => void }) {
  const isPdf = a.mime === 'application/pdf';
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-ground py-1 pr-1 pl-2.5">
      <span
        aria-hidden="true"
        className={`flex size-[34px] flex-none items-center justify-center rounded-lg text-[10px] font-bold ${isPdf ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-[#2448C2]'}`}
      >
        {fileBadge(a.filename)}
      </span>
      <a href={fileUrl(a.id)} target="_blank" rel="noopener" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-[13px] font-medium">{a.filename}</span>
        <span className="text-xs text-muted">{formatBytes(a.sizeBytes)}</span>
      </a>
      <a href={`${fileUrl(a.id)}?download`} download={a.filename} aria-label={`Download ${a.filename}`} className="flex size-11 flex-none items-center justify-center rounded-lg text-muted hover:text-ink">
        <DownloadIcon width={18} height={18} />
      </a>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Delete ${a.filename}`} className="flex size-11 flex-none items-center justify-center rounded-lg text-muted hover:text-danger">
          <TrashIcon width={18} height={18} />
        </button>
      )}
    </div>
  );
}

export function AttachmentList({ attachments, onDelete }: { attachments: Attachment[]; onDelete?: (a: Attachment) => void }) {
  const images = attachments.filter((a) => a.hasThumbnail);
  const others = attachments.filter((a) => !a.hasThumbnail);
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && <ImageGrid images={images} />}
      {others.map((a) => (
        <FileRow key={a.id} attachment={a} onDelete={onDelete && (() => onDelete(a))} />
      ))}
    </div>
  );
}
