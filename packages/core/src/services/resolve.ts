import { AmbiguousMatchError, NotFoundError } from '../errors.ts';
import { projects } from '../schema.ts';
import type { ServiceContext } from './context.ts';

/** Lower case, no accents, words separated by single spaces. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Words shorter than four letters must match exactly; longer ones allow one typo per four letters. */
const closeEnough = (word: string, candidate: string) =>
  word === candidate || (word.length >= 4 && editDistance(word, candidate) <= Math.floor(word.length / 4));

/**
 * Finds records by name, trying stricter rules first and stopping at the first rule that matches:
 * same name, name contains the text, name contains all words, then all words with small typos.
 */
export function matchByName<T extends { title: string }>(records: T[], ref: string): T[] {
  const wanted = normalizeName(ref);
  if (!wanted) return [];
  const named = records.map((record) => ({ record, name: normalizeName(record.title) }));
  const words = wanted.split(' ');
  const rules: ((name: string) => boolean)[] = [
    (name) => name === wanted,
    (name) => name.includes(wanted),
    (name) => words.every((word) => name.includes(word)),
    (name) => {
      const nameWords = name.split(' ');
      return words.every((word) => nameWords.some((candidate) => closeEnough(word, candidate)));
    },
  ];
  for (const rule of rules) {
    const hits = named.filter(({ name }) => rule(name)).map(({ record }) => record);
    if (hits.length) return hits;
  }
  return [];
}

/** Resolves a project id or title. Several matches raise an error that lists the candidates. */
export function resolveProject(ctx: ServiceContext, ref: string): { id: string; title: string } {
  const rows = ctx.db.select({ id: projects.id, title: projects.title, status: projects.status }).from(projects).all();
  const byId = rows.find((r) => r.id === ref);
  if (byId) return { id: byId.id, title: byId.title };

  let hits = matchByName(rows, ref);
  if (hits.length > 1) {
    const open = hits.filter((r) => r.status !== 'done' && r.status !== 'archived');
    if (open.length > 0) hits = open;
  }
  if (hits.length === 0) throw new NotFoundError('Project', ref);
  if (hits.length > 1) throw new AmbiguousMatchError('project', ref, hits.map(({ id, title }) => ({ id, title })));
  return { id: hits[0]!.id, title: hits[0]!.title };
}
