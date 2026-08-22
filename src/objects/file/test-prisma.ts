import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type Transaction,
} from '@libsql/client';

type QueryArgs = {
  data?: Record<string, unknown>;
  orderBy?: unknown;
  select?: Record<string, unknown>;
  where?: Record<string, unknown>;
};

type ModelDelegate = {
  create<T = Record<string, unknown>>(args: QueryArgs): Promise<T>;
  delete<T = Record<string, unknown>>(args: QueryArgs): Promise<T>;
  findFirst<T = Record<string, unknown>>(args: QueryArgs): Promise<T | null>;
  findMany<T = Record<string, unknown>>(args: QueryArgs): Promise<T[]>;
  findUnique<T = Record<string, unknown>>(args: QueryArgs): Promise<T | null>;
  update<T = Record<string, unknown>>(args: QueryArgs): Promise<T>;
  updateMany(args: QueryArgs): Promise<{ count: number }>;
  upsert(args: QueryArgs): Promise<Record<string, unknown>>;
};

export type PrismaClientLike = {
  $disconnect(): Promise<void>;
  $transaction<T>(action: (db: PrismaClientLike) => Promise<T>): Promise<T>;
  commentThread: ModelDelegate;
  document: ModelDelegate;
  session: ModelDelegate;
  syncEvent: ModelDelegate;
  wikiEditLock: ModelDelegate;
  workspaceFile: ModelDelegate;
};

let client: Client | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required for file command tests.');
  client = createClient({ url });
  return client;
}

function createDb(executor: Pick<Client | Transaction, 'execute'>): PrismaClientLike {
  const makeModel = (table: string): ModelDelegate => ({
    async create<T = Record<string, unknown>>(args: QueryArgs) {
      const data = args.data || {};
      const columns = Object.keys(data);
      const values = columns.map((column) => normalizeWriteValue(data[column]));
      const id = typeof data.id === 'string' ? data.id : crypto.randomUUID();
      if (!columns.includes('id')) {
        columns.unshift('id');
        values.unshift(id);
      }
      const now = new Date();
      if (table !== 'SyncEvent' && !columns.includes('createdAt')) {
        columns.push('createdAt');
        values.push(now);
      }
      if (table !== 'SyncEvent' && !columns.includes('updatedAt')) {
        columns.push('updatedAt');
        values.push(now);
      }
      await executor.execute({
        sql:
          'INSERT INTO "' +
          table +
          '" (' +
          columns.map(quote).join(', ') +
          ') VALUES (' +
          columns.map(() => '?').join(', ') +
          ')',
        args: values,
      });
      return (await findOne(executor, table, { id }, undefined)) as T;
    },
    async delete<T = Record<string, unknown>>(args: QueryArgs) {
      const row = await findOne(executor, table, args.where || {}, undefined);
      await executeUpdate(executor, table, args.where || {}, {}, true);
      return (row || {}) as T;
    },
    async findFirst<T = Record<string, unknown>>(args: QueryArgs) {
      return findOne(executor, table, args.where || {}, args.orderBy) as Promise<T | null>;
    },
    async findMany<T = Record<string, unknown>>(args: QueryArgs) {
      return findMany(executor, table, args.where || {}, args.orderBy) as Promise<T[]>;
    },
    async findUnique<T = Record<string, unknown>>(args: QueryArgs) {
      return findOne(executor, table, args.where || {}, args.orderBy) as Promise<T | null>;
    },
    async update<T = Record<string, unknown>>(args: QueryArgs) {
      await executeUpdate(executor, table, args.where || {}, args.data || {});
      return (await findOne(executor, table, args.where || {}, undefined)) as T;
    },
    async updateMany(args) {
      return {
        count: await executeUpdate(executor, table, args.where || {}, args.data || {}),
      };
    },
    async upsert() {
      throw new Error('upsert is not implemented by the file test database.');
    },
  });

  return {
    async $disconnect() {},
    async $transaction<T>(action: (db: PrismaClientLike) => Promise<T>) {
      const transaction = await getClient().transaction('write');
      try {
        const result = await action(createDb(transaction));
        await transaction.commit();
        return result;
      } catch (error) {
        if (!transaction.closed) await transaction.rollback();
        throw error;
      } finally {
        if (!transaction.closed) transaction.close();
      }
    },
    commentThread: makeModel('CommentThread'),
    document: makeModel('Document'),
    session: makeModel('Session'),
    syncEvent: makeModel('SyncEvent'),
    wikiEditLock: makeModel('WikiEditLock'),
    workspaceFile: makeModel('WorkspaceFile'),
  };
}

export const prisma: PrismaClientLike = {
  ...createDb({
    execute(statement: InStatement | string) {
      return getClient().execute(statement);
    },
  }),
  async $disconnect() {
    client?.close();
    client = null;
  },
};

