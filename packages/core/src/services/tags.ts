import { asc, eq, inArray } from 'drizzle-orm';
import { newId } from '../ids.ts';
import { projectTags, tags } from '../schema.ts';
import type { DbLike } from './context.ts';

export const normalizeTag = (name: string) => name.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');

/** Replaces a project's tags, creating tags that do not exist yet. */
export function setProjectTags(tx: DbLike, projectId: string, names: string[]) {
  const wanted = [...new Set(names.map(normalizeTag).filter(Boolean))];
  tx.delete(projectTags).where(eq(projectTags.projectId, projectId)).run();
  if (wanted.length === 0) return;

  const existing = tx.select().from(tags).where(inArray(tags.name, wanted)).all();
  const byName = new Map(existing.map((t) => [t.name, t.id]));
  for (const name of wanted) {
    if (!byName.has(name)) {
      const id = newId();
      tx.insert(tags).values({ id, name }).run();
      byName.set(name, id);
    }
  }
  tx.insert(projectTags)
    .values(wanted.map((name) => ({ projectId, tagId: byName.get(name)! })))
    .run();
}

/** Tag names per project id. */
export function tagsForProjects(tx: DbLike, projectIds: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (projectIds.length === 0) return result;
  const rows = tx
    .select({ projectId: projectTags.projectId, name: tags.name })
    .from(projectTags)
    .innerJoin(tags, eq(tags.id, projectTags.tagId))
    .where(inArray(projectTags.projectId, projectIds))
    .orderBy(asc(tags.name))
    .all();
  for (const r of rows) result.set(r.projectId, [...(result.get(r.projectId) ?? []), r.name]);
  return result;
}

export function listTags(tx: DbLike): { name: string; projects: number }[] {
  const rows = tx
    .select({ name: tags.name, projectId: projectTags.projectId })
    .from(tags)
    .leftJoin(projectTags, eq(projectTags.tagId, tags.id))
    .orderBy(asc(tags.name))
    .all();
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + (r.projectId ? 1 : 0));
  return [...counts].map(([name, projects]) => ({ name, projects }));
}
