import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';
import { prisma } from '@/lib/db/prisma';
import {
  buildCommentThreadRevisionFilters,
  buildCommentVersionLineageFilter,
  orderInheritedCommentThreadCandidates,
  resolveCommentVersionLineageIds,
} from '@/lib/comments/thread-query';
import { bindDraftThreadsToVersion } from '@/lib/comments/version-binding';

import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  ensureWorkspaceFiles,
  updateWorkspaceFile,
} from './commands';

const run = promisify(execFile);

const ACTOR = {
  deviceId: 'file-device',
  organizationId: 'file-org',
  userId: 'file-user',
};
const WORKSPACE_ID = 'file-workspace';
const PRIMARY_FILE_ID = 'file-primary';
const SECONDARY_FILE_ID = 'file-secondary';
const INITIAL_DRAFT_REVISION = 7;
const dependencies = {
  ensureWorkspaceEditable: async () => {},
};

let temporaryRoot = '';
let client: Client;

test.describe.serial('ordinary workspace file draft revisions', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-file-commands-'));
    const databasePath = path.join(temporaryRoot, 'dev.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = 'file:' + databasePath;
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: temporaryRoot,
          DATABASE_URL: 'file:' + databasePath,
        },
      }
    );
    client = createClient({ url: 'file:' + databasePath });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await client.close();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test.beforeEach(async () => {
    await client.execute('DROP TRIGGER IF EXISTS "reject_file_draft_revision"');
    await client.execute('DELETE FROM "Organization"');
    await client.execute('DELETE FROM "User"');
    await seedFileFixture(client);
  });

  test('increments draftRevision exactly once for each successful create, update, and delete', async () => {
    const created = await createWorkspaceFile(
      ACTOR,
      {
        kind: 'markdown',
        name: 'draft.md',
        workspaceId: WORKSPACE_ID,
      },
      dependencies
    );
    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION + 1);

    const updated = await updateWorkspaceFile(
      ACTOR,
      {
        content: '# Updated',
        fileId: created.id,
        name: 'renamed.md',
        setPrimary: true,
        sortOrder: 0,
        workspaceId: WORKSPACE_ID,
      },
      dependencies
    );
    expect(updated).toMatchObject({
      content: '# Updated',
      isPrimary: true,
      name: 'renamed.md',
      sortOrder: 0,
    });
    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION + 2);

    await client.execute({
      sql: 'UPDATE "Session" SET "activeFileId" = ? WHERE "id" = ?',
      args: [created.id, 'file-session'],
    });
    await deleteWorkspaceFile(
      ACTOR,
      { fileId: created.id, workspaceId: WORKSPACE_ID },
      dependencies
    );
    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION + 3);

    const workspace = await client.execute({
      sql: 'SELECT "content" FROM "Document" WHERE "id" = ?',
      args: [WORKSPACE_ID],
    });
    const primary = await readFile(PRIMARY_FILE_ID);
    const session = await client.execute({
      sql: 'SELECT "activeFileId" FROM "Session" WHERE "id" = ?',
      args: ['file-session'],
    });
    expect(workspace.rows[0]?.content).toBe('primary content');
    expect(Number(primary?.isPrimary)).toBe(1);
    expect(session.rows[0]?.activeFileId).toBe(PRIMARY_FILE_ID);
  });

  test('does not increment draftRevision for implicit file initialization', async () => {
    await client.execute(
      `UPDATE "Session" SET "activeFileId" = NULL WHERE "id" = 'file-session'`
    );
    await client.execute('DELETE FROM "CommentThread"');
    await client.execute('DELETE FROM "WorkspaceFile"');

    const files = await ensureWorkspaceFiles(ACTOR.organizationId, WORKSPACE_ID);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      content: 'workspace content',
      isPrimary: true,
    });
    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION);
  });

  test('rolls back create when the draftRevision increment fails', async () => {
    await rejectDraftRevisionUpdates();

    await expect(
      createWorkspaceFile(
        ACTOR,
        { name: 'must-not-exist.md', workspaceId: WORKSPACE_ID },
        dependencies
      )
    ).rejects.toThrow();

    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION);
    const files = await client.execute({
      sql: 'SELECT "id" FROM "WorkspaceFile" WHERE "documentId" = ? ORDER BY "id"',
      args: [WORKSPACE_ID],
    });
    expect(files.rows.map((row) => String(row.id))).toEqual([
      PRIMARY_FILE_ID,
      SECONDARY_FILE_ID,
    ]);
  });

  test('rolls back all update file writes when the draftRevision increment fails', async () => {
    await rejectDraftRevisionUpdates();

    await expect(
      updateWorkspaceFile(
        ACTOR,
        {
          content: '# Must roll back',
          fileId: SECONDARY_FILE_ID,
          name: 'rolled-back.md',
          setPrimary: true,
          sortOrder: 0,
          workspaceId: WORKSPACE_ID,
        },
        dependencies
      )
    ).rejects.toThrow();

    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION);
    const primary = await readFile(PRIMARY_FILE_ID);
    expect(primary).toMatchObject({
      revision: 1,
      sortOrder: 0,
    });
    expect(Number(primary?.isPrimary)).toBe(1);
    const secondary = await readFile(SECONDARY_FILE_ID);
    expect(secondary).toMatchObject({
      content: 'secondary content',
      name: 'notes.md',
      path: 'notes.md',
      revision: 1,
      sortOrder: 1,
    });
    expect(Number(secondary?.isPrimary)).toBe(0);
  });

  test('rolls back delete side effects when the draftRevision increment fails', async () => {
    await rejectDraftRevisionUpdates();

    await expect(
      deleteWorkspaceFile(
        ACTOR,
        { fileId: PRIMARY_FILE_ID, workspaceId: WORKSPACE_ID },
        dependencies
      )
    ).rejects.toThrow();

    expect(await readDraftRevision()).toBe(INITIAL_DRAFT_REVISION);
    const primary = await readFile(PRIMARY_FILE_ID);
    expect(primary).toMatchObject({
      deletedAt: null,
      revision: 1,
    });
    expect(Number(primary?.isPrimary)).toBe(1);
    const secondary = await readFile(SECONDARY_FILE_ID);
    expect(secondary).toMatchObject({
      deletedAt: null,
      revision: 1,
    });
    expect(Number(secondary?.isPrimary)).toBe(0);
    const thread = await client.execute({
      sql: 'SELECT "deletedAt", "revision" FROM "CommentThread" WHERE "id" = ?',
      args: ['file-thread'],
    });
    const session = await client.execute({
      sql: 'SELECT "activeFileId" FROM "Session" WHERE "id" = ?',
      args: ['file-session'],
    });
    expect(thread.rows[0]?.deletedAt ?? null).toBeNull();
    expect(Number(thread.rows[0]?.revision)).toBe(1);
    expect(session.rows[0]?.activeFileId).toBe(PRIMARY_FILE_ID);
  });

  test('binds every active unbound thread through the snapshot revision', async () => {
    const now = new Date('2026-08-23T09:00:00.000Z');
    await client.execute({
      sql: `INSERT INTO "Version"
              ("id", "organizationId", "documentId", "versionNum", "content",
               "title", "createdByUserId", "originDeviceId", "revision", "lockedAt")
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, 1, ?)`,
      args: [
        'file-snapshot',
        ACTOR.organizationId,
        WORKSPACE_ID,
        'snapshot content',
        'File Snapshot',
        ACTOR.userId,
        ACTOR.deviceId,
        now,
      ],
    });
    for (const [id, draftRevision, status] of [
      ['older-open-thread', 5, 'open'],
      ['older-applied-thread', 6, 'applied'],
      ['future-thread', 8, 'open'],
      ['resolved-thread', 4, 'resolved'],
    ] as const) {
      await client.execute({
        sql: `INSERT INTO "CommentThread"
                ("id", "organizationId", "documentId", "fileId", "anchorText",
                 "draftRevision", "status", "createdByUserId", "originDeviceId",
                 "revision", "createdAt", "updatedAt")
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [
          id,
          ACTOR.organizationId,
          WORKSPACE_ID,
          PRIMARY_FILE_ID,
          id,
          draftRevision,
          status,
          ACTOR.userId,
          ACTOR.deviceId,
          now,
          now,
        ],
      });
    }

    await bindDraftThreadsToVersion(
      WORKSPACE_ID,
      'file-snapshot',
      INITIAL_DRAFT_REVISION,
      ACTOR.organizationId
    );

    const result = await client.execute({
      sql: `SELECT "id", "revision", "versionId"
            FROM "CommentThread"
            ORDER BY "id" ASC`,
    });
    const threads = Object.fromEntries(
      result.rows.map((row) => [
        String(row.id),
        { revision: Number(row.revision), versionId: row.versionId ?? null },
      ])
    );

    expect(threads).toMatchObject({
      'file-thread': { revision: 2, versionId: 'file-snapshot' },
      'older-applied-thread': { revision: 2, versionId: 'file-snapshot' },
      'older-open-thread': { revision: 2, versionId: 'file-snapshot' },
      'future-thread': { revision: 1, versionId: null },
      'resolved-thread': { revision: 1, versionId: null },
    });
  });
});

test.describe('comment thread draft revision query contract', () => {

  test('keeps current direct threads separate from older draft candidates', () => {
    expect(
      buildCommentThreadRevisionFilters({
        currentDraftRevision: 8,
        draftOnly: true,
        inheritedVersionIds: ['ancestor-version'],
        versionId: null,
      })
    ).toEqual({
      direct: { draftRevision: 8, versionId: null },
      inheritedVersion: {
        status: { in: ['open', 'applied'] },
        versionId: { in: ['ancestor-version'] },
      },
      priorDraft: {
        draftRevision: { lt: 8 },
        status: { in: ['open', 'applied'] },
        versionId: null,
      },
    });
  });

  test('keeps version views scoped to the selected version and supplied lineage', () => {
    expect(
      buildCommentThreadRevisionFilters({
        currentDraftRevision: null,
        draftOnly: false,
        inheritedVersionIds: ['ancestor-version'],
        versionId: 'selected-version',
      })
    ).toEqual({
      direct: { versionId: 'selected-version' },
      inheritedVersion: {
        status: { in: ['open', 'applied'] },
        versionId: { in: ['ancestor-version'] },
      },
      priorDraft: null,
    });
  });

  test('orders newer prior drafts before older drafts and version lineage', () => {
    const candidate = (
      id: string,
      draftRevision: number | null,
      versionId: string | null,
      updatedAt: string
    ) => ({
      createdAt: new Date('2026-08-22T09:00:00.000Z'),
      draftRevision,
      id,
      updatedAt: new Date(updatedAt),
      versionId,
    });

    const ordered = orderInheritedCommentThreadCandidates({
      inheritedVersionIds: ['parent-version', 'grandparent-version'],
      priorDraftThreads: [
        candidate('draft-6', 6, null, '2026-08-22T11:00:00.000Z'),
        candidate('draft-7', 7, null, '2026-08-22T10:00:00.000Z'),
      ],
      versionThreads: [
        candidate('grandparent', null, 'grandparent-version', '2026-08-22T12:00:00.000Z'),
        candidate('parent', null, 'parent-version', '2026-08-22T09:30:00.000Z'),
      ],
    });

    expect(ordered.map((thread) => thread.id)).toEqual([
      'draft-7',
      'draft-6',
      'parent',
      'grandparent',
    ]);
  });

  test('uses thread id as the final deterministic candidate ordering key', () => {
    const timestamp = new Date('2026-08-23T10:00:00.000Z');
    const ordered = orderInheritedCommentThreadCandidates({
      inheritedVersionIds: ['parent-version'],
      priorDraftThreads: [
        {
          createdAt: timestamp,
          draftRevision: 7,
          id: 'draft-z',
          updatedAt: timestamp,
          versionId: null,
        },
        {
          createdAt: timestamp,
          draftRevision: 7,
          id: 'draft-a',
          updatedAt: timestamp,
          versionId: null,
        },
      ],
      versionThreads: [
        {
          createdAt: timestamp,
          draftRevision: null,
          id: 'version-z',
          updatedAt: timestamp,
          versionId: 'parent-version',
        },
        {
          createdAt: timestamp,
          draftRevision: null,
          id: 'version-a',
          updatedAt: timestamp,
          versionId: 'parent-version',
        },
      ],
    });

    expect(ordered.map((thread) => thread.id)).toEqual([
      'draft-a',
      'draft-z',
      'version-a',
      'version-z',
    ]);
  });

  test('keeps lineage inside the workspace and fails closed on missing parents or cycles', () => {
    expect(
      buildCommentVersionLineageFilter({
        organizationId: 'file-org',
        workspaceId: 'file-workspace',
      })
    ).toEqual({
      deletedAt: null,
      documentId: 'file-workspace',
      organizationId: 'file-org',
    });

    const versions = [
      { id: 'selected', parentVersionId: 'parent' },
      { id: 'parent', parentVersionId: 'root' },
      { id: 'root', parentVersionId: null },
      { id: 'sibling', parentVersionId: 'root' },
    ];
    expect(
      resolveCommentVersionLineageIds({ startVersionId: 'selected', versions })
    ).toEqual(['selected', 'parent', 'root']);
    expect(
      resolveCommentVersionLineageIds({
        startVersionId: 'selected',
        versions: versions.filter((version) => version.id !== 'parent'),
      })
    ).toEqual([]);
    expect(
      resolveCommentVersionLineageIds({
        startVersionId: 'cycle-a',
        versions: [
          { id: 'cycle-a', parentVersionId: 'cycle-b' },
          { id: 'cycle-b', parentVersionId: 'cycle-a' },
        ],
      })
    ).toEqual([]);
  });

});

async function rejectDraftRevisionUpdates() {
  await client.executeMultiple(
    [
      'CREATE TRIGGER "reject_file_draft_revision"',
      'BEFORE UPDATE OF "draftRevision" ON "Document"',
      `WHEN NEW."id" = 'file-workspace'`,
      'BEGIN',
      `  SELECT RAISE(ABORT, 'forced draft revision failure');`,
      'END;',
    ].join('\n')
  );
}

async function readDraftRevision() {
  const result = await client.execute({
    sql: 'SELECT "draftRevision" FROM "Document" WHERE "id" = ?',
    args: [WORKSPACE_ID],
  });
  return Number(result.rows[0]?.draftRevision);
}

async function readFile(fileId: string) {
  const result = await client.execute({
    sql: 'SELECT "content", "deletedAt", "isPrimary", "name", "path", "revision", "sortOrder" FROM "WorkspaceFile" WHERE "id" = ?',
    args: [fileId],
  });
  return result.rows[0];
}

async function seedFileFixture(db: Client) {
  const now = '2026-08-22T10:00:00.000Z';
  await db.executeMultiple(
    [
      'INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")',
      "VALUES ('file-org', 'file-org', 'File Org', '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "User" ("id", "name", "email", "createdAt", "updatedAt")',
      "VALUES ('file-user', 'File User', 'file@example.com', '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")',
      "VALUES ('file-membership', 'file-org', 'file-user', 'owner', '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "Device" ("id", "organizationId", "userId", "label", "type", "lastSeenAt", "createdAt", "updatedAt")',
      "VALUES ('file-device', 'file-org', 'file-user', 'File Device', 'local', '" + now + "', '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "Session" ("id", "organizationId", "title", "createdByUserId", "originDeviceId", "createdAt", "updatedAt")',
      "VALUES ('file-session', 'file-org', 'File Session', 'file-user', 'file-device', '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "Document" ("id", "organizationId", "sessionId", "title", "content", "status", "currentVersion", "draftRevision", "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt")',
      "VALUES ('file-workspace', 'file-org', 'file-session', 'File Workspace', 'workspace content', 'draft', 0, " + INITIAL_DRAFT_REVISION + ", 'file-user', 'file-device', 1, '" + now + "', '" + now + "');",
      '',
      'INSERT INTO "WorkspaceFile" ("id", "organizationId", "documentId", "name", "type", "kind", "role", "path", "language", "content", "isPrimary", "sortOrder", "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt") VALUES',
      "('file-primary', 'file-org', 'file-workspace', 'main', 'file', 'richtext', 'deliverable', 'main', NULL, 'primary content', 1, 0, 'file-user', 'file-device', 1, '" + now + "', '" + now + "'),",
      "('file-secondary', 'file-org', 'file-workspace', 'notes.md', 'file', 'markdown', 'deliverable', 'notes.md', 'markdown', 'secondary content', 0, 1, 'file-user', 'file-device', 1, '" + now + "', '" + now + "');",
      '',
      `UPDATE "Session" SET "activeFileId" = 'file-primary' WHERE "id" = 'file-session';`,
      '',
      'INSERT INTO "CommentThread" ("id", "organizationId", "documentId", "fileId", "anchorText", "draftRevision", "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt")',
      "VALUES ('file-thread', 'file-org', 'file-workspace', 'file-primary', 'Anchor', " + INITIAL_DRAFT_REVISION + ", 'file-user', 'file-device', 1, '" + now + "', '" + now + "');",
    ].join('\n')
  );
}
