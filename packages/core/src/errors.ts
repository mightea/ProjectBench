export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

/** A name matched several records; the caller should pick one of the candidates. */
export class AmbiguousMatchError extends Error {
  constructor(
    entity: string,
    ref: string,
    public readonly candidates: { id: string; title: string }[],
  ) {
    const list = candidates.map((c) => `- ${c.title} (id: ${c.id})`).join('\n');
    super(`"${ref}" matches several ${entity}s. Use one of these ids:\n${list}`);
    this.name = 'AmbiguousMatchError';
  }
}
