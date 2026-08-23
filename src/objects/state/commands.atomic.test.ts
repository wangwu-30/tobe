import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';
import { prisma } from '@/lib/db/prisma';

import { alignWorkspaceVersionWithDb } from './alignment';
import { createStateTestPrismaClient } from './test-prisma';

const run = promisify(execFile);

const ACTOR = {
  deviceId: 'alignment-device',
  organizationId: 'alignment-org',
  userId: 'alignment-user',
};

let temporaryRoot = '';
let client: Client;

test.describe.serial('workspace alignment atomicity', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-alignment-'));
    const databasePath = path.join(temporaryRoot, 'dev.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: temporaryRoot,
          DATABASE_URL: `file:${databasePath}`,
        },
      }
    );
    client = createClient({ url: `file:${databasePath}` });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await client.close();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test.beforeEach(async () => {
    await client.execute('DELETE FROM "Label"');
    await client.execute('DELETE FROM "Version"');
    await client.execute('DELETE FROM "Document"');
    await client.execute('DELETE FROM "OrganizationMembership"');
    await client.execute('DELETE FROM "Session"');
    await client.execute('DELETE FROM "Device"');
    await client.execute('DELETE FROM "User"');
    await client.execute('DELETE FROM "Organization"');
    await seedAlignmentFixture(client);
  });

  test('concurrent alignment creates exactly one active aligned label and returns aligned versions', async () => {
    test.setTimeout(90_000);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be configured for atomic alignment tests.');
    }
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const db = createStateTestPrismaClient(databaseUrl);
        try {
          return await alignWorkspaceVersionWithDb(db, ACTOR, {
            versionId: 'aligned-version-1',
            workspaceId: 'aligned-workspace-1',
          });
        } finally {
          await db.$disconnect();
        }
      })
    );

    for (const result of results) {
      expect(result).toMatchObject({
        aligned: true,
        id: 'aligned-version-1',
        visible: true,
        workspaceId: 'aligned-workspace-1',
      });
    }

    const liveAligned = await client.execute({
      sql: `
        SELECT "id", "deletedAt"
        FROM "Label"
        WHERE "versionId" = ?
          AND "kind" = 'aligned'
        ORDER BY "createdAt" ASC, "id" ASC
      `,
      args: ['aligned-version-1'],
    });

    expect(liveAligned.rows).toHaveLength(1);
    expect(liveAligned.rows[0]?.deletedAt ?? null).toBeNull();
  });
});

async function seedAlignmentFixture(db: Client) {
  const now = '2026-08-21T15:00:00.000Z';
  await db.executeMultiple(`
    INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
    VALUES ('alignment-org', 'alignment-org', 'Alignment Org', '${now}', '${now}');

    INSERT INTO "User" ("id", "name", "email", "createdAt", "updatedAt")
    VALUES ('alignment-user', 'Alignment User', 'alignment@example.com', '${now}', '${now}');

    INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
    VALUES ('alignment-membership', 'alignment-org', 'alignment-user', 'owner', '${now}', '${now}');

    INSERT INTO "Device" ("id", "organizationId", "userId", "label", "type", "lastSeenAt", "createdAt", "updatedAt")
    VALUES ('alignment-device', 'alignment-org', 'alignment-user', 'Primary Device', 'local', '${now}', '${now}', '${now}');

    INSERT INTO "Session" ("id", "organizationId", "title", "createdByUserId", "originDeviceId", "createdAt", "updatedAt")
    VALUES ('alignment-session-1', 'alignment-org', 'Alignment Session', 'alignment-user', 'alignment-device', '${now}', '${now}');

    INSERT INTO "Document" (
      "id", "organizationId", "sessionId", "title", "content", "status",
      "currentVersion", "draftRevision", "createdByUserId", "originDeviceId",
      "revision", "createdAt", "updatedAt"
    ) VALUES (
      'aligned-workspace-1', 'alignment-org', 'alignment-session-1', 'Aligned Workspace', '[]', 'draft',
      1, 0, 'alignment-user', 'alignment-device',
      1, '${now}', '${now}'
    );

    INSERT INTO "Version" (
      "id", "organizationId", "documentId", "versionNum", "content", "title",
      "versionType", "createdByUserId", "originDeviceId", "revision", "lockedAt"
    ) VALUES (
      'aligned-version-1', 'alignment-org', 'aligned-workspace-1', 1, '[]', 'Aligned Version',
      'manual', 'alignment-user', 'alignment-device', 1, '${now}'
    );

    INSERT INTO "Label" (
      "id", "organizationId", "versionId", "kind", "name", "createdByUserId",
      "originDeviceId", "revision", "createdAt", "updatedAt"
    ) VALUES (
      'aligned-version-1-milestone', 'alignment-org', 'aligned-version-1', 'milestone', 'Aligned Version', 'alignment-user',
      'alignment-device', 1, '${now}', '${now}'
    );
  `);
}
