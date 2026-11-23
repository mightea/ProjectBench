import type {
  Agenda,
  Attachment,
  BuyOverview,
  Checklist,
  ChecklistCreate,
  ChecklistItem,
  ChecklistUpdate,
  ItemCreate,
  ItemState,
  ItemUpdate,
  LinkCreate,
  LinkUpdate,
  Note,
  NoteUpdate,
  ProjectCreate,
  ProjectDetail,
  ProjectSummary,
  ProjectUpdate,
  SearchHit,
} from '@projectbench/core/schemas';
import { onlineManager, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { prepareUpload } from './upload.ts';

export interface ProjectFilters {
  status?: string;
  sort?: string;
  q?: string;
  tag?: string;
}

const projectKey = (id: string) => ['project', id] as const;

export function useProjects(filters: ProjectFilters) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: () => api.get<ProjectSummary[]>(`/api/projects?${params}`),
    placeholderData: (prev) => prev,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectKey(id), queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`) });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ name: string; projects: number }[]>('/api/tags') });
}

export function useAgenda() {
  return useQuery({ queryKey: ['agenda'], queryFn: () => api.get<Agenda>('/api/agenda') });
}

export function useBuyOverview() {
  return useQuery({ queryKey: ['buy'], queryFn: () => api.get<BuyOverview>('/api/buy') });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    placeholderData: (prev) => prev,
  });
}

function refresh(qc: QueryClient, projectId: string) {
  return Promise.all(
    [projectKey(projectId), ['projects'], ['agenda'], ['buy'], ['search']].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}

/** Moves an item to its next state from a cross-project list such as Today or Buy. */
export function useItemState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; projectId: string; state: ItemState }) =>
      api.patch<ChecklistItem>(`/api/items/${id}`, { state }),
    // Keeps the row busy until the lists are fresh; offline there is nothing to wait for.
    onSettled: (_data, _error, { projectId }) => (onlineManager.isOnline() ? refresh(qc, projectId) : undefined),
  });
}

/** Applies a change to the cached project right away; returns a rollback. */
function optimistic(qc: QueryClient, projectId: string, change: (p: ProjectDetail) => ProjectDetail) {
  const key = projectKey(projectId);
  void qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<ProjectDetail>(key);
  if (previous) qc.setQueryData(key, change(previous));
  return () => previous && qc.setQueryData(key, previous);
}

const mapItems = (p: ProjectDetail, fn: (lists: Checklist[]) => Checklist[]): ProjectDetail => ({ ...p, checklists: fn(p.checklists) });

export function useProjectMutations(projectId: string) {
  const qc = useQueryClient();
  const done = {
    onSettled: () => {
      void refresh(qc, projectId);
    },
  };

  const updateProject = useMutation({
    mutationFn: (patch: ProjectUpdate) => api.patch<ProjectDetail>(`/api/projects/${projectId}`, patch),
    onMutate: (patch) => {
      const { tags, position, ...fields } = patch;
      void position;
      return {
        rollback: optimistic(qc, projectId, (p) => ({ ...p, ...(fields as Partial<ProjectDetail>), ...(tags ? { tags } : {}) })),
      };
    },
    onError: (_e, _v, c) => c?.rollback(),
    onSuccess: (data) => qc.setQueryData(projectKey(projectId), data),
    ...done,
  });

  const deleteProject = useMutation({ mutationFn: () => api.delete(`/api/projects/${projectId}`), ...done });

  const createChecklist = useMutation({
    mutationFn: (input: ChecklistCreate) => api.post(`/api/projects/${projectId}/checklists`, input),
    ...done,
  });

  const updateChecklist = useMutation({
    mutationFn: ({ id, ...patch }: ChecklistUpdate & { id: string }) => api.patch(`/api/checklists/${id}`, patch),
    onMutate: ({ id, position, ...fields }) => ({
      rollback: optimistic(qc, projectId, (p) =>
        mapItems(p, (lists) => {
          const next = lists.map((l) => (l.id === id ? { ...l, ...(fields as Partial<Checklist>) } : l));
          if (position === undefined) return next;
          const moving = next.find((l) => l.id === id)!;
          const rest = next.filter((l) => l.id !== id);
          rest.splice(position, 0, moving);
          return rest;
        }),
      ),
    }),
    onError: (_e, _v, c) => c?.rollback(),
    ...done,
  });

  const deleteChecklist = useMutation({ mutationFn: (id: string) => api.delete(`/api/checklists/${id}`), ...done });

  const addItems = useMutation({
    mutationFn: ({ checklistId, items }: { checklistId: string; items: ItemCreate[] }) =>
      api.post<ChecklistItem[]>(`/api/checklists/${checklistId}/items`, { items }),
    onMutate: ({ checklistId, items }) => ({
      rollback: optimistic(qc, projectId, (p) =>
        mapItems(p, (lists) =>
          lists.map((l) =>
            l.id === checklistId
              ? {
                  ...l,
                  items: [
                    ...l.items,
                    ...items.map((i, n) => ({
                      id: `pending-${Date.now()}-${n}`,
                      checklistId,
                      text: i.text,
                      state: 'open' as const,
                      orderedAt: null,
                      orderRef: null,
                      expectedDate: null,
                      doneAt: null,
                      dueDate: null,
                      quantity: i.quantity ?? null,
                      unit: null,
                      note: null,
                      links: [],
                    })),
                  ],
                }
              : l,
          ),
        ),
      ),
    }),
    onError: (_e, _v, c) => c?.rollback(),
    ...done,
  });

  const updateItem = useMutation({
    mutationFn: ({ id, ...patch }: ItemUpdate & { id: string }) => api.patch<ChecklistItem>(`/api/items/${id}`, patch),
    onMutate: ({ id, position, checklistId, ...fields }) => ({
      rollback: optimistic(qc, projectId, (p) =>
        mapItems(p, (lists) => {
          const item = lists.flatMap((l) => l.items).find((i) => i.id === id);
          if (!item) return lists;
          const updated: ChecklistItem = { ...item, ...(fields as Partial<ChecklistItem>) };
          const target = checklistId ?? item.checklistId;
          return lists.map((l) => {
            const without = l.items.filter((i) => i.id !== id);
            if (l.id !== target) return { ...l, items: without };
            if (position === undefined && target === item.checklistId) {
              return { ...l, items: l.items.map((i) => (i.id === id ? updated : i)) };
            }
            const at = position ?? without.length;
            without.splice(at, 0, { ...updated, checklistId: target });
            return { ...l, items: without };
          });
        }),
      ),
    }),
    onError: (_e, _v, c) => c?.rollback(),
    ...done,
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/api/items/${id}`),
    onMutate: (id) => ({
      rollback: optimistic(qc, projectId, (p) =>
        mapItems(p, (lists) => lists.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }))),
      ),
    }),
    onError: (_e, _v, c) => c?.rollback(),
    ...done,
  });

  const addLink = useMutation({
    mutationFn: ({ itemId, ...link }: LinkCreate & { itemId: string }) => api.post(`/api/items/${itemId}/links`, link),
    ...done,
  });
  const updateLink = useMutation({
    mutationFn: ({ id, ...patch }: LinkUpdate & { id: string }) => api.patch(`/api/links/${id}`, patch),
    ...done,
  });
  const deleteLink = useMutation({ mutationFn: (id: string) => api.delete(`/api/links/${id}`), ...done });

  return {
    updateProject,
    deleteProject,
    createChecklist,
    updateChecklist,
    deleteChecklist,
    addItems,
    updateItem,
    deleteItem,
    addLink,
    updateLink,
    deleteLink,
  };
}