async function findOne(
  executor: Pick<Client | Transaction, 'execute'>,
  table: string,
  where: Record<string, unknown>,
  orderBy: unknown
): Promise<Record<string, unknown> | null> {
  const rows: Array<Record<string, unknown>> = await findMany(
    executor,
    table,
    where,
    orderBy,
    1
  );
  return rows[0] || null;
}

async function findMany(
  executor: Pick<Client | Transaction, 'execute'>,
  table: string,
  where: Record<string, unknown>,
  orderBy: unknown,
  limit?: number
): Promise<Array<Record<string, unknown>>> {
  const values: InValue[] = [];
  const whereSql = buildWhere(where, values);
  const orderSql = buildOrderBy(orderBy);
  const result = await executor.execute({
    sql:
      'SELECT * FROM "' +
      table +
      '"' +
      whereSql +
      orderSql +
      (limit ? ' LIMIT ' + limit : ''),
    args: values,
  });
  const rows = result.rows.map(mapRow);
  if (table !== 'Session') return rows;
  return Promise.all(rows.map((row) => hydrateSession(executor, row)));
}

async function hydrateSession(
  executor: Pick<Client | Transaction, 'execute'>,
  row: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const activeFileId = typeof row.activeFileId === 'string' ? row.activeFileId : null;
  const activeFile: Record<string, unknown> | null = activeFileId
    ? await findOne(executor, 'WorkspaceFile', { id: activeFileId }, undefined)
    : null;
  return {
    ...row,
    activeFile: activeFile ? { documentId: activeFile.documentId } : null,
    messages: [],
  };
}

async function executeUpdate(
  executor: Pick<Client | Transaction, 'execute'>,
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
  remove = false
) {
  const values: InValue[] = [];
  const setters = Object.entries(data).map(([column, value]) => {
    if (isObject(value) && typeof value.increment === 'number') {
      values.push(value.increment);
      return quote(column) + ' = ' + quote(column) + ' + ?';
    }
    values.push(normalizeWriteValue(value));
    return quote(column) + ' = ?';
  });
  if (!remove && table !== 'SyncEvent' && !Object.hasOwn(data, 'updatedAt')) {
    setters.push('"updatedAt" = ?');
    values.push(new Date());
  }
  const whereSql = buildWhere(where, values);
  const sql = remove
    ? 'DELETE FROM "' + table + '"' + whereSql
    : 'UPDATE "' + table + '" SET ' + setters.join(', ') + whereSql;
  const result = await executor.execute({ sql, args: values });
  return result.rowsAffected;
}

function buildWhere(where: Record<string, unknown>, values: InValue[]): string {
  const clauses: string[] = [];
  for (const [column, value] of Object.entries(where)) {
    if (column === 'OR' && Array.isArray(value)) {
      const nested = value.map((entry) =>
        buildWhere(entry as Record<string, unknown>, values).replace(/^ WHERE /, '')
      );
      clauses.push('(' + nested.join(' OR ') + ')');
      continue;
    }
    if (value === null) {
      clauses.push(quote(column) + ' IS NULL');
      continue;
    }
    if (isObject(value)) {
      if (Array.isArray(value.in)) {
        clauses.push(inClause(column, value.in, values, false));
      } else if (Array.isArray(value.notIn)) {
        clauses.push(inClause(column, value.notIn, values, true));
      } else if (value.not !== undefined) {
        values.push(normalizeWriteValue(value.not));
        clauses.push(quote(column) + ' <> ?');
      } else if (typeof value.startsWith === 'string') {
        values.push(value.startsWith + '%');
        clauses.push(quote(column) + ' LIKE ?');
      }
      continue;
    }
    values.push(normalizeWriteValue(value));
    clauses.push(quote(column) + ' = ?');
  }
  return clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';
}

function inClause(
  column: string,
  input: unknown[],
  values: InValue[],
  negate: boolean
) {
  if (input.length === 0) return negate ? '1 = 1' : '1 = 0';
  values.push(...input.map(normalizeWriteValue));
  return (
    quote(column) +
    (negate ? ' NOT IN (' : ' IN (') +
    input.map(() => '?').join(', ') +
    ')'
  );
}

function buildOrderBy(orderBy: unknown) {
  const entries = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  const clauses = entries.flatMap((entry) =>
    isObject(entry)
      ? Object.entries(entry).map(
          ([column, direction]) =>
            quote(column) + (direction === 'desc' ? ' DESC' : ' ASC')
        )
      : []
  );
  return clauses.length > 0 ? ' ORDER BY ' + clauses.join(', ') : '';
}

function normalizeWriteValue(value: unknown): InValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }
  throw new Error('File test SQL received an unsupported bound value.');
}

function mapRow(row: Record<string, unknown>) {
  const result = { ...row };
  for (const key of ['createdAt', 'deletedAt', 'expiresAt', 'occurredAt', 'updatedAt']) {
    if (typeof result[key] === 'string') result[key] = new Date(result[key]);
  }
  if (typeof result.isPrimary === 'number') {
    result.isPrimary = result.isPrimary !== 0;
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quote(identifier: string) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}
