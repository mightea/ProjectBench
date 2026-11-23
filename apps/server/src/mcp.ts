import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  addAttachmentFrom,
  addItemsToProject,
  addNote,
  agenda,
  AmbiguousMatchError,
  CHECKLIST_KINDS,
  createProjectWithChecklists,
  InvalidOperationError,
  ITEM_STATES,
  listProjects,
  NotFoundError,
  openQuestions,
  preferredLink,
  PROJECT_STATUSES,
  projectMarkdown,
  readAttachmentContent,
  resolveProject,
  searchAll,
  setItemLinks,
  shoppingList,
  updateItem,
  updateProject,
  type Attachment,
  type Db,
  type FileStore,
  type ItemCreate,
  type ItemWithContext,
  type ServiceContext,
} from '@projectbench/core';
import { z, ZodError } from 'zod';
import { VERSION } from './config.ts';

const date = z.iso.date();
const priority = z.number().int().min(1).max(4).describe('1 = urgent, 2 = high, 3 = normal, 4 = low');
const projectRef = z.string().min(1).describe('Project id or title. Titles are matched fuzzily.');

const linkInput = z.object({
  url: z.string().describe('http(s) product URL'),
  shop: z.string().optional().describe('Shop name. Derived from the URL if omitted.'),
  price: z.number().nonnegative().optional().describe('Unit price'),
  currency: z.string().length(3).optional().describe('ISO currency code. Defaults to CHF.'),
  note: z.string().optional(),
  preferred: z.boolean().optional().describe('Use this link for totals and shop grouping'),
});

const itemInput = z.object({
  text: z.string().min(1),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  due_date: date.optional().describe('YYYY-MM-DD'),
  note: z.string().optional(),
  links: z.array(linkInput).max(20).optional(),
});

const toItem = ({ due_date, ...item }: z.infer<typeof itemInput>): ItemCreate => ({ ...item, dueDate: due_date });

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 2));

