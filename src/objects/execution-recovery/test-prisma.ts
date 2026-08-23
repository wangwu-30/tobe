import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type Transaction,
} from '@libsql/client';

type RawSqlDb = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

type TestPrismaClient = RawSqlDb & {
  $disconnect(): Promise<void>;
  $transaction<T>(action: (db: RawSqlDb) => Promise<T>): Promise<T>;
};

let client: Client | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is required for execution recovery tests.');
  }
  client = createClient({ url });
  return client;
}

function rawDb(executor: Pick<Client | Transaction, 'execute'>): RawSqlDb {
  return {
    async $executeRaw(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<number> {
      const result = await executor.execute(statement(strings, values));
      return result.rowsAffected;
    },
    async $queryRaw<T>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T> {
      const result = await executor.execute(statement(strings, values));
      return result.rows as T;
    },
  };
}

export const prisma: TestPrismaClient = {
  async $executeRaw(strings, ...values) {
    return rawDb(getClient()).$executeRaw(strings, ...values);
  },
  async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]) {
    return rawDb(getClient()).$queryRaw<T>(strings, ...values);
  },
  async $transaction<T>(action: (db: RawSqlDb) => Promise<T>) {
    const transaction = await getClient().transaction('write');
    try {
      const result = await action(rawDb(transaction));
      await transaction.commit();
      return result;
    } catch (error) {
      if (!transaction.closed) await transaction.rollback();
      throw error;
    } finally {
      if (!transaction.closed) transaction.close();
    }
  },
  async $disconnect() {
    client?.close();
    client = null;
  },
};

function statement(strings: TemplateStringsArray, values: unknown[]): InStatement {
  let sql = strings[0] || '';
  for (let index = 0; index < values.length; index += 1) {
    sql += `?${strings[index + 1] || ''}`;
  }
  return { sql, args: values.map(toSqlValue) };
}

function toSqlValue(value: unknown): InValue {
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
  throw new Error('Recovery test SQL received an unsupported bound value.');
}
