import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/** Sortable, URL-safe unique id (ULID). */
export function newId(): string {
  return ulid();
}
