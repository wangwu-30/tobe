import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

const MIGRATION_SQL = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260821150000_add_aligned_label_atomicity',
  'migration.sql'
);

test.describe.serial('aligned label migration', () => {
  let temporaryRoot = '';
  let client: Client;

  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-aligned-migration-')
    );
    const databasePath = path.join(temporaryRoot, 'migration.db');
    client = createClient({ url: `file:${databasePath}` });
  });

  test.afterAll(async () => {
    await client.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    await client.executeMultiple(`
      DROP TABLE IF EXISTS "Label";
      CREATE TABLE "Label" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL DEFAULT 'local-org',
        "versionId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "createdByUserId" TEXT,
        "originDeviceId" TEXT,
        "revision" INTEGER NOT NULL DEFAULT 1,
        "deletedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );

      INSERT INTO "Label" (
        "id", "organizationId", "versionId", "kind", "name", "revision", "createdAt", "updatedAt"
      ) VALUES
        ('aligned-1', 'org-1', 'version-1', 'aligned', 'Version 1', 1, '2026-08-21T14:59:00.000Z', '2026-08-21T14:59:00.000Z'),
        ('aligned-2', 'org-1', 'version-1', 'aligned', 'Version 1', 1, '2026-08-21T14:59:01.000Z', '2026-08-21T14:59:01.000Z'),
        ('milestone-1', 'org-1', 'version-1', 'milestone', 'Version 1', 1, '2026-08-21T14:59:02.000Z', '2026-08-21T14:59:02.000Z');
    `);
  });

  test('deduplicates live aligned rows and enforces one active aligned label per version', async () => {
    const migrationSql = await fs.readFile(MIGRATION_SQL, 'utf8');
    await client.executeMultiple(migrationSql);

    const rows = await client.execute(`
      SELECT "id", "revision", "deletedAt"
      FROM "Label"
      WHERE "versionId" = 'version-1'
        AND "kind" = 'aligned'
      ORDER BY "createdAt" ASC, "id" ASC
    `);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      id: 'aligned-1',
      deletedAt: null,
      revision: 1,
    });
    expect(rows.rows[1]?.id).toBe('aligned-2');
    expect(rows.rows[1]?.deletedAt ?? null).not.toBeNull();
    expect(Number(rows.rows[1]?.revision)).toBe(2);

    const indexes = await client.execute(`PRAGMA index_list("Label")`);
    const uniqueIndex = indexes.rows.find(
      (row) => String(row.name) === 'Label_active_aligned_version_unique_idx'
    );
    expect(Boolean(uniqueIndex)).toBe(true);
    expect(Number(uniqueIndex?.unique)).toBe(1);
    expect(Number(uniqueIndex?.partial)).toBe(1);

    await expect(
      client.executeMultiple(`
        INSERT INTO "Label" (
          "id", "organizationId", "versionId", "kind", "name", "revision", "createdAt", "updatedAt"
        ) VALUES (
          'aligned-3', 'org-1', 'version-1', 'aligned', 'Version 1', 1, '2026-08-21T15:01:00.000Z', '2026-08-21T15:01:00.000Z'
        );
      `)
    ).rejects.toThrow(/UNIQUE constraint failed|constraint failed/u);
  });
});
