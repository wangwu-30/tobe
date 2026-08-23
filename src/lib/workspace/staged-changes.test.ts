import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createClient, type Client, type InValue } from '@libsql/client';
import { expect, test } from '@playwright/test';

import type { StagedChangePatchInput } from '@/lib/workspace/planning';
import type { StagedChangePatchData, StagedChangeSetData } from '@/types';
import type * as StagedChangesTestBackend from './staged-changes-test-entry';

const run = promisify(execFile);

const ORGANIZATION_ID = 'proposal-org';
const USER_ID = 'proposal-owner';
const DEVICE_ID = 'proposal-device';
const SESSION_ID = 'proposal-session';
const REVIEW_SESSION_ID = 'proposal-review-session';
const WORKSPACE_ID = 'proposal-workspace';
const BASE_VERSION_ID = 'proposal-base-version';
const BRANCH_A_VERSION_ID = 'proposal-branch-a';
const BRANCH_B_VERSION_ID = 'proposal-branch-b';
const PRIMARY_FILE_ID = 'proposal-primary';
const NOTES_FILE_ID = 'proposal-notes';
const THREAD_ID = 'proposal-thread';
const INITIAL_DRAFT_REVISION = 7;
const PRIMARY_CONTENT = '# Original';
const NOTES_CONTENT = 'Original notes';

const ACTOR = {
  actorType: 'user' as const,
  deviceId: DEVICE_ID,
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
};

let temporaryRoot = '';
let client: Client;
let backend: typeof StagedChangesTestBackend;

