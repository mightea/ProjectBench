import type {
  Checklist,
  ChecklistCreate,
  ChecklistItem,
  ChecklistUpdate,
  ItemCreate,
  ItemUpdate,
  LinkCreate,
  LinkUpdate,
  ProjectCreate,
  ProjectDetail,
  ProjectSummary,
  ProjectUpdate,
} from '@projectbench/core/schemas';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';

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

function refresh(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: projectKey(projectId) });
  void qc.invalidateQueries({ queryKey: ['projects'] });
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
  const done = { onSettled: () => refresh(qc, projectId) };

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
