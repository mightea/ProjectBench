import { PROJECT_COLORS, PROJECT_ICONS, type ProjectDetail, type ProjectUpdate } from '@projectbench/core/schemas';
import { useRef, type ChangeEvent } from 'react';
import { CameraIcon } from '../components/icons.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { COLOR_LABELS, ICON_LABELS, ICON_PATHS, lookStyle, projectColor, projectIcon } from '../lib/look.ts';
import { useAttachments, useNoteMutations } from '../lib/queries.ts';

/** Color, glyph and cover photo. Each choice saves right away. */
export function LookSheet({ project: p, onChange, onClose }: { project: ProjectDetail; onChange: (patch: ProjectUpdate) => void; onClose: () => void }) {
  const files = useAttachments(p.id);
  const { upload } = useNoteMutations(p.id);
  const camera = useRef<HTMLInputElement>(null);
  const color = projectColor(p);
  const icon = projectIcon(p);
  const images = files.data?.filter((a) => a.hasThumbnail) ?? [];

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const [added] = await upload.mutateAsync({ files: [file] }).catch(() => []);
    if (added?.hasThumbnail) onChange({ coverAttachmentId: added.id });
  };

  return (
    <Sheet
      title="Project look"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="h-12 w-full rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong">
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-5" style={lookStyle(color)}>
        <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
          <ProjectTile project={p} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-semibold">{p.title}</span>
            <span className="text-xs text-muted">Preview in lists, Today and the sidebar</span>
          </span>
        </div>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-semibold text-ink-soft">Color</legend>
          <div className="grid grid-cols-4 justify-items-center gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={COLOR_LABELS[c]}
                aria-pressed={c === color}
                data-autofocus={c === color ? true : undefined}
                onClick={() => onChange({ color: c })}
                style={lookStyle(c)}
                className={`size-11 rounded-full border-[3px] border-surface bg-(--look) ${c === color ? 'ring-2 ring-(--look)' : ''}`}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-semibold text-ink-soft">Icon</legend>
          <div className="grid grid-cols-4 gap-2">
            {PROJECT_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={ICON_LABELS[name]}
                aria-pressed={name === icon}
                onClick={() => onChange({ icon: name })}
                className={`flex h-[52px] items-center justify-center rounded-xl border-2 ${
                  name === icon ? 'border-(--look) bg-(--look-soft) text-(--look-ink)' : 'border-line text-ink-soft'
                }`}
              >
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={ICON_PATHS[name]} />
                </svg>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-semibold text-ink-soft">Cover photo</legend>
          {images.length > 0 && (
            <div className="mb-2 grid grid-cols-4 gap-2">
              {images.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-label={`Use ${a.filename} as cover`}
                  aria-pressed={p.coverAttachmentId === a.id}
                  onClick={() => onChange({ coverAttachmentId: a.id })}
                  className={`aspect-square overflow-hidden rounded-xl bg-line ${p.coverAttachmentId === a.id ? 'ring-2 ring-(--look) ring-offset-2 ring-offset-surface' : ''}`}
                >
                  <img src={`/files/${encodeURIComponent(a.id)}/thumb`} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={upload.isPending}
              onClick={() => camera.current?.click()}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold disabled:opacity-50"
            >
              <CameraIcon width={18} height={18} />
              {upload.isPending ? 'Uploading…' : 'Take photo'}
            </button>
            {p.coverAttachmentId && (
              <button type="button" onClick={() => onChange({ coverAttachmentId: null })} className="h-12 flex-1 rounded-xl border border-line text-sm font-semibold">
                Remove cover
              </button>
            )}
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" aria-label="Take a cover photo" tabIndex={-1} />
          {upload.isError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {upload.error.message}
            </p>
          )}
        </fieldset>
      </div>
    </Sheet>
  );
}