const notesKey = (projectId: string) => ['project', projectId, 'notes'] as const;
const filesKey = (projectId: string) => ['project', projectId, 'attachments'] as const;

export function useNotes(projectId: string) {
  return useQuery({ queryKey: notesKey(projectId), queryFn: () => api.get<Note[]>(`/api/projects/${projectId}/notes`) });
}

export function useAttachments(projectId: string) {
  return useQuery({ queryKey: filesKey(projectId), queryFn: () => api.get<Attachment[]>(`/api/projects/${projectId}/attachments`) });
}

export interface UploadInput {
  files: File[];
  noteId?: string;
  itemId?: string;
}

/** Some files of an upload failed; the others are stored. */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly failed: File[],
  ) {
    super(message);
  }
}

/** Uploads one file after the other, so one failure doesn't lose the rest. */
async function uploadFiles(projectId: string, { files, noteId, itemId }: UploadInput): Promise<Attachment[]> {
  const done: Attachment[] = [];
  const failed: File[] = [];
  let reason = '';
  for (const original of files) {
    try {
      const file = await prepareUpload(original);
      const form = new FormData();
      form.append('file', file, file.name);
      if (noteId) form.append('note_id', noteId);
      if (itemId) form.append('item_id', itemId);
      done.push(await api.upload<Attachment>(`/api/projects/${projectId}/attachments`, form));
    } catch (err) {
      failed.push(original);
      reason = err instanceof Error ? err.message : 'Upload failed';
    }
  }
  if (failed.length) throw new UploadError(`${failed.map((f) => f.name).join(', ')}: ${reason}`, failed);
  return done;
}

export function useNoteMutations(projectId: string) {
  const qc = useQueryClient();
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: notesKey(projectId) });
    void qc.invalidateQueries({ queryKey: filesKey(projectId) });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const upload = useMutation({ mutationFn: (input: UploadInput) => uploadFiles(projectId, input), onSettled: refreshAll });

  /** Posts a note and its files. A note without text gets a short description of what was added. */
  const postNote = useMutation({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      const text = body.trim() || `Added ${files.length === 1 ? 'a file' : `${files.length} files`}`;
      const note = await api.post<Note>(`/api/projects/${projectId}/notes`, { body: text });
      if (files.length) await uploadFiles(projectId, { files, noteId: note.id });
      return note;
    },
    onSettled: refreshAll,
  });

  const updateNote = useMutation({
    mutationFn: ({ id, ...patch }: NoteUpdate & { id: string }) => api.patch<Note>(`/api/notes/${id}`, patch),
    onSettled: refreshAll,
  });
  const deleteNote = useMutation({ mutationFn: (id: string) => api.delete(`/api/notes/${id}`), onSettled: refreshAll });
  const deleteAttachment = useMutation({ mutationFn: (id: string) => api.delete(`/api/attachments/${id}`), onSettled: refreshAll });

  return { upload, postNote, updateNote, deleteNote, deleteAttachment };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectCreate) => api.post<ProjectDetail>('/api/projects', input),
    onSuccess: (p) => {
      qc.setQueryData(projectKey(p.id), p);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