test.describe.serial('staged document proposal acceptance', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-staged-changes-')
    );
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
    await run(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vite', 'build', '--config', 'vite.staged-changes-test.config.mts'],
      { cwd: process.cwd() }
    );
    backend = (await import(
      pathToFileURL(
        path.join(
          process.cwd(),
          '.tmp/staged-changes-test/staged-changes.mjs'
        )
      ).href
    )) as typeof StagedChangesTestBackend;
    client = createClient({ url: `file:${databasePath}` });
  });

  test.afterAll(async () => {
    await backend.prisma.$disconnect();
    await client.close();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test.beforeEach(async () => {
    await client.execute('DROP TRIGGER IF EXISTS reject_staged_change_apply');
    await client.execute('DROP TRIGGER IF EXISTS reject_comment_thread_apply');
    await client.execute('DROP TRIGGER IF EXISTS drift_comment_source_file');
    await client.execute('DROP TRIGGER IF EXISTS drift_comment_source_document');
    await client.execute('DROP TRIGGER IF EXISTS drift_workspace_version_document');
    await client.execute('DELETE FROM "MutationRequest"');
    await client.execute('DELETE FROM "StagedChangeSet"');
    await client.execute('DELETE FROM "Label"');
    await client.execute('DELETE FROM "WikiEditLock"');
    await client.execute('DELETE FROM "CommentThread"');
    await client.execute('UPDATE "Session" SET "activeFileId" = NULL');
    await client.execute('DELETE FROM "WorkspaceFile"');
    await deleteVersionsNewestFirst();
    await client.execute('DELETE FROM "Document"');
    await client.execute('DELETE FROM "Session"');
    await client.execute('DELETE FROM "OrganizationMembership"');
    await client.execute('DELETE FROM "Device"');
    await client.execute('DELETE FROM "Organization"');
    await client.execute('DELETE FROM "User"');
    await seedProposalFixture(client);
  });

  test('agent proposal appends review state without mutating the live draft', async () => {
    const documentBefore = await readDocument();
    const filesBefore = await readFiles();
    const remembered: string[] = [];
    const tool = createProposalTool((summary) => remembered.push(summary));

    const result = await tool.execute('proposal-only-call', {
      baseDraftRevision: INITIAL_DRAFT_REVISION,
      baseVersionId: BASE_VERSION_ID,
      operations: [
        updateOperation({
          content: PRIMARY_CONTENT,
          fileId: PRIMARY_FILE_ID,
          name: 'main.md',
          nextContent: '# Agent revision',
          revision: 3,
        }),
        {
          fileId: null,
          kind: 'markdown',
          name: 'appendix.md',
          nextContent: 'Proposed appendix',
          operation: 'create',
          preimage: null,
          summary: 'Create an appendix',
        },
      ],
      summary: 'Revise the draft and add supporting detail',
      title: 'Agent draft proposal',
    });

    const proposal = result.details as StagedChangeSetData;
    expect(await readDocument()).toEqual(documentBefore);
    expect(await readFiles()).toEqual(filesBefore);
    expect(await countRows('Version')).toBe(1);
    expect(await countRows('Label')).toBe(0);
    expect(remembered).toEqual([
      'Proposed document change "Agent draft proposal" for review.',
    ]);

    const stored = await queryOne(
      `SELECT "baseDraftRevision", "baseVersionId", "changesJson",
              "patchSchemaVersion", "patchSha256", "sessionId",
              "sourceType", "status"
       FROM "StagedChangeSet"
       WHERE "id" = ?`,
      [proposal.id]
    );
    const changesJson = String(stored?.changesJson);
    const changes = backend.safeJsonParse<StagedChangePatchData[]>(changesJson, []);
    expect(stored).toMatchObject({
      baseDraftRevision: INITIAL_DRAFT_REVISION,
      baseVersionId: BASE_VERSION_ID,
      patchSchemaVersion: 1,
      sessionId: SESSION_ID,
      sourceType: 'workspace-assistant',
      status: 'pending',
    });
    expect(changesJson).toBe(backend.canonicalJson(changes));
    expect(stored?.patchSha256).toBe(backend.sha256(changesJson));
    expect(changes).toMatchObject([
      {
        fileId: PRIMARY_FILE_ID,
        operation: 'update',
        preimage: {
          content: PRIMARY_CONTENT,
          contentSha256: backend.sha256(PRIMARY_CONTENT),
          revision: 3,
        },
      },
      { fileId: null, operation: 'create', preimage: null },
    ]);

    const mutation = await queryOne(
      `SELECT "resourceId", "resourceType", "status"
       FROM "MutationRequest"
       WHERE "requestKey" = ?`,
      [`pi-tool:${SESSION_ID}:proposal-only-call`]
    );
    expect(mutation).toMatchObject({
      resourceId: proposal.id,
      resourceType: 'staged-change-set',
      status: 'completed',
    });
  });

  test('human apply commits a multi-file proposal and one recovery checkpoint', async () => {
    const proposal = await createProposal([
      updateOperation({
        content: PRIMARY_CONTENT,
        fileId: PRIMARY_FILE_ID,
        name: 'main.md',
        nextContent: '# Accepted revision',
        revision: 3,
      }),
      updateOperation({
        content: NOTES_CONTENT,
        fileId: NOTES_FILE_ID,
        name: 'notes.md',
        nextContent: 'Accepted notes',
        revision: 5,
      }),
      {
        fileId: null,
        kind: 'text',
        name: 'summary.txt',
        nextContent: 'Accepted summary',
        operation: 'create',
        preimage: null,
        summary: 'Add the summary file',
      },
    ]);

    const applied = await backend.applyStagedChangeSet(ACTOR, {
      changeSetId: proposal.id,
      checkpointTitle: 'Before accepting multi-file proposal',
      expectedRevision: proposal.revision,
      workspaceId: WORKSPACE_ID,
    });

    expect(applied).toMatchObject({
      id: proposal.id,
      revision: 2,
      status: 'applied',
    });
    expect(applied.appliedCheckpointVersionId).toBeTruthy();
    expect(await readDocument()).toEqual({
      content: '# Accepted revision',
      currentVersion: 2,
      draftBaseVersionId: BASE_VERSION_ID,
      draftRevision: 8,
      revision: 2,
    });
    expect(await readFiles()).toEqual([
      {
        content: '# Accepted revision',
        deletedAt: null,
        id: PRIMARY_FILE_ID,
        isPrimary: true,
        name: 'main.md',
        path: 'main.md',
        revision: 4,
        sortOrder: 0,
      },
      {
        content: 'Accepted notes',
        deletedAt: null,
        id: NOTES_FILE_ID,
        isPrimary: false,
        name: 'notes.md',
        path: 'notes.md',
        revision: 6,
        sortOrder: 1,
      },
      {
        content: 'Accepted summary',
        deletedAt: null,
        id: expect.any(String),
        isPrimary: false,
        name: 'summary.txt',
        path: 'summary.txt',
        revision: 1,
        sortOrder: 2,
      },
    ]);

    const versions = await client.execute(
      `SELECT "content", "id", "sourceSessionId", "title", "versionNum"
       FROM "Version"
       WHERE "documentId" = '${WORKSPACE_ID}'
       ORDER BY "versionNum"`
    );
    expect(versions.rows).toHaveLength(2);
    const checkpoint = versions.rows[1];
    expect(checkpoint).toMatchObject({
      id: applied.appliedCheckpointVersionId,
      sourceSessionId: SESSION_ID,
      title: 'Before accepting multi-file proposal',
      versionNum: 2,
    });
    expect(readCheckpointFiles(String(checkpoint?.content))).toMatchObject([
      { content: PRIMARY_CONTENT, id: PRIMARY_FILE_ID, revision: 3 },
      { content: NOTES_CONTENT, id: NOTES_FILE_ID, revision: 5 },
    ]);
    const label = await queryOne(
      `SELECT "kind", "name", "versionId" FROM "Label"`
    );
    expect(label).toMatchObject({
      kind: 'recovery',
      name: 'Before accepting multi-file proposal',
      versionId: applied.appliedCheckpointVersionId,
    });
  });

  test('normal and recovery versions advance only the selected branch head', async () => {
    await seedSiblingBranchFixture(client);

    const recovery = await backend.createWorkspaceVersion(
      ACTOR,
      {
        bindDraftThreads: false,
        recovery: true,
        title: 'A recovery after switching branches',
        workspaceId: WORKSPACE_ID,
      },
      workspaceVersionDependencies()
    );

    expect(recovery).toMatchObject({
      parentVersionId: BRANCH_A_VERSION_ID,
      versionNum: 4,
    });
    expect(await readDocument()).toMatchObject({
      currentVersion: 4,
      draftBaseVersionId: BRANCH_A_VERSION_ID,
    });
    expect(await readActiveHeadVersionIds()).toEqual([
      BRANCH_A_VERSION_ID,
      BRANCH_B_VERSION_ID,
    ]);

    const milestone = await backend.createWorkspaceVersion(
      ACTOR,
      {
        bindDraftThreads: false,
        title: 'A milestone after switching branches',
        workspaceId: WORKSPACE_ID,
      },
      workspaceVersionDependencies()
    );

    expect(milestone).toMatchObject({
      parentVersionId: BRANCH_A_VERSION_ID,
      versionNum: 5,
    });
    expect(milestone.parentVersionId).not.toBe(BRANCH_B_VERSION_ID);
    expect(milestone.parentVersionId).not.toBe(recovery.id);
    expect(await readVersionAncestorIds(milestone.id)).not.toContain(
      BRANCH_B_VERSION_ID
    );
    expect(await readActiveHeadVersionIds()).toEqual([
      BRANCH_B_VERSION_ID,
      milestone.id,
    ].sort());
    expect(await queryOne(
      `SELECT "deletedAt" FROM "Label"
       WHERE "kind" = 'head' AND "versionId" = ?`,
      [BRANCH_A_VERSION_ID]
    )).toMatchObject({ deletedAt: expect.anything() });
    expect(await queryOne(
      `SELECT COUNT(*) AS "count" FROM "Label"
       WHERE "deletedAt" IS NULL AND "versionId" = ?
         AND "kind" IN ('head', 'milestone')`,
      [milestone.id]
    )).toMatchObject({ count: 2 });
    expect(await readDocument()).toMatchObject({
      currentVersion: 5,
      draftBaseVersionId: milestone.id,
    });
  });

  test('version creation neither falls back from a null base nor accepts a foreign base', async () => {
    await seedSiblingBranchFixture(client);
    await execute(
      `UPDATE "Document" SET "draftBaseVersionId" = NULL WHERE "id" = ?`,
      [WORKSPACE_ID]
    );

    const rootRecovery = await backend.createWorkspaceVersion(
      ACTOR,
      {
        bindDraftThreads: false,
        recovery: true,
        title: 'Legacy root recovery',
        workspaceId: WORKSPACE_ID,
      },
      workspaceVersionDependencies()
    );
    expect(rootRecovery.parentVersionId).toBeNull();

    const foreignVersionId = await seedForeignWorkspaceVersion(client);
    await execute(
      `UPDATE "Document"
       SET "draftBaseVersionId" = ?, "currentVersion" = 4
       WHERE "id" = ?`,
      [foreignVersionId, WORKSPACE_ID]
    );
    const stateBeforeAttempt = await readDocument();

    await expect(
      backend.createWorkspaceVersion(
        ACTOR,
        {
          bindDraftThreads: false,
          title: 'Must reject a foreign base',
          workspaceId: WORKSPACE_ID,
        },
        workspaceVersionDependencies()
      )
    ).rejects.toThrow('Workspace draft base version not found.');

    expect(await readDocument()).toEqual(stateBeforeAttempt);
    expect(await queryOne(
      `SELECT COUNT(*) AS "count" FROM "Version"
       WHERE "documentId" = ? AND "title" = 'Must reject a foreign base'`,
      [WORKSPACE_ID]
    )).toMatchObject({ count: 0 });
  });

  test('version creation rolls back when the captured workspace changes in-transaction', async () => {
    const stateBeforeAttempt = await readDocument();
    await client.executeMultiple(`
      CREATE TRIGGER drift_workspace_version_document
      AFTER INSERT ON "Version"
      FOR EACH ROW
      WHEN NEW."title" = 'CAS-fenced milestone'
      BEGIN
        UPDATE "Document"
        SET "revision" = "revision" + 1
        WHERE "id" = '${WORKSPACE_ID}';
      END;
    `);

    await expect(
      backend.createWorkspaceVersion(
        ACTOR,
        {
          bindDraftThreads: false,
          title: 'CAS-fenced milestone',
          workspaceId: WORKSPACE_ID,
        },
        workspaceVersionDependencies()
      )
    ).rejects.toThrow('Workspace changed while creating the version.');

    expect(await readDocument()).toEqual(stateBeforeAttempt);
    expect(await countRows('Version')).toBe(1);
    expect(await countRows('Label')).toBe(0);
  });

  test('staged recovery checkpoints stay on the selected branch', async () => {
    await seedSiblingBranchFixture(client);
    const proposal = await createProposal(
      [
        updateOperation({
          content: PRIMARY_CONTENT,
          fileId: PRIMARY_FILE_ID,
          name: 'main.md',
          nextContent: '# Accepted on branch A',
          revision: 3,
        }),
      ],
      { baseVersionId: BRANCH_A_VERSION_ID }
    );

    const applied = await backend.applyStagedChangeSet(ACTOR, {
      changeSetId: proposal.id,
      expectedRevision: proposal.revision,
      workspaceId: WORKSPACE_ID,
    });
    const checkpointId = applied.appliedCheckpointVersionId!;
    const checkpoint = await queryOne(
      `SELECT "parentVersionId", "versionNum"
       FROM "Version" WHERE "id" = ?`,
      [checkpointId]
    );

    expect(checkpoint).toMatchObject({
      parentVersionId: BRANCH_A_VERSION_ID,
      versionNum: 4,
    });
    expect(checkpoint?.parentVersionId).not.toBe(BRANCH_B_VERSION_ID);
    expect(await readVersionAncestorIds(checkpointId)).not.toContain(
      BRANCH_B_VERSION_ID
    );
    expect(await readActiveHeadVersionIds()).toEqual([
      BRANCH_A_VERSION_ID,
      BRANCH_B_VERSION_ID,
    ]);
    expect(await readDocument()).toMatchObject({
      currentVersion: 4,
      draftBaseVersionId: BRANCH_A_VERSION_ID,
    });
  });

  test('restore base resolution stays inside the workspace', async () => {
    const foreignVersionId = await seedForeignWorkspaceVersion(client);
    const recoveryId = 'proposal-cross-workspace-recovery';
    await client.execute({
      sql: `INSERT INTO "Version"
              ("id", "organizationId", "documentId", "versionNum",
               "content", "title", "parentVersionId", "versionType",
               "createdByUserId", "originDeviceId", "revision", "lockedAt")
            VALUES (?, ?, ?, 2, '[]', 'Cross-workspace recovery', ?,
                    'manual', ?, ?, 1, ?)`,
      args: [
        recoveryId,
        ORGANIZATION_ID,
        WORKSPACE_ID,
        foreignVersionId,
        USER_ID,
        DEVICE_ID,
        '2026-08-23T12:00:00.000Z',
      ],
    });
    await client.execute({
      sql: `INSERT INTO "Label"
              ("id", "organizationId", "versionId", "kind", "name",
               "createdByUserId", "originDeviceId", "revision",
               "createdAt", "updatedAt")
            VALUES (?, ?, ?, 'recovery', 'Cross-workspace recovery', ?, ?, 1, ?, ?)`,
      args: [
        `${recoveryId}-recovery`,
        ORGANIZATION_ID,
        recoveryId,
        USER_ID,
        DEVICE_ID,
        '2026-08-23T12:00:00.000Z',
        '2026-08-23T12:00:00.000Z',
      ],
    });

    await expect(
      backend.resolveDraftBaseVersionIdForVersion({
        organizationId: ORGANIZATION_ID,
        versionId: recoveryId,
        workspaceId: WORKSPACE_ID,
      })
    ).resolves.toBeNull();
  });

  test('comment source apply records the canonical server preimage and commits the thread transition', async () => {
    const nextContent = '# Applied from comment';

    const result = await backend.applyCommentSourceChange(
      ACTOR,
      commentSourceInput({ nextContent })
    );

    expect(result.changeSet).toMatchObject({
      appliedCheckpointVersionId: expect.any(String),
      baseDraftRevision: INITIAL_DRAFT_REVISION,
      baseVersionId: BASE_VERSION_ID,
      revision: 2,
      sourceType: 'comment-source',
      status: 'applied',
      workspaceId: WORKSPACE_ID,
    });
    expect(result.thread).toMatchObject({
      draftRevision: INITIAL_DRAFT_REVISION + 1,
      id: THREAD_ID,
      revision: 2,
      status: 'applied',
    });

    const stored = await queryOne(
      `SELECT "appliedCheckpointVersionId", "baseDraftRevision",
              "baseVersionId", "changesJson", "patchSchemaVersion",
              "patchSha256", "revision", "sourceType", "status"
       FROM "StagedChangeSet"
       WHERE "id" = ?`,
      [result.changeSet.id]
    );
    const changesJson = String(stored?.changesJson);
    const changes = backend.safeJsonParse<StagedChangePatchData[]>(changesJson, []);
    expect(stored).toMatchObject({
      appliedCheckpointVersionId: result.changeSet.appliedCheckpointVersionId,
      baseDraftRevision: INITIAL_DRAFT_REVISION,
      baseVersionId: BASE_VERSION_ID,
      patchSchemaVersion: 1,
      revision: 2,
      sourceType: 'comment-source',
      status: 'applied',
    });
    expect(changesJson).toBe(backend.canonicalJson(changes));
    expect(stored?.patchSha256).toBe(backend.sha256(changesJson));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      fileId: PRIMARY_FILE_ID,
      kind: 'markdown',
      name: 'main.md',
      nextContent,
      operation: 'update',
      preimage: {
        content: PRIMARY_CONTENT,
        contentSha256: backend.sha256(PRIMARY_CONTENT),
        revision: 3,
      },
    });

    expect(await readDocument()).toEqual({
      content: nextContent,
      currentVersion: 2,
      draftBaseVersionId: BASE_VERSION_ID,
      draftRevision: INITIAL_DRAFT_REVISION + 1,
      revision: 2,
    });
    expect(await queryOne(
      `SELECT "content", "revision" FROM "WorkspaceFile" WHERE "id" = ?`,
      [PRIMARY_FILE_ID]
    )).toMatchObject({ content: nextContent, revision: 4 });
    expect(await readThread()).toEqual({
      deletedAt: null,
      draftRevision: INITIAL_DRAFT_REVISION + 1,
      fileId: PRIMARY_FILE_ID,
      revision: 2,
      status: 'applied',
    });

    expect(await countRows('Version')).toBe(2);
    expect(await countRows('Label')).toBe(1);
    expect(await countRows('StagedChangeSet')).toBe(1);
    expect(await countRows('WikiEditLock')).toBe(1);
    const checkpoint = await queryOne(
      `SELECT "content", "id" FROM "Version" WHERE "id" = ?`,
      [result.changeSet.appliedCheckpointVersionId!]
    );
    expect(checkpoint?.id).toBe(result.changeSet.appliedCheckpointVersionId);
    expect(readCheckpointFiles(String(checkpoint?.content))).toMatchObject([
      { content: PRIMARY_CONTENT, id: PRIMARY_FILE_ID, revision: 3 },
      { content: NOTES_CONTENT, id: NOTES_FILE_ID, revision: 5 },
    ]);
    expect(await queryOne(
      `SELECT "kind", "versionId" FROM "Label"`
    )).toMatchObject({
      kind: 'recovery',
      versionId: result.changeSet.appliedCheckpointVersionId,
    });
  });

  test('comment source apply forbids a non-owner without service side effects', async () => {
    await execute(
      `UPDATE "OrganizationMembership" SET "role" = 'member'
       WHERE "organizationId" = ? AND "userId" = ?`,
      [ORGANIZATION_ID, USER_ID]
    );
    const stateBeforeAttempt = await readCommentApplyState();

    await expect(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    ).rejects.toMatchObject({
      kind: 'forbidden',
      statusCode: 403,
    });

    expect(await readCommentApplyState()).toEqual(stateBeforeAttempt);
  });

  test('comment source apply rejects a stale workspace revision without service side effects', async () => {
    await execute(
      `UPDATE "Document" SET "revision" = "revision" + 1 WHERE "id" = ?`,
      [WORKSPACE_ID]
    );
    const stateAfterConcurrentWrite = await readCommentApplyState();

    await expectConflict(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    );

    expect(await readCommentApplyState()).toEqual(stateAfterConcurrentWrite);
  });

  test('comment source apply rejects a stale file revision without service side effects', async () => {
    await execute(
      `UPDATE "WorkspaceFile" SET "revision" = "revision" + 1 WHERE "id" = ?`,
      [PRIMARY_FILE_ID]
    );
    const stateAfterConcurrentWrite = await readCommentApplyState();

    await expectConflict(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    );

    expect(await readCommentApplyState()).toEqual(stateAfterConcurrentWrite);
  });

  test('comment source apply rejects a stale thread revision without service side effects', async () => {
    await execute(
      `UPDATE "CommentThread" SET "revision" = "revision" + 1 WHERE "id" = ?`,
      [THREAD_ID]
    );
    const stateAfterConcurrentWrite = await readCommentApplyState();

    await expectConflict(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    );

    expect(await readCommentApplyState()).toEqual(stateAfterConcurrentWrite);
  });

  test('comment source apply rolls back when the final file CAS detects in-transaction drift', async () => {
    const initialState = await readCommentApplyState();
    await client.executeMultiple(`
      CREATE TRIGGER drift_comment_source_file
      AFTER INSERT ON "Label"
      FOR EACH ROW
      WHEN NEW."kind" = 'recovery'
      BEGIN
        UPDATE "WorkspaceFile"
        SET "revision" = "revision" + 1
        WHERE "id" = '${PRIMARY_FILE_ID}';
      END;
    `);

    await expectConflict(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    );

    expect(await readCommentApplyState()).toEqual(initialState);
  });

  test('comment source apply rolls back when the final document CAS detects in-transaction drift', async () => {
    const initialState = await readCommentApplyState();
    await client.executeMultiple(`
      CREATE TRIGGER drift_comment_source_document
      AFTER INSERT ON "Label"
      FOR EACH ROW
      WHEN NEW."kind" = 'recovery'
      BEGIN
        UPDATE "Document"
        SET "revision" = "revision" + 1
        WHERE "id" = '${WORKSPACE_ID}';
      END;
    `);

    await expectConflict(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    );

    expect(await readCommentApplyState()).toEqual(initialState);
  });

  test('late comment thread transition failure rolls back proposal creation and apply', async () => {
    const initialState = await readCommentApplyState();
    await client.executeMultiple(`
      CREATE TRIGGER reject_comment_thread_apply
      BEFORE UPDATE OF "status" ON "CommentThread"
      FOR EACH ROW
      WHEN OLD."id" = '${THREAD_ID}'
       AND OLD."status" = 'open'
       AND NEW."status" = 'applied'
      BEGIN
        SELECT RAISE(ABORT, 'forced comment thread transition failure');
      END;
    `);

    await expect(
      backend.applyCommentSourceChange(ACTOR, commentSourceInput())
    ).rejects.toThrow();

    expect(await readCommentApplyState()).toEqual(initialState);
  });

  test('late apply failure rolls back every file and checkpoint write', async () => {
    const proposal = await createProposal([
      updateOperation({
        content: PRIMARY_CONTENT,
        fileId: PRIMARY_FILE_ID,
        name: 'main.md',
        nextContent: '# Must roll back',
        revision: 3,
      }),
      updateOperation({
        content: NOTES_CONTENT,
        fileId: NOTES_FILE_ID,
        name: 'notes.md',
        nextContent: 'Must also roll back',
        revision: 5,
      }),
      {
        fileId: null,
        kind: 'text',
        name: 'must-not-exist.txt',
        nextContent: 'Transient content',
        operation: 'create',
        preimage: null,
        summary: 'Exercise rollback of a create',
      },
    ]);
    const documentBefore = await readDocument();
    const filesBefore = await readFiles();
    await client.executeMultiple(`
      CREATE TRIGGER reject_staged_change_apply
      BEFORE UPDATE OF "status" ON "StagedChangeSet"
      FOR EACH ROW
      WHEN NEW."status" = 'applied'
      BEGIN
        SELECT RAISE(ABORT, 'forced proposal decision failure');
      END;
    `);

    await expect(
      backend.applyStagedChangeSet(ACTOR, {
        changeSetId: proposal.id,
        expectedRevision: proposal.revision,
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toThrow();

    expect(await readDocument()).toEqual(documentBefore);
    expect(await readFiles()).toEqual(filesBefore);
    expect(await countRows('Version')).toBe(1);
    expect(await countRows('Label')).toBe(0);
    expect(await countRows('WikiEditLock')).toBe(0);
    const stored = await queryOne(
      `SELECT "appliedCheckpointVersionId", "revision", "status"
       FROM "StagedChangeSet" WHERE "id" = ?`,
      [proposal.id]
    );
    expect(stored).toMatchObject({
      appliedCheckpointVersionId: null,
      revision: 1,
      status: 'pending',
    });
  });

  test('draft and file CAS drift fail closed without a recovery checkpoint', async () => {
    const proposal = await createProposal([
      updateOperation({
        content: PRIMARY_CONTENT,
        fileId: PRIMARY_FILE_ID,
        name: 'main.md',
        nextContent: '# Proposed',
        revision: 3,
      }),
      updateOperation({
        content: NOTES_CONTENT,
        fileId: NOTES_FILE_ID,
        name: 'notes.md',
        nextContent: 'Proposed notes',
        revision: 5,
      }),
    ]);

    await execute(
      `UPDATE "Document" SET "draftRevision" = 8 WHERE "id" = ?`,
      [WORKSPACE_ID]
    );
    await expectConflict(
      backend.applyStagedChangeSet(ACTOR, {
        changeSetId: proposal.id,
        expectedRevision: proposal.revision,
        workspaceId: WORKSPACE_ID,
      })
    );

    await execute(
      `UPDATE "Document" SET "draftRevision" = 7 WHERE "id" = ?`,
      [WORKSPACE_ID]
    );
    await execute(
      `UPDATE "WorkspaceFile"
       SET "content" = 'Concurrent human edit', "revision" = "revision" + 1
       WHERE "id" = ?`,
      [NOTES_FILE_ID]
    );
    await expectConflict(
      backend.applyStagedChangeSet(ACTOR, {
        changeSetId: proposal.id,
        expectedRevision: proposal.revision,
        workspaceId: WORKSPACE_ID,
      })
    );

    expect(await countRows('Version')).toBe(1);
    expect(await countRows('Label')).toBe(0);
    expect(await countRows('WikiEditLock')).toBe(0);
    expect(await queryOne(
      `SELECT "revision", "status" FROM "StagedChangeSet" WHERE "id" = ?`,
      [proposal.id]
    )).toMatchObject({ revision: 1, status: 'pending' });
    expect(await readDocument()).toMatchObject({
      content: PRIMARY_CONTENT,
      currentVersion: 1,
      draftRevision: INITIAL_DRAFT_REVISION,
    });
    expect(await queryOne(
      `SELECT "content", "revision" FROM "WorkspaceFile" WHERE "id" = ?`,
      [NOTES_FILE_ID]
    )).toMatchObject({ content: 'Concurrent human edit', revision: 6 });
  });

  test('deleting the primary file preserves a recovery snapshot and repairs references', async () => {
    const proposal = await createProposal([
      {
        fileId: PRIMARY_FILE_ID,
        kind: 'markdown',
        name: 'main.md',
        nextContent: null,
        operation: 'delete',
        preimage: { content: PRIMARY_CONTENT, revision: 3 },
        summary: 'Remove the superseded primary file',
      },
    ]);

    const applied = await backend.applyStagedChangeSet(ACTOR, {
      changeSetId: proposal.id,
      checkpointTitle: 'Before deleting primary',
      expectedRevision: proposal.revision,
      workspaceId: WORKSPACE_ID,
    });

    const primary = await queryOne(
      `SELECT "deletedAt", "isPrimary", "revision"
       FROM "WorkspaceFile" WHERE "id" = ?`,
      [PRIMARY_FILE_ID]
    );
    expect(primary?.deletedAt).toBeTruthy();
    expect(primary).toMatchObject({ isPrimary: 1, revision: 4 });
    expect(await queryOne(
      `SELECT "deletedAt", "revision" FROM "CommentThread" WHERE "id" = ?`,
      [THREAD_ID]
    )).toMatchObject({ deletedAt: primary?.deletedAt, revision: 2 });
    expect(await queryOne(
      `SELECT "content", "deletedAt", "isPrimary", "revision"
       FROM "WorkspaceFile" WHERE "id" = ?`,
      [NOTES_FILE_ID]
    )).toMatchObject({
      content: NOTES_CONTENT,
      deletedAt: null,
      isPrimary: 1,
      revision: 6,
    });

    const sessions = await client.execute(
      `SELECT "activeFileId", "id", "revision"
       FROM "Session"
       WHERE "id" IN ('${SESSION_ID}', '${REVIEW_SESSION_ID}')
       ORDER BY "id"`
    );
    expect(sessions.rows).toMatchObject([
      { activeFileId: NOTES_FILE_ID, id: REVIEW_SESSION_ID, revision: 2 },
      { activeFileId: NOTES_FILE_ID, id: SESSION_ID, revision: 2 },
    ]);
    expect(await readDocument()).toEqual({
      content: NOTES_CONTENT,
      currentVersion: 2,
      draftBaseVersionId: BASE_VERSION_ID,
      draftRevision: 8,
      revision: 2,
    });

    const checkpoint = await queryOne(
      `SELECT "content" FROM "Version" WHERE "id" = ?`,
      [applied.appliedCheckpointVersionId!]
    );
    expect(readCheckpointFiles(String(checkpoint?.content))).toMatchObject([
      {
        content: PRIMARY_CONTENT,
        id: PRIMARY_FILE_ID,
        isPrimary: true,
        revision: 3,
      },
      {
        content: NOTES_CONTENT,
        id: NOTES_FILE_ID,
        isPrimary: false,
        revision: 5,
      },
    ]);
  });

  test('creation replay is idempotent while repeated human apply is fenced', async () => {
    const tool = createProposalTool(() => {});
    const parameters = {
      baseDraftRevision: INITIAL_DRAFT_REVISION,
      baseVersionId: BASE_VERSION_ID,
      operations: [
        updateOperation({
          content: PRIMARY_CONTENT,
          fileId: PRIMARY_FILE_ID,
          name: 'main.md',
          nextContent: '# Replay-safe revision',
          revision: 3,
        }),
      ],
      summary: 'Exercise proposal replay',
      title: 'Replay-safe proposal',
    };

    const first = await tool.execute('replayed-call', parameters);
    const replayed = await tool.execute('replayed-call', parameters);
    const proposal = first.details as StagedChangeSetData;
    expect((replayed.details as StagedChangeSetData).id).toBe(proposal.id);
    expect(await countRows('StagedChangeSet')).toBe(1);
    expect(await countRows('MutationRequest')).toBe(1);

    await expect(
      tool.execute('replayed-call', {
        ...parameters,
        title: 'Payload drift must conflict',
      })
    ).rejects.toBeInstanceOf(backend.IdempotencyConflictError);
    expect(await countRows('StagedChangeSet')).toBe(1);

    await backend.applyStagedChangeSet(ACTOR, {
      changeSetId: proposal.id,
      expectedRevision: proposal.revision,
      workspaceId: WORKSPACE_ID,
    });
    await expectConflict(
      backend.applyStagedChangeSet(ACTOR, {
        changeSetId: proposal.id,
        expectedRevision: 1,
        workspaceId: WORKSPACE_ID,
      })
    );
    await expectConflict(
      backend.applyStagedChangeSet(ACTOR, {
        changeSetId: proposal.id,
        expectedRevision: 2,
        workspaceId: WORKSPACE_ID,
      })
    );

    expect(await countRows('Version')).toBe(2);
    expect(await countRows('Label')).toBe(1);
    expect(await queryOne(
      `SELECT "content", "revision" FROM "WorkspaceFile" WHERE "id" = ?`,
      [PRIMARY_FILE_ID]
    )).toMatchObject({ content: '# Replay-safe revision', revision: 4 });
    expect(await readDocument()).toMatchObject({
      draftRevision: 8,
      revision: 2,
    });
    expect(await queryOne(
      `SELECT "revision", "status" FROM "StagedChangeSet" WHERE "id" = ?`,
      [proposal.id]
    )).toMatchObject({ revision: 2, status: 'applied' });
  });
});

function createProposalTool(rememberSummary: (summary: string) => void) {
  return backend.createProposeDocumentChangeTool({
    actorUserId: USER_ID,
    organizationId: ORGANIZATION_ID,
    originDeviceId: DEVICE_ID,
    rememberSummary,
    sessionId: SESSION_ID,
    sourceType: 'workspace-assistant',
    workspaceId: WORKSPACE_ID,
  });
}

async function createProposal(
  changes: StagedChangePatchInput[],
  overrides: { baseVersionId?: string } = {}
) {
  return backend.createStagedChangeSet(ACTOR, {
    baseDraftRevision: INITIAL_DRAFT_REVISION,
    baseVersionId: overrides.baseVersionId || BASE_VERSION_ID,
    changes,
    conversationId: SESSION_ID,
    sourceType: 'acceptance-test',
    summary: 'Acceptance proposal summary',
    title: 'Acceptance proposal',
    workspaceId: WORKSPACE_ID,
  });
}

function workspaceVersionDependencies() {
  return {
    bindDraftThreadsToVersion: async () => {},
    ensureWorkspaceEditable: async () => {},
    recordSyncEvent: async () => {},
  };
}

function updateOperation(params: {
  content: string;
  fileId: string;
  name: string;
  nextContent: string;
  revision: number;
}) {
  return {
    fileId: params.fileId,
    kind: 'markdown' as const,
    name: params.name,
    nextContent: params.nextContent,
    operation: 'update' as const,
    preimage: { content: params.content, revision: params.revision },
    summary: `Update ${params.name}`,
  };
}

function commentSourceInput(
  overrides: Partial<{
    expectedFileRevision: number;
    expectedThreadRevision: number;
    expectedWorkspaceRevision: number;
    nextContent: string;
  }> = {}
) {
  return {
    expectedFileRevision: 3,
    expectedThreadRevision: 1,
    expectedWorkspaceRevision: 1,
    fileId: PRIMARY_FILE_ID,
    nextContent: '# Comment source revision',
    threadId: THREAD_ID,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

async function expectConflict(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({
    kind: 'conflict',
    statusCode: 409,
  });
}

async function execute(sql: string, args: InValue[] = []) {
  return client.execute({ args, sql });
}

async function queryOne(sql: string, args: InValue[] = []) {
  const result = await execute(sql, args);
  return result.rows[0];
}

async function deleteVersionsNewestFirst() {
  const versions = await client.execute(
    `SELECT "id" FROM "Version" ORDER BY "versionNum" DESC`
  );
  for (const version of versions.rows) {
    await execute(`DELETE FROM "Version" WHERE "id" = ?`, [version.id]);
  }
}

async function countRows(table: string) {
  const allowedTables = new Set([
    'Label',
    'MutationRequest',
    'StagedChangeSet',
    'Version',
    'WikiEditLock',
  ]);
  if (!allowedTables.has(table)) throw new Error(`Unsupported count table: ${table}`);
  const row = await queryOne(`SELECT COUNT(*) AS "count" FROM "${table}"`);
  return Number(row?.count);
}

async function readDocument() {
  const row = await queryOne(
    `SELECT "content", "currentVersion", "draftBaseVersionId",
            "draftRevision", "revision"
     FROM "Document" WHERE "id" = ?`,
    [WORKSPACE_ID]
  );
  return {
    content: String(row?.content),
    currentVersion: Number(row?.currentVersion),
    draftBaseVersionId: String(row?.draftBaseVersionId),
    draftRevision: Number(row?.draftRevision),
    revision: Number(row?.revision),
  };
}

async function readActiveHeadVersionIds() {
  const result = await client.execute(
    `SELECT "versionId" FROM "Label"
     WHERE "deletedAt" IS NULL AND "kind" = 'head'
     ORDER BY "versionId" ASC`
  );
  return result.rows.map((row) => String(row.versionId));
}

async function readVersionAncestorIds(versionId: string) {
  const result = await client.execute({
    sql: `WITH RECURSIVE "lineage" ("id", "parentVersionId") AS (
            SELECT "id", "parentVersionId"
            FROM "Version"
            WHERE "id" = ?
            UNION ALL
            SELECT "parent"."id", "parent"."parentVersionId"
            FROM "Version" AS "parent"
            JOIN "lineage" ON "parent"."id" = "lineage"."parentVersionId"
          )
          SELECT "id" FROM "lineage"`,
    args: [versionId],
  });
  return result.rows.map((row) => String(row.id));
}

async function readFiles() {
  const result = await client.execute({
    sql: `SELECT "content", "deletedAt", "id", "isPrimary", "name",
                 "path", "revision", "sortOrder"
          FROM "WorkspaceFile"
          WHERE "documentId" = ? AND "deletedAt" IS NULL
          ORDER BY "sortOrder", "createdAt", "id"`,
    args: [WORKSPACE_ID],
  });
  return result.rows.map((row) => ({
    content: String(row.content),
    deletedAt: row.deletedAt === null ? null : String(row.deletedAt),
    id: String(row.id),
    isPrimary: Boolean(row.isPrimary),
    name: String(row.name),
    path: String(row.path),
    revision: Number(row.revision),
    sortOrder: Number(row.sortOrder),
  }));
}

async function readThread() {
  const row = await queryOne(
    `SELECT "deletedAt", "draftRevision", "fileId", "revision", "status"
     FROM "CommentThread" WHERE "id" = ?`,
    [THREAD_ID]
  );
  return {
    deletedAt: row?.deletedAt === null ? null : String(row?.deletedAt),
    draftRevision: Number(row?.draftRevision),
    fileId: row?.fileId === null ? null : String(row?.fileId),
    revision: Number(row?.revision),
    status: String(row?.status),
  };
}

async function readCommentApplyState() {
  return {
    document: await readDocument(),
    files: await readFiles(),
    labelCount: await countRows('Label'),
    lockCount: await countRows('WikiEditLock'),
    proposalCount: await countRows('StagedChangeSet'),
    thread: await readThread(),
    versionCount: await countRows('Version'),
  };
}

function readCheckpointFiles(content: string) {
  return backend.safeJsonParse<{ files?: StagedCheckpointFile[] }>(content, {}).files || [];
}

type StagedCheckpointFile = {
  content: string;
  id: string;
  isPrimary: boolean;
  revision: number;
};

async function seedProposalFixture(db: Client) {
  const now = '2026-08-22T10:00:00.000Z';
  await db.executeMultiple(`
    INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
    VALUES ('${ORGANIZATION_ID}', '${ORGANIZATION_ID}', 'Proposal Org', '${now}', '${now}');

    INSERT INTO "User" ("id", "name", "email", "createdAt", "updatedAt")
    VALUES ('${USER_ID}', 'Proposal Owner', 'proposal@example.com', '${now}', '${now}');

    INSERT INTO "OrganizationMembership"
      ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
    VALUES
      ('proposal-membership', '${ORGANIZATION_ID}', '${USER_ID}', 'owner', '${now}', '${now}');

    INSERT INTO "Device"
      ("id", "organizationId", "userId", "label", "type", "lastSeenAt", "createdAt", "updatedAt")
    VALUES
      ('${DEVICE_ID}', '${ORGANIZATION_ID}', '${USER_ID}', 'Proposal Device', 'local', '${now}', '${now}', '${now}');

    INSERT INTO "Session"
      ("id", "organizationId", "title", "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt")
    VALUES
      ('${SESSION_ID}', '${ORGANIZATION_ID}', 'Proposal Session', '${USER_ID}', '${DEVICE_ID}', 1, '${now}', '${now}'),
      ('${REVIEW_SESSION_ID}', '${ORGANIZATION_ID}', 'Review Session', '${USER_ID}', '${DEVICE_ID}', 1, '${now}', '${now}');

    INSERT INTO "Document"
      ("id", "organizationId", "sessionId", "title", "content", "status",
       "currentVersion", "draftRevision", "createdByUserId", "originDeviceId",
       "revision", "createdAt", "updatedAt")
    VALUES
      ('${WORKSPACE_ID}', '${ORGANIZATION_ID}', '${SESSION_ID}', 'Proposal Workspace',
       '${PRIMARY_CONTENT}', 'draft', 1, ${INITIAL_DRAFT_REVISION}, '${USER_ID}', '${DEVICE_ID}',
       1, '${now}', '${now}');

    INSERT INTO "WorkspaceFile"
      ("id", "organizationId", "documentId", "name", "type", "kind", "role",
       "path", "language", "content", "isPrimary", "sortOrder",
       "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt")
    VALUES
      ('${PRIMARY_FILE_ID}', '${ORGANIZATION_ID}', '${WORKSPACE_ID}', 'main.md', 'file', 'markdown', 'deliverable',
       'main.md', 'markdown', '${PRIMARY_CONTENT}', 1, 0, '${USER_ID}', '${DEVICE_ID}', 3, '${now}', '${now}'),
      ('${NOTES_FILE_ID}', '${ORGANIZATION_ID}', '${WORKSPACE_ID}', 'notes.md', 'file', 'markdown', 'deliverable',
       'notes.md', 'markdown', '${NOTES_CONTENT}', 0, 1, '${USER_ID}', '${DEVICE_ID}', 5, '${now}', '${now}');

    UPDATE "Session"
    SET "activeFileId" = '${PRIMARY_FILE_ID}'
    WHERE "id" IN ('${SESSION_ID}', '${REVIEW_SESSION_ID}');

    INSERT INTO "CommentThread"
      ("id", "organizationId", "documentId", "fileId", "anchorText", "draftRevision",
       "createdByUserId", "originDeviceId", "revision", "createdAt", "updatedAt")
    VALUES
      ('${THREAD_ID}', '${ORGANIZATION_ID}', '${WORKSPACE_ID}', '${PRIMARY_FILE_ID}', 'Primary anchor',
       ${INITIAL_DRAFT_REVISION}, '${USER_ID}', '${DEVICE_ID}', 1, '${now}', '${now}');
  `);

  const baseVersionContent = JSON.stringify({
    files: [
      { content: PRIMARY_CONTENT, id: PRIMARY_FILE_ID, revision: 3 },
      { content: NOTES_CONTENT, id: NOTES_FILE_ID, revision: 5 },
    ],
    workspaceTitle: 'Proposal Workspace',
  });
  await db.execute({
    sql: `INSERT INTO "Version"
            ("id", "organizationId", "documentId", "versionNum", "content", "title",
             "versionType", "createdByUserId", "originDeviceId", "revision", "lockedAt")
          VALUES (?, ?, ?, 1, ?, 'Base version', 'manual', ?, ?, 1, ?)`,
    args: [
      BASE_VERSION_ID,
      ORGANIZATION_ID,
      WORKSPACE_ID,
      baseVersionContent,
      USER_ID,
      DEVICE_ID,
      now,
    ],
  });
  await db.execute({
    sql: `UPDATE "Document" SET "draftBaseVersionId" = ? WHERE "id" = ?`,
    args: [BASE_VERSION_ID, WORKSPACE_ID],
  });
}

async function seedSiblingBranchFixture(db: Client) {
  const now = '2026-08-23T11:00:00.000Z';
  const versionContent = JSON.stringify({
    files: [
      { content: PRIMARY_CONTENT, id: PRIMARY_FILE_ID, revision: 3 },
      { content: NOTES_CONTENT, id: NOTES_FILE_ID, revision: 5 },
    ],
    workspaceTitle: 'Proposal Workspace',
  });
  for (const [id, versionNum, title] of [
    [BRANCH_A_VERSION_ID, 2, 'Branch A'],
    [BRANCH_B_VERSION_ID, 3, 'Branch B'],
  ] as const) {
    await db.execute({
      sql: `INSERT INTO "Version"
              ("id", "organizationId", "documentId", "versionNum",
               "content", "title", "parentVersionId", "versionType",
               "createdByUserId", "originDeviceId", "revision", "lockedAt")
            VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, 1, ?)`,
      args: [
        id,
        ORGANIZATION_ID,
        WORKSPACE_ID,
        versionNum,
        versionContent,
        title,
        BASE_VERSION_ID,
        USER_ID,
        DEVICE_ID,
        now,
      ],
    });
    for (const kind of ['milestone', 'head'] as const) {
      await db.execute({
        sql: `INSERT INTO "Label"
                ("id", "organizationId", "versionId", "kind", "name",
                 "createdByUserId", "originDeviceId", "revision",
                 "createdAt", "updatedAt")
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [
          `${id}-${kind}`,
          ORGANIZATION_ID,
          id,
          kind,
          title,
          USER_ID,
          DEVICE_ID,
          now,
          now,
        ],
      });
    }
  }
  await db.execute({
    sql: `UPDATE "Document"
          SET "currentVersion" = 3, "draftBaseVersionId" = ?
          WHERE "id" = ?`,
    args: [BRANCH_A_VERSION_ID, WORKSPACE_ID],
  });
}

async function seedForeignWorkspaceVersion(db: Client) {
  const workspaceId = 'proposal-foreign-workspace';
  const versionId = 'proposal-foreign-version';
  const now = '2026-08-23T12:00:00.000Z';
  await db.execute({
    sql: `INSERT OR IGNORE INTO "Document"
            ("id", "organizationId", "sessionId", "title", "content",
             "status", "currentVersion", "draftRevision",
             "createdByUserId", "originDeviceId", "revision",
             "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'Foreign Workspace', '[]', 'draft', 1, 0, ?, ?, 1, ?, ?)`,
    args: [
      workspaceId,
      ORGANIZATION_ID,
      SESSION_ID,
      USER_ID,
      DEVICE_ID,
      now,
      now,
    ],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO "Version"
            ("id", "organizationId", "documentId", "versionNum",
             "content", "title", "versionType", "createdByUserId",
             "originDeviceId", "revision", "lockedAt")
          VALUES (?, ?, ?, 1, '[]', 'Foreign visible version', 'manual', ?, ?, 1, ?)`,
    args: [
      versionId,
      ORGANIZATION_ID,
      workspaceId,
      USER_ID,
      DEVICE_ID,
      now,
    ],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO "Label"
            ("id", "organizationId", "versionId", "kind", "name",
             "createdByUserId", "originDeviceId", "revision",
             "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'milestone', 'Foreign visible version', ?, ?, 1, ?, ?)`,
    args: [
      `${versionId}-milestone`,
      ORGANIZATION_ID,
      versionId,
      USER_ID,
      DEVICE_ID,
      now,
      now,
    ],
  });
  return versionId;
}
