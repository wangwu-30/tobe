import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type Transaction,
} from '@libsql/client';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';

import { PrismaClientKnownRequestError } from './test-generated-prisma';

type LabelRow = {
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  id: string;
  kind: string;
  name: string;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  updatedAt: Date;
  versionId: string;
};

type MembershipRow = {
  role: string;
};

type VersionRow = {
  content: string;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  lockedAt: Date;
  organizationId: string;
  originDeviceId: string | null;
  parentVersionId: string | null;
  revision: number;
  sourceMessageId: string | null;
  sourceSessionId: string | null;
  title: string;
  versionNum: number;
};

type VersionWithLabels = VersionRow & { labels: LabelRow[] };

type SelectableVersion = {
  include?: {
    labels?: {
      where?: {
        deletedAt?: null;
      };
    };
  };
  select?: never;
};

type TestTransactionClient = {
  organizationMembership: {
    findUnique(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
      select: { role: true };
    }): Promise<MembershipRow | null>;
  };
  version: {
    findFirst(args: {
      where: {
        deletedAt: null;
        documentId: string;
        id: string;
        organizationId: string;
      };
      include?: { labels?: { where?: { deletedAt?: null } } };
    }): Promise<VersionWithLabels | VersionRow | null>;
  };
  label: {
    create(args: {
      data: {
        organizationId: string;
        versionId: string;
        kind: string;
        name: string;
        createdByUserId?: string | null;
        originDeviceId?: string | null;
      };
    }): Promise<LabelRow>;
    findMany(args: {
      where: {
        deletedAt: null;
        organizationId: string;
        versionId: { in: string[] };
      };
      orderBy: Array<{ createdAt: 'asc' } | { id: 'asc' }>;
    }): Promise<LabelRow[]>;
  };
};

type TestPrismaClient = TestTransactionClient & {
  $disconnect(): Promise<void>;
  $transaction<T>(action: (db: TestTransactionClient) => Promise<T>): Promise<T>;
};

let client: Client | null = null;
const STATE_TEST_SQLITE_BUSY_RETRY_DELAYS_MS = [
  10,
  25,
  50,
  100,
  200,
  400,
  800,
] as const;
const STATE_TEST_SQLITE_BUSY_TIMEOUT_MS = 750;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is required for state tests.');
  }
  client = createClient({ url });
  return client;
}

async function configureClient(client: Client) {
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute(
    `PRAGMA busy_timeout = ${String(STATE_TEST_SQLITE_BUSY_TIMEOUT_MS)}`
  );
}

function mapLabelRow(row: Record<string, unknown>): Omit<LabelRow, 'createdAt' | 'deletedAt' | 'updatedAt'> & {
  createdAt: string;
  deletedAt: string | null;
  updatedAt: string;
} {
  return {
    createdAt: String(row.createdAt),
    createdByUserId:
      row.createdByUserId === null ? null : String(row.createdByUserId),
    deletedAt: row.deletedAt === null ? null : String(row.deletedAt),
    id: String(row.id),
    kind: String(row.kind),
    name: String(row.name),
    organizationId: String(row.organizationId),
    originDeviceId:
      row.originDeviceId === null ? null : String(row.originDeviceId),
    revision: Number(row.revision),
    updatedAt: String(row.updatedAt),
    versionId: String(row.versionId),
  };
}

function mapVersionRow(row: Record<string, unknown>): Omit<
  VersionRow,
  'deletedAt' | 'lockedAt'
> & {
  deletedAt: string | null;
  lockedAt: string;
} {
  return {
    content: String(row.content),
    createdByUserId:
      row.createdByUserId === null ? null : String(row.createdByUserId),
    deletedAt: row.deletedAt === null ? null : String(row.deletedAt),
    documentId: String(row.documentId),
    id: String(row.id),
    lockedAt: String(row.lockedAt),
    organizationId: String(row.organizationId),
    originDeviceId:
      row.originDeviceId === null ? null : String(row.originDeviceId),
    parentVersionId:
      row.parentVersionId === null ? null : String(row.parentVersionId),
    revision: Number(row.revision),
    sourceMessageId:
      row.sourceMessageId === null ? null : String(row.sourceMessageId),
    sourceSessionId:
      row.sourceSessionId === null ? null : String(row.sourceSessionId),
    title: String(row.title),
    versionNum: Number(row.versionNum),
  };
}

function toDateFields<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  keys: readonly K[]
): T & { [P in K]: Date | null } {
  const copy: T & { [P in K]: Date | null } = {
    ...row,
  } as T & { [P in K]: Date | null };
  for (const key of keys) {
    const value = copy[key];
    copy[key] = (
      value === null || value instanceof Date
        ? value
        : new Date(String(value))
    ) as (T & { [P in K]: Date | null })[K];
  }
  return copy;
}

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
  throw new Error('State test SQL received an unsupported bound value.');
}

