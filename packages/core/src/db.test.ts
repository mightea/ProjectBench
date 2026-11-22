import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db.ts';
import { newId } from './ids.ts';
import { checklistItems, checklists, itemLinks, projects } from './schema.ts';

let close: (() => void) | undefined;
afterEach(() => close?.());

function setup() {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  return handle;
}

describe('openDb', () => {
  it('creates all tables including the FTS index', () => {
    const { sqlite } = setup();
    const names = sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ['projects', 'checklists', 'checklist_items', 'item_links', 'notes', 'attachments', 'tags', 'project_tags', 'activity', 'settings', 'sessions', 'search']) {
      expect(names).toContain(t);
    }
  });

  it('uses foreign keys with cascading deletes', () => {
    const { db } = setup();
    const projectId = newId();
    const checklistId = newId();
    const itemId = newId();
    db.insert(projects).values({ id: projectId, title: 'Rack fan controller', sortKey: 'a0' }).run();
    db.insert(checklists).values({ id: checklistId, projectId, title: 'To buy', kind: 'buy', sortKey: 'a0' }).run();
    db.insert(checklistItems).values({ id: itemId, checklistId, text: 'Noctua NF-A4x20 PWM', quantity: 4, sortKey: 'a0' }).run();
    db.insert(itemLinks).values({ id: newId(), itemId, url: 'https://www.galaxus.ch/', shop: 'Galaxus', price: 15.9, preferred: true, sortKey: 'a0' }).run();

    const item = db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    expect(item?.state).toBe('open');
    expect(item?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    db.delete(projects).where(eq(projects.id, projectId)).run();
    expect(db.select().from(checklistItems).all()).toHaveLength(0);
    expect(db.select().from(itemLinks).all()).toHaveLength(0);
  });

  it('supports full-text search with diacritics folded', () => {
    const { sqlite } = setup();
    sqlite
      .prepare('insert into search (entity, entity_id, project_id, title, body) values (?, ?, ?, ?, ?)')
      .run('project', 'p1', 'p1', 'Lüfter Steuerung', 'ESP32 board');
    const rows = sqlite.prepare("select entity_id from search where search match 'lufter'").all();
    expect(rows).toHaveLength(1);
  });
});
