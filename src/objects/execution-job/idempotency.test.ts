import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { toAppError } from '@/framework/resilience/app-error';
import {
  IdempotencyConflictError,
  withAtomicIdempotency,
} from '@/lib/platform/idempotency';

import { prisma as testPrisma } from './test-prisma';

const ORGANIZATION_ID = 'atomic-idempotency-org';
const USER_ID = 'atomic-idempotency-user';
const OPERATION = 'atomic-probe:create:v1';

let client: Client;
let temporaryRoot: string;

test.describe.serial('atomic idempotency', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-atomic-idempotency-')
    );
    const databasePath = path.join(temporaryRoot, 'idempotency.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });

    await client.executeMultiple(`
      CREATE TABLE "MutationRequest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "requestKey" TEXT NOT NULL,
        "requestHash" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'in_progress',
        "responseJson" TEXT,
        "resourceType" TEXT,
        "resourceId" TEXT,
        "errorMessage" TEXT,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE UNIQUE INDEX "MutationRequest_scope_key"
        ON "MutationRequest"(
          "organizationId", "userId", "operation", "requestKey"
        );

      CREATE TABLE "AtomicProbe" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "value" TEXT NOT NULL
      );
    `);
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('rolls back the claim and domain write when receipt completion fails', async () => {
    const key = 'rollback-key';

    await expect(
      withAtomicIdempotency({
        action: async (db) => {
          await db.$executeRaw`
            INSERT INTO "AtomicProbe" ("id", "value")
            VALUES ('rollback-probe', 'uncommitted')
          `;
          return { id: 'rollback-probe' };
        },
        key,
        operation: OPERATION,
        organizationId: ORGANIZATION_ID,
        requestHash: 'rollback-hash',
        resource: () => {
          throw new Error('receipt metadata failed');
        },
        userId: USER_ID,
      })
    ).rejects.toThrow('receipt metadata failed');

    expect(await countRows('AtomicProbe')).toBe(0);
    expect(await countRows('MutationRequest')).toBe(0);

    const result = await withAtomicIdempotency({
      action: async (db) => {
        await db.$executeRaw`
          INSERT INTO "AtomicProbe" ("id", "value")
          VALUES ('rollback-probe', 'committed')
        `;
        return { id: 'rollback-probe' };
      },
      key,
      operation: OPERATION,
      organizationId: ORGANIZATION_ID,
      requestHash: 'rollback-hash',
      resource: ({ id }) => ({
        resourceId: id,
        resourceType: 'atomic-probe',
      }),
      userId: USER_ID,
    });

    expect(result).toEqual({ id: 'rollback-probe' });
    expect(await countRows('AtomicProbe')).toBe(1);
    const request = await readMutationRequest(key);
    expect(request).toMatchObject({
      status: 'completed',
      responseJson: JSON.stringify(result),
      resourceType: 'atomic-probe',
      resourceId: 'rollback-probe',
    });
  });

  test('reuses the completed response for the same key and rejects a new hash', async () => {
    const key = 'same-key';
    let actionCalls = 0;

    const first = await runSameKeyMutation(key, 'same-hash', async (db) => {
      actionCalls += 1;
      await db.$executeRaw`
        INSERT INTO "AtomicProbe" ("id", "value")
        VALUES ('same-key-probe', 'first')
      `;
      return { id: 'same-key-probe', value: 'first' };
    });

    const replay = await runSameKeyMutation(key, 'same-hash', async () => {
      actionCalls += 1;
      return { id: 'should-not-run', value: 'second' };
    });

    expect(replay).toEqual(first);
    expect(actionCalls).toBe(1);
    expect(await countRows('AtomicProbe')).toBe(2);
    expect(await countRows('MutationRequest')).toBe(2);

    await expect(
      runSameKeyMutation(key, 'different-hash', async () => {
        actionCalls += 1;
        return { id: 'should-not-run', value: 'conflict' };
      })
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(actionCalls).toBe(1);
    expect(await countRows('AtomicProbe')).toBe(2);
    expect(await countRows('MutationRequest')).toBe(2);
  });

  test('keeps the HTTP conflict contract when production minification changes the class name', () => {
    const error = new IdempotencyConflictError();
    error.name = 's';

    expect(toAppError(error)).toMatchObject({
      kind: 'conflict',
      statusCode: 409,
    });
  });
});

async function runSameKeyMutation(
  key: string,
  requestHash: string,
  action: Parameters<typeof withAtomicIdempotency<{ id: string; value: string }>>[0]['action']
) {
  return withAtomicIdempotency({
    action,
    key,
    operation: OPERATION,
    organizationId: ORGANIZATION_ID,
    requestHash,
    resource: ({ id }) => ({
      resourceId: id,
      resourceType: 'atomic-probe',
    }),
    userId: USER_ID,
  });
}

async function countRows(table: 'AtomicProbe' | 'MutationRequest') {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(result.rows[0]?.count || 0);
}

async function readMutationRequest(requestKey: string) {
  const result = await client.execute({
    sql: `SELECT "status", "responseJson", "resourceType", "resourceId"
          FROM "MutationRequest" WHERE "requestKey" = ?`,
    args: [requestKey],
  });
  return result.rows[0];
}