function wrapTransaction(executor: Pick<Client | Transaction, 'execute'>): TestTransactionClient {
  return {
    organizationMembership: {
      async findUnique(args) {
        const result = await executor.execute({
          sql: `
            SELECT "role"
            FROM "OrganizationMembership"
            WHERE "organizationId" = ?
              AND "userId" = ?
            LIMIT 1
          `,
          args: [
            args.where.organizationId_userId.organizationId,
            args.where.organizationId_userId.userId,
          ],
        });
        if (result.rows.length === 0) return null;
        return { role: String(result.rows[0]?.role) };
      },
    },
    version: {
      async findFirst(args) {
        const result = await executor.execute({
          sql: `
            SELECT
              "id",
              "organizationId",
              "documentId",
              "versionNum",
              "content",
              "title",
              "parentVersionId",
              "sourceSessionId",
              "sourceMessageId",
              "createdByUserId",
              "originDeviceId",
              "revision",
              "deletedAt",
              "lockedAt"
            FROM "Version"
            WHERE "deletedAt" IS NULL
              AND "documentId" = ?
              AND "id" = ?
              AND "organizationId" = ?
            LIMIT 1
          `,
          args: [
            args.where.documentId,
            args.where.id,
            args.where.organizationId,
          ],
        });
        if (result.rows.length === 0) return null;
        const version = toDateFields(
          mapVersionRow(result.rows[0] as Record<string, unknown>),
          ['deletedAt', 'lockedAt'] as const
        );
        if (!args.include?.labels) {
          return version;
        }
        const labels = await executor.execute({
          sql: `
            SELECT
              "id",
              "organizationId",
              "versionId",
              "kind",
              "name",
              "createdByUserId",
              "originDeviceId",
              "revision",
              "deletedAt",
              "createdAt",
              "updatedAt"
            FROM "Label"
            WHERE "versionId" = ?
              AND "deletedAt" IS NULL
            ORDER BY "createdAt" ASC, "id" ASC
          `,
          args: [version.id],
        });
        return {
          ...version,
          labels: labels.rows.map((row) =>
            toDateFields(
              mapLabelRow(row as Record<string, unknown>),
              ['createdAt', 'deletedAt', 'updatedAt'] as const
            )
          ),
        };
      },
    },
    label: {
      async create(args) {
        const id = `aligned-${Math.random().toString(36).slice(2)}`;
        const now = new Date();
        try {
          await executor.execute({
            sql: `
              INSERT INTO "Label" (
                "id",
                "organizationId",
                "versionId",
                "kind",
                "name",
                "createdByUserId",
                "originDeviceId",
                "revision",
                "deletedAt",
                "createdAt",
                "updatedAt"
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
            `,
            args: [
              id,
              args.data.organizationId,
              args.data.versionId,
              args.data.kind,
              args.data.name,
              args.data.createdByUserId ?? null,
              args.data.originDeviceId ?? null,
              now.toISOString(),
              now.toISOString(),
            ],
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error ?? 'Unknown error');
          if (/UNIQUE constraint failed|constraint failed/u.test(message)) {
            throw new PrismaClientKnownRequestError(message, 'P2002');
          }
          throw error;
        }
        return {
          id,
          organizationId: args.data.organizationId,
          versionId: args.data.versionId,
          kind: args.data.kind,
          name: args.data.name,
          createdByUserId: args.data.createdByUserId ?? null,
          originDeviceId: args.data.originDeviceId ?? null,
          revision: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
      },
      async findMany(args) {
        const placeholders = args.where.versionId.in.map(() => '?').join(', ');
        const result = await executor.execute({
          sql: `
            SELECT
              "id",
              "organizationId",
              "versionId",
              "kind",
              "name",
              "createdByUserId",
              "originDeviceId",
              "revision",
              "deletedAt",
              "createdAt",
              "updatedAt"
            FROM "Label"
            WHERE "deletedAt" IS NULL
              AND "organizationId" = ?
              AND "versionId" IN (${placeholders})
            ORDER BY "createdAt" ASC, "id" ASC
          `,
          args: [args.where.organizationId, ...args.where.versionId.in],
        });
        return result.rows.map((row) =>
          toDateFields(
            mapLabelRow(row as Record<string, unknown>),
            ['createdAt', 'deletedAt', 'updatedAt'] as const
          )
        );
      },
    },
  };
}

export function createStateTestPrismaClient(databaseUrl?: string): TestPrismaClient {
  const scopedClient = databaseUrl
    ? createClient({ url: databaseUrl })
    : null;
  const resolveClient = () => scopedClient ?? getClient();

  return {
    organizationMembership: {
      async findUnique(args) {
        return wrapTransaction(resolveClient()).organizationMembership.findUnique(args);
      },
    },
    version: {
      async findFirst(args) {
        return wrapTransaction(resolveClient()).version.findFirst(args);
      },
    },
    label: {
      async create(args) {
        return wrapTransaction(resolveClient()).label.create(args);
      },
      async findMany(args) {
        return wrapTransaction(resolveClient()).label.findMany(args);
      },
    },
    async $transaction<T>(action: (db: TestTransactionClient) => Promise<T>) {
      return retrySqliteBusyV1(async () => {
        const baseClient =
          databaseUrl !== undefined
            ? createClient({ url: databaseUrl })
            : resolveClient();
        await configureClient(baseClient);
        const transaction = await baseClient.transaction('write');
        let commitError: unknown = null;
        try {
          const result = await action(wrapTransaction(transaction));
          await transaction.commit();
          return result;
        } catch (error) {
          commitError = error;
          throw error;
        } finally {
          if (!transaction.closed) {
            try {
              await transaction.rollback();
            } catch {
              // Best-effort rollback after a failed commit/command must never
              // block close or the outer busy retry.
            } finally {
              try {
                transaction.close();
              } catch {
                // Closing a failed libsql transaction is best-effort only.
              }
            }
          }
          if (databaseUrl !== undefined) {
            try {
              baseClient.close();
            } catch {
              // Attempt-local clients are disposable; close errors must not
              // hide the original busy/constraint failure.
            }
          }
        }
      }, {
        delaysMs: STATE_TEST_SQLITE_BUSY_RETRY_DELAYS_MS,
      });
    },
    async $disconnect() {
      if (scopedClient) {
        scopedClient.close();
        return;
      }
      client?.close();
      client = null;
    },
  };
}

export const prisma: TestPrismaClient = createStateTestPrismaClient();

export function queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]) {
  return getClient().execute(statement(strings, values)) as Promise<T>;
}