/** Turns expected failures into tool errors the model can read and act on. */
function toolError(err: unknown): CallToolResult {
  const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });
  if (err instanceof NotFoundError || err instanceof InvalidOperationError || err instanceof AmbiguousMatchError) {
    return failure(err.message);
  }
  if (err instanceof ZodError) {
    return failure(`Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  }
  console.error(err);
  return failure('Internal error');
}

function run(handler: () => CallToolResult): CallToolResult {
  try {
    return handler();
  } catch (err) {
    return toolError(err);
  }
}

async function runAsync(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (err) {
    return toolError(err);
  }
}

const attachmentInfo = ({ id, filename, mime, sizeBytes, width, height, caption, noteId, itemId, createdAt }: Attachment) => ({
  id,
  filename,
  mime,
  size_bytes: sizeBytes,
  width,
  height,
  caption,
  note_id: noteId,
  item_id: itemId,
  created_at: createdAt,
});

/** Compact item for list-style results. */
const brief = (item: ItemWithContext) => {
  const link = preferredLink(item);
  return {
    id: item.id,
    text: item.text,
    state: item.state,
    project: item.projectTitle,
    project_id: item.projectId,
    checklist: item.checklistTitle,
    quantity: item.quantity,
    unit: item.unit,
    due_date: item.dueDate,
    order_ref: item.orderRef,
    expected_date: item.expectedDate,
    note: item.note,
    shop: link?.shop ?? null,
    price: link?.price ?? null,
    currency: link?.currency ?? null,
    links: item.links,
  };
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function createMcpServer(db: Db, files?: FileStore): McpServer {
  const ctx: ServiceContext = { db, actor: 'mcp', files };
  const server = new McpServer(
    { name: 'projectbench', title: 'ProjectBench', version: VERSION },
    {
      instructions:
        'ProjectBench holds personal projects with checklists (buy, clarify, todo) and notes. Refer to projects by id or title. ' +
        'If a title is ambiguous, the tool lists candidates: pick one or ask the user. Nothing can be deleted through these tools; ' +
        'archive a project with update_project.',
    },
  );

  // --- Read tools -------------------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Compact list of projects with status, priority, due date and progress. Defaults to open projects.',
      inputSchema: {
        status: z.enum([...PROJECT_STATUSES, 'open', 'all']).optional().describe('Defaults to open'),
        tag: z.string().optional(),
        priority: priority.optional(),
        due_before: date.optional().describe('Only projects due on or before this date'),
        query: z.string().optional().describe('Text in the title'),
      },
      annotations: READ_ONLY,
    },
    ({ status, tag, priority: wanted, due_before, query }) =>
      run(() =>
        json(
          listProjects(ctx, { status, tag, q: query })
            .filter((p) => wanted === undefined || p.priority === wanted)
            .filter((p) => due_before === undefined || (p.dueDate !== null && p.dueDate <= due_before))
            .map((p) => ({
              id: p.id,
              title: p.title,
              status: p.status,
              priority: p.priority,
              due_date: p.dueDate,
              tags: p.tags,
              progress: p.progress,
            })),
        ),
      ),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'The full project as Markdown: fields, checklists with item and link ids, recent notes and attachment names.',
      inputSchema: { project: projectRef },
      annotations: READ_ONLY,
    },
    ({ project }) => run(() => text(projectMarkdown(ctx, resolveProject(ctx, project).id))),
  );

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Full-text search across projects (including their tags), checklist items and notes.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Words to find. #tag limits results to projects with that tag.'),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit }) => run(() => json(searchAll(ctx, query, limit))),
  );

  server.registerTool(
    'agenda',
    {
      title: 'Agenda',
      description: 'Overdue and upcoming items, projects and deliveries, plus urgent projects.',
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe('Days to look ahead. Defaults to 7.'),
        tag: z.string().optional().describe('Only projects with this tag'),
      },
      annotations: READ_ONLY,
    },
    ({ days, tag }) =>
      run(() => {
        const a = agenda(ctx, days, tag);
        const project = (p: (typeof a.urgentProjects)[number]) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          priority: p.priority,
          due_date: p.dueDate,
          progress: p.progress,
        });
        return json({
          today: a.today,
          until: a.until,
          overdue_items: a.overdueItems.map(brief),
          upcoming_items: a.upcomingItems.map(brief),
          late_deliveries: a.lateDeliveries.map(brief),
          upcoming_deliveries: a.upcomingDeliveries.map(brief),
          overdue_projects: a.overdueProjects.map(project),
          upcoming_projects: a.upcomingProjects.map(project),
          urgent_projects: a.urgentProjects.map(project),
        });
      }),
  );

  server.registerTool(
    'shopping_list',
    {
      title: 'Shopping list',
      description: 'Items still to buy or on order, with shop links, order numbers and expected dates.',
      inputSchema: {
        state: z.enum(['open', 'ordered']).optional().describe('open = still to buy, ordered = on its way. Defaults to both.'),
        shop: z.string().optional().describe("Text in the preferred link's shop name"),
        project: projectRef.optional(),
        tag: z.string().optional().describe('Only projects with this tag'),
      },
      annotations: READ_ONLY,
    },
    ({ state, shop, project, tag }) =>
      run(() => json(shoppingList(ctx, { state, shop, tag, projectId: project ? resolveProject(ctx, project).id : undefined }).map(brief))),
  );

  server.registerTool(
    'open_questions',
    {
      title: 'Open questions',
      description: 'Open "to clarify" items: what still needs deciding.',
      inputSchema: { project: projectRef.optional() },
      annotations: READ_ONLY,
    },
    ({ project }) => run(() => json(openQuestions(ctx, project ? resolveProject(ctx, project).id : undefined).map(brief))),
  );

  // --- Write tools ------------------------------------------------------------

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Creates a project, optionally with starter checklists and items.',
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        priority: priority.optional(),
        due_date: date.optional(),
        tags: z.array(z.string()).max(20).optional(),
        checklists: z
          .array(z.object({ title: z.string().optional(), kind: z.enum(CHECKLIST_KINDS), items: z.array(itemInput).max(200).optional() }))
          .max(20)
          .optional(),
      },
      annotations: ADDITIVE,
    },
    ({ due_date, checklists, ...fields }) =>
      run(() => {
        const project = createProjectWithChecklists(
          ctx,
          { ...fields, dueDate: due_date },
          checklists?.map((list) => ({ ...list, items: list.items?.map(toItem) })),
        );
        return text(projectMarkdown(ctx, project.id));
      }),
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description: 'Changes project fields. Set status to archived to archive it. Null clears a due date or description.',
      inputSchema: {
        project: projectRef,
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        priority: priority.optional(),
        due_date: date.nullable().optional(),
        tags: z.array(z.string()).max(20).optional().describe('Replaces all tags'),
      },
      annotations: UPDATE,
    },
    ({ project, due_date, ...fields }) =>
      run(() => {
        const { id } = resolveProject(ctx, project);
        updateProject(ctx, id, { ...fields, dueDate: due_date });
        return text(projectMarkdown(ctx, id));
      }),
  );

  server.registerTool(
    'add_items',
    {
      title: 'Add items',
      description:
        'Adds items to a checklist, named by title or kind ("buy", "clarify", "todo"). Creates the checklist if the project has no match.',
      inputSchema: {
        project: projectRef,
        checklist: z.string().min(1).describe('Checklist id, title or kind'),
        kind: z.enum(CHECKLIST_KINDS).optional().describe('Kind for a new checklist with a custom title'),
        items: z.array(itemInput).min(1).max(200),
      },
      annotations: ADDITIVE,
    },
    ({ project, checklist, kind, items }) =>
      run(() => {
        const result = addItemsToProject(ctx, project, checklist, items.map(toItem), kind);
        return json({
          project: result.project,
          checklist: { id: result.checklist.id, title: result.checklist.title, kind: result.checklist.kind, created: result.checklistCreated },
          items: result.items.map((i) => ({ id: i.id, text: i.text, state: i.state, links: i.links })),
        });
      }),
  );

  server.registerTool(
    'update_item',
    {
      title: 'Update item',
      description:
        'Changes a checklist item: mark it ordered or done, record an order number or delivery date, answer a clarify item in its note. ' +
        `State is one of ${ITEM_STATES.join(', ')}; ordered only works on buy lists.`,
      inputSchema: {
        item_id: z.string().min(1),
        state: z.enum(ITEM_STATES).optional(),
        order_ref: z.string().nullable().optional(),
        expected_date: date.nullable().optional(),
        text: z.string().min(1).optional(),
        quantity: z.number().positive().nullable().optional(),
        unit: z.string().nullable().optional(),
        due_date: date.nullable().optional(),
        note: z.string().nullable().optional(),
      },
      annotations: UPDATE,
    },
    ({ item_id, order_ref, expected_date, due_date, ...fields }) =>
      run(() => json(updateItem(ctx, item_id, { ...fields, orderRef: order_ref, expectedDate: expected_date, dueDate: due_date }))),
  );

  server.registerTool(
    'set_item_links',
    {
      title: 'Set item links',
      description:
        "Adds or removes an item's shop links, or replaces all of them. Use replace alone, or add and remove together. Link ids are in get_project.",
      inputSchema: {
        item_id: z.string().min(1),
        replace: z.array(linkInput).max(20).optional().describe('Replaces all links'),
        add: z.array(linkInput).max(20).optional(),
        remove: z.array(z.string()).max(50).optional().describe('Link ids to remove'),
      },
      annotations: { ...UPDATE, destructiveHint: true },
    },
    ({ item_id, ...change }) => run(() => json(setItemLinks(ctx, item_id, change))),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add note',
      description: "Appends a note to the project's timeline.",
      inputSchema: { project: projectRef, body: z.string().min(1).describe('Markdown') },
      annotations: ADDITIVE,
    },
    ({ project, body }) => run(() => json(addNote(ctx, resolveProject(ctx, project).id, { body }))),
  );

  server.registerTool(
    'get_attachment',
    {
      title: 'Get attachment',
      description:
        'Reads an attachment. Images come back resized, PDFs and text files as text, other files as details only. Attachment ids are in get_project.',
      inputSchema: { attachment_id: z.string().min(1) },
      annotations: READ_ONLY,
    },
    ({ attachment_id }) =>
      runAsync(async () => {
        const content = await readAttachmentContent(ctx, attachment_id);
        const info = attachmentInfo(content.attachment);
        if (content.kind === 'image') {
          return {
            content: [
              { type: 'text', text: JSON.stringify(info, null, 2) },
              { type: 'image', data: content.base64, mimeType: content.mime },
            ],
          };
        }
        if (content.kind === 'text') {
          const details = JSON.stringify(content.pages === undefined ? info : { ...info, pages: content.pages }, null, 2);
          return {
            content: [
              { type: 'text', text: details },
              { type: 'text', text: content.text || 'This file contains no readable text.' },
            ],
          };
        }
        return json({ ...info, content: 'This file type cannot be shown here.' });
      }),
  );

  server.registerTool(
    'add_attachment',
    {
      title: 'Add attachment',
      description:
        'Attaches a file of up to 50 MB to a project, optionally on a note or item. Give a public http(s) url or base64 data with a filename.',
      inputSchema: {
        project: projectRef,
        url: z.string().max(2000).optional().describe('Public http(s) URL to download. Private addresses are refused.'),
        base64: z.string().optional().describe('File content as base64'),
        filename: z.string().min(1).max(255).optional().describe('Required with base64. Derived from the URL if omitted.'),
        note_id: z.string().min(1).optional(),
        item_id: z.string().min(1).optional(),
        caption: z.string().max(500).optional(),
      },
      annotations: { ...ADDITIVE, openWorldHint: true },
    },
    ({ project, note_id, item_id, ...source }) =>
      runAsync(async () =>
        json(attachmentInfo(await addAttachmentFrom(ctx, resolveProject(ctx, project).id, { ...source, noteId: note_id, itemId: item_id }))),
      ),
  );

  return server;
}

/** Handles one MCP request. The server is stateless, so each request gets its own instance. */
export async function handleMcpRequest(db: Db, request: Request, files?: FileStore): Promise<Response> {
  const server = createMcpServer(db, files);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
