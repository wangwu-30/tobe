import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';

import { MIGRATION_PROBES } from './bootstrap-local-db.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const bootstrapScript = path.join(repoRoot, 'scripts', 'bootstrap-local-db.mjs');
const migrationsRoot = path.join(repoRoot, 'prisma', 'migrations');
const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
const durableDelegationMigration =
  '20260821160000_add_durable_room_delegation_ledger';
const documentProposalMigration =
  '20260821170000_document_proposal_cas';
const canvasTablesMigration = '20260822010000_add_canvas_tables';
const canvasColumnSchemas = {
  NodeRelation: [
    {
      name: 'id',
      type: 'TEXT',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 1,
    },
    {
      name: 'organizationId',
      type: 'TEXT',
      notNull: true,
      defaultValue: "'local-org'",
      primaryKeyPosition: 0,
    },
    {
      name: 'sourceNodeId',
      type: 'TEXT',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: 'targetNodeId',
      type: 'TEXT',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: 'kind',
      type: 'TEXT',
      notNull: true,
      defaultValue: "'dependency'",
      primaryKeyPosition: 0,
    },
    {
      name: 'createdAt',
      type: 'DATETIME',
      notNull: true,
      defaultValue: 'CURRENT_TIMESTAMP',
      primaryKeyPosition: 0,
    },
  ],
  ProjectCanvasLayout: [
    {
      name: 'id',
      type: 'TEXT',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 1,
    },
    {
      name: 'organizationId',
      type: 'TEXT',
      notNull: true,
      defaultValue: "'local-org'",
      primaryKeyPosition: 0,
    },
    {
      name: 'projectId',
      type: 'TEXT',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: 'x',
      type: 'REAL',
      notNull: true,
      defaultValue: '0',
      primaryKeyPosition: 0,
    },
    {
      name: 'y',
      type: 'REAL',
      notNull: true,
      defaultValue: '0',
      primaryKeyPosition: 0,
    },
    {
      name: 'updatedAt',
      type: 'DATETIME',
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
  ],
};

test('every local migration has an explicit compatibility probe', async () => {
  const migrations = await localMigrationNames();

  assert.deepEqual(Object.keys(MIGRATION_PROBES).sort(), migrations);
});

test('fresh bootstrap applies all migrations and a second run is inert', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-fresh-');

  const first = await runBootstrap(appDataRoot);
  assert.match(first.stdout, /Applying 20260312090000_current_schema_baseline/u);
  assert.match(first.stdout, /Applying 20260821130000_add_agent_profile_management/u);
  assert.match(
    first.stdout,
    /Applying 20260821140000_add_room_tool_confirmation_requests/u
  );
  assert.match(first.stdout, new RegExp(`Applying ${durableDelegationMigration}`, 'u'));
  assert.match(first.stdout, new RegExp(`Applying ${documentProposalMigration}`, 'u'));
  assert.match(first.stdout, new RegExp(`Applying ${canvasTablesMigration}`, 'u'));

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
  const databasePath = path.join(appDataRoot, 'dev.db');
  assert.equal(await pragmaValue(databasePath, 'journal_mode'), 'wal');
  assert.deepEqual(await appliedMigrationNames(databasePath), await localMigrationNames());
  await assertCurrentControlPlaneSchema(databasePath);
});

test('legacy canvas metadata migration upgrades missing canvas tables', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-canvas-legacy-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await createMigratedDatabase(
    databasePath,
    '20260324040000_add_canvas_meta'
  );

  await withClient(databasePath, async (client) => {
    const tables = await schemaObjectNames(client, 'table');
    assert.equal(tables.has('NodeRelation'), false);
    assert.equal(tables.has('ProjectCanvasLayout'), false);
    assert.equal(
      await tableColumnNames(client, 'Document').then((columns) =>
        columns.has('canvasMetaJson')
      ),
      true
    );
  });
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(
      '20260324040000_add_canvas_meta'
    ),
    true
  );

  const first = await runBootstrap(appDataRoot);
  assert.match(first.stdout, new RegExp(`Applying ${canvasTablesMigration}`, 'u'));
  assert.deepEqual(await appliedMigrationNames(databasePath), await localMigrationNames());
  await assertCurrentCanvasSchema(databasePath);

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('mixed canvas index definitions fail closed without recording the migration', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-canvas-partial-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await pushCurrentPrismaSchema(databasePath);
  await withClient(databasePath, (client) =>
    client.executeMultiple(`
      DROP INDEX "NodeRelation_organizationId_sourceNodeId_idx";
      CREATE INDEX "NodeRelation_organizationId_sourceNodeId_idx"
        ON "NodeRelation"("kind");
      CREATE INDEX "NodeRelation_source_columns_legacy_idx"
        ON "NodeRelation"("organizationId", "sourceNodeId");
    `)
  );

  await assert.rejects(runBootstrap(appDataRoot), /NodeRelation.*already exists/u);
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(canvasTablesMigration),
    false
  );
});

test('canvas column constraint lookalikes fail closed without recording the migration', async (t) => {
  const fixtures = [
    {
      name: 'wrong declared type',
      table: 'ProjectCanvasLayout',
      column: 'x',
      property: 'type',
      expectedValue: 'TEXT',
      original: '"x" REAL NOT NULL DEFAULT 0,',
      replacement: '"x" TEXT NOT NULL DEFAULT 0,',
    },
    {
      name: 'missing NOT NULL',
      table: 'NodeRelation',
      column: 'sourceNodeId',
      property: 'notNull',
      expectedValue: false,
      original: '"sourceNodeId" TEXT NOT NULL,',
      replacement: '"sourceNodeId" TEXT,',
    },
    {
      name: 'wrong default',
      table: 'NodeRelation',
      column: 'kind',
      property: 'defaultValue',
      expectedValue: "'association'",
      original: `"kind" TEXT NOT NULL DEFAULT 'dependency',`,
      replacement: `"kind" TEXT NOT NULL DEFAULT 'association',`,
    },
    {
      name: 'missing primary key',
      table: 'NodeRelation',
      column: 'id',
      property: 'primaryKeyPosition',
      expectedValue: 0,
      original: `CREATE TABLE "NodeRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,`,
      replacement: `CREATE TABLE "NodeRelation" (
    "id" TEXT NOT NULL,`,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async (t) => {
      const appDataRoot = await temporaryDirectory(
        t,
        'tobe-bootstrap-canvas-lookalike-'
      );
      const databasePath = path.join(appDataRoot, 'dev.db');

      await createMigratedDatabase(databasePath, documentProposalMigration);
      await createCanvasLookalikeSchema(databasePath, fixture);

      await withClient(databasePath, async (client) => {
        const column = (await tableColumnSchema(client, fixture.table)).find(
          (candidate) => candidate.name === fixture.column
        );
        assert.equal(column?.[fixture.property], fixture.expectedValue);
        await assertCurrentCanvasIndexesAndForeignKeys(client);
      });

      await assert.rejects(
        runBootstrap(appDataRoot),
        /NodeRelation.*already exists/u
      );
      assert.equal(
        (await appliedMigrationNames(databasePath)).includes(
          canvasTablesMigration
        ),
        false
      );
    });
  }
});

test('current schema bootstrap backfills legacy labels before marking migrations', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-current-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await execFileAsync(
    process.execPath,
    [prismaCli, 'db', 'push', '--url', `file:${databasePath}`],
    { cwd: repoRoot, env: process.env }
  );
  await seedManualVersion(databasePath);

  const first = await runBootstrap(appDataRoot);
  assert.match(first.stdout, /Applying 20260321143000_backfill_milestone_labels/u);
  assert.match(first.stdout, /Applying 20260321150000_backfill_head_labels/u);
  assert.doesNotMatch(
    first.stdout,
    /Applying 20260314220000_finalize_workspace_status_and_playbook_lifecycle/u
  );
  assert.doesNotMatch(
    first.stdout,
    /Applying 20260821130000_add_agent_profile_management|Applying 20260821140000_add_room_tool_confirmation_requests|Applying 20260821160000_add_durable_room_delegation_ledger/u
  );
  assert.match(
    first.stdout,
    new RegExp(`Repairing existing schema for ${durableDelegationMigration}`, 'u')
  );
  assert.match(
    first.stdout,
    new RegExp(`Repairing existing schema for ${documentProposalMigration}`, 'u')
  );
  assert.match(
    first.stdout,
    new RegExp(
      `Marking existing schema as already satisfying ${canvasTablesMigration}`,
      'u'
    )
  );
  assert.deepEqual(await labelKinds(databasePath, 'version-1'), [
    'head',
    'milestone',
  ]);
  assert.deepEqual(await labelKinds(databasePath, 'version-2'), ['recovery']);
  assert.deepEqual(await labelKinds(databasePath, 'version-3'), [
    'pinned',
    'recovery',
  ]);
  assert.deepEqual(await appliedMigrationNames(databasePath), await localMigrationNames());
  await assertCurrentControlPlaneSchema(databasePath);

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('legacy 120000 schema upgrades agent profile data and room tool confirmations', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-legacy-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await createLegacyControlPlaneDatabase(databasePath);
  await seedLegacyAgentProfileAndRoomConfirmationData(databasePath);

  const result = await runBootstrap(appDataRoot);
  assert.match(result.stdout, /Applying 20260821130000_add_agent_profile_management/u);
  assert.match(result.stdout, /Applying 20260821140000_add_room_tool_confirmation_requests/u);
  assert.match(result.stdout, new RegExp(`Applying ${durableDelegationMigration}`, 'u'));

  await withClient(databasePath, async (client) => {
    const agentProfile = await selectRow(
      client,
      'SELECT "skillsJson", "capabilitiesJson", "configJson", "revision" FROM "AgentProfile" WHERE "id" = ?',
      ['agent-1']
    );
    assert.equal(agentProfile?.skillsJson, '["research","summarization"]');
    assert.equal(
      agentProfile?.capabilitiesJson,
      '{"schemaVersion":1,"skills":["research","summarization"]}'
    );
    assert.equal(
      agentProfile?.configJson,
      '{"schemaVersion":1,"room":{"runtimeId":"pi-agent-core","configVersion":1}}'
    );
    assert.equal(Number(agentProfile?.revision), 1);

    const roomSession = await selectRow(
      client,
      'SELECT "agentConfigVersion" FROM "RoomAgentSession" WHERE "id" = ?',
      ['room-session-1']
    );
    assert.equal(roomSession?.agentConfigVersion, '1');

    const tables = await schemaObjectNames(client, 'table');
    assert.equal(tables.has('RoomToolConfirmationRequest'), true);
    assert.equal(tables.has('RoomToolConfirmationGrant'), false);
  });

  assert.deepEqual(await appliedMigrationNames(databasePath), await localMigrationNames());
  await assertCurrentControlPlaneSchema(databasePath);

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('current schema bootstrap repairs legacy agent profile data before marking migrations', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-current-repair-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await execFileAsync(
    process.execPath,
    [prismaCli, 'db', 'push', '--url', `file:${databasePath}`],
    { cwd: repoRoot, env: process.env }
  );
  await seedCurrentSchemaLegacyAgentData(databasePath);

  const result = await runBootstrap(appDataRoot);
  assert.match(result.stdout, /Repairing existing schema for 20260821130000_add_agent_profile_management/u);
  assert.match(
    result.stdout,
    /Marking existing schema as already satisfying 20260821140000_add_room_tool_confirmation_requests/u
  );
  assert.match(
    result.stdout,
    new RegExp(`Repairing existing schema for ${durableDelegationMigration}`, 'u')
  );
  assert.match(
    result.stdout,
    new RegExp(`Repairing existing schema for ${documentProposalMigration}`, 'u')
  );

  await withClient(databasePath, async (client) => {
    const agentProfile = await selectRow(
      client,
      'SELECT "skillsJson", "capabilitiesJson", "revision" FROM "AgentProfile" WHERE "id" = ?',
      ['agent-current-1']
    );
    assert.equal(agentProfile?.skillsJson, '["planning","coding"]');
    assert.equal(
      agentProfile?.capabilitiesJson,
      '{"schemaVersion":1,"skills":["planning","coding"]}'
    );
    assert.equal(Number(agentProfile?.revision), 1);

    const roomSession = await selectRow(
      client,
      'SELECT "agentConfigVersion" FROM "RoomAgentSession" WHERE "id" = ?',
      ['room-session-current-1']
    );
    assert.equal(roomSession?.agentConfigVersion, '1');
  });

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('partial room tool confirmation schema fails closed without recording the migration', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-partial-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await execFileAsync(
    process.execPath,
    [prismaCli, 'db', 'push', '--url', `file:${databasePath}`],
    { cwd: repoRoot, env: process.env }
  );
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      DROP TABLE "RoomToolConfirmationRequest";
      CREATE TABLE "RoomToolConfirmationRequest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL DEFAULT 'local-org',
        "requestedByUserId" TEXT NOT NULL,
        "roomId" TEXT NOT NULL,
        "toolName" TEXT NOT NULL
      );
    `);
  });

  await assert.rejects(
    runBootstrap(appDataRoot),
    /partial RoomToolConfirmationRequest schema/u
  );

  await withClient(databasePath, async (client) => {
    const requestColumns = await tableColumnNames(client, 'RoomToolConfirmationRequest');
    assert.equal(requestColumns.has('toolCallId'), false);
  });
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(
      '20260821140000_add_room_tool_confirmation_requests'
    ),
    false
  );
});

test('plain Prisma current schema repairs delegation constraints and preserves rows', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-delegation-current-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await pushCurrentPrismaSchema(databasePath);
  await seedCurrentDelegationLedger(databasePath);

  const first = await runBootstrap(appDataRoot);
  assert.match(
    first.stdout,
    new RegExp(`Repairing existing schema for ${durableDelegationMigration}`, 'u')
  );
  assert.doesNotMatch(
    first.stdout,
    new RegExp(`Applying ${durableDelegationMigration}`, 'u')
  );
  await assertCurrentControlPlaneSchema(databasePath);
  await assertDelegationSeedPreserved(databasePath);

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('plain Prisma current schema terminalizes legacy pending document proposals and installs immutability', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-proposal-current-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await pushCurrentPrismaSchema(databasePath);
  await seedCurrentSchemaDocumentProposals(databasePath);

  const first = await runBootstrap(appDataRoot);
  assert.match(
    first.stdout,
    new RegExp(`Repairing existing schema for ${documentProposalMigration}`, 'u')
  );
  assert.doesNotMatch(
    first.stdout,
    new RegExp(`Applying ${documentProposalMigration}`, 'u')
  );

  await withClient(databasePath, async (client) => {
    const legacy = await selectRow(
      client,
      'SELECT "status", "discardedAt", "reviewedAt", "revision" FROM "StagedChangeSet" WHERE "id" = ?',
      ['legacy-pending-proposal']
    );
    assert.equal(legacy?.status, 'discarded');
    assert.notEqual(legacy?.discardedAt, null);
    assert.notEqual(legacy?.reviewedAt, null);
    assert.equal(Number(legacy?.revision), 2);

    const actionable = await selectRow(
      client,
      'SELECT "status", "revision" FROM "StagedChangeSet" WHERE "id" = ?',
      ['cas-pending-proposal']
    );
    assert.equal(actionable?.status, 'pending');
    assert.equal(Number(actionable?.revision), 1);
  });
  await assertCurrentControlPlaneSchema(databasePath);
  await assertVersionImmutability(databasePath);

  const second = await runBootstrap(appDataRoot);
  assert.doesNotMatch(second.stdout, /Applying |Marking |Repairing /u);
});

test('legacy document proposal migration terminalizes pending rows and preserves terminal history', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-proposal-legacy-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await createMigratedDatabase(databasePath, durableDelegationMigration);
  await seedLegacyDocumentProposals(databasePath);

  const result = await runBootstrap(appDataRoot);
  assert.match(result.stdout, new RegExp(`Applying ${documentProposalMigration}`, 'u'));

  await withClient(databasePath, async (client) => {
    const pending = await selectRow(
      client,
      'SELECT "status", "discardedAt", "reviewedAt", "revision" FROM "StagedChangeSet" WHERE "id" = ?',
      ['legacy-migration-pending']
    );
    assert.equal(pending?.status, 'discarded');
    assert.notEqual(pending?.discardedAt, null);
    assert.notEqual(pending?.reviewedAt, null);
    assert.equal(Number(pending?.revision), 2);

    const terminal = await selectRow(
      client,
      'SELECT "status", "discardedAt", "reviewedAt", "revision", "baseVersionId", "appliedCheckpointVersionId" FROM "StagedChangeSet" WHERE "id" = ?',
      ['legacy-migration-terminal']
    );
    assert.equal(terminal?.status, 'discarded');
    assert.equal(terminal?.discardedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(terminal?.reviewedAt, null);
    assert.equal(Number(terminal?.revision), 4);
    assert.equal(terminal?.baseVersionId, null);
    assert.equal(terminal?.appliedCheckpointVersionId, null);
  });
  await assertCurrentControlPlaneSchema(databasePath);
  await assertVersionImmutability(databasePath, 'legacy-migration-version');
});

test('partial document proposal CAS schema fails closed without recording the migration', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-proposal-partial-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await createMigratedDatabase(databasePath, durableDelegationMigration);
  await withClient(databasePath, (client) =>
    client.execute('ALTER TABLE "StagedChangeSet" ADD COLUMN "patchSha256" TEXT')
  );

  await assert.rejects(
    runBootstrap(appDataRoot),
    /partial StagedChangeSet CAS schema/u
  );
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(documentProposalMigration),
    false
  );
  await withClient(databasePath, async (client) => {
    const proposalColumns = await tableColumnNames(client, 'StagedChangeSet');
    assert.equal(proposalColumns.has('patchSha256'), true);
    assert.equal(proposalColumns.has('baseDraftRevision'), false);
  });
});

test('legacy delegation grant is upgraded with deterministic durable defaults', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-delegation-legacy-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await createMigratedDatabase(databasePath, '20260821150000_add_aligned_label_atomicity');
  await seedLegacyDelegationGrant(databasePath);

  const result = await runBootstrap(appDataRoot);
  assert.match(result.stdout, new RegExp(`Applying ${durableDelegationMigration}`, 'u'));

  await withClient(databasePath, async (client) => {
    const grant = await selectRow(
      client,
      `SELECT "id", "scope", "status", "rootMessageId",
              "expiresAt", "hopLimit", "invocationLimit", "invocationCount"
       FROM "RoomDelegationGrant" WHERE "id" = ?`,
      ['delegation-grant-legacy']
    );
    assert.equal(grant?.scope, 'once');
    assert.equal(grant?.status, 'consumed');
    assert.equal(grant?.rootMessageId, 'delegation-message-legacy');
    assert.equal(grant?.expiresAt, '2030-01-31 00:00:00');
    assert.equal(Number(grant?.hopLimit), 3);
    assert.equal(Number(grant?.invocationLimit), 8);
    assert.equal(Number(grant?.invocationCount), 1);
  });
  await assertCurrentControlPlaneSchema(databasePath);
});

test('partial delegation ledger schema fails closed without recording the migration', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-delegation-partial-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await pushCurrentPrismaSchema(databasePath);
  await withClient(databasePath, (client) =>
    client.execute('DROP INDEX "RoomDelegationInvocation_parentInvocationId_idx"')
  );

  await assert.rejects(
    runBootstrap(appDataRoot),
    /partial durable room delegation ledger schema/u
  );
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(durableDelegationMigration),
    false
  );
  await withClient(databasePath, async (client) => {
    assert.equal(
      await hasIndex(client, 'RoomDelegationInvocation_parentInvocationId_idx'),
      false
    );
  });
});

test('malformed Prisma delegation data fails closed before constraint repair', async (t) => {
  const appDataRoot = await temporaryDirectory(t, 'tobe-bootstrap-delegation-malformed-');
  const databasePath = path.join(appDataRoot, 'dev.db');

  await pushCurrentPrismaSchema(databasePath);
  await seedCurrentDelegationLedger(databasePath, { invalidGrant: true });

  await assert.rejects(
    runBootstrap(appDataRoot),
    /data that violates durable delegation constraints/u
  );
  assert.equal(
    (await appliedMigrationNames(databasePath)).includes(durableDelegationMigration),
    false
  );
  await withClient(databasePath, async (client) => {
    const grant = await selectRow(
      client,
      'SELECT "fromAgentId", "targetAgentId" FROM "RoomDelegationGrant" WHERE "id" = ?',
      ['delegation-grant-current']
    );
    assert.equal(grant?.fromAgentId, grant?.targetAgentId);
    assert.equal(
      await hasCheckConstraint(client, 'RoomDelegationGrant', 'RoomDelegationGrant_agents_check'),
      false
    );
  });
});

async function runBootstrap(appDataRoot) {
  return execFileAsync(
    process.execPath,
    [bootstrapScript, '--app-data-root', appDataRoot],
    { cwd: repoRoot, env: process.env }
  );
}

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  return directory;
}

async function localMigrationNames() {
  return (await fs.readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function pushCurrentPrismaSchema(databasePath) {
  await execFileAsync(
    process.execPath,
    [prismaCli, 'db', 'push', '--url', `file:${databasePath}`],
    { cwd: repoRoot, env: process.env }
  );
}

async function createMigratedDatabase(databasePath, cutoff) {
  const migrations = await localMigrationNames();
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_local_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    for (const migration of migrations) {
      if (migration > cutoff) break;
      const sql = await fs.readFile(
        path.join(migrationsRoot, migration, 'migration.sql'),
        'utf8'
      );
      if (sql.trim()) await client.executeMultiple(sql);
      await client.execute({
        sql: 'INSERT INTO "_dao_local_migrations" ("name") VALUES (?)',
        args: [migration],
      });
    }
  });
}

async function createCanvasLookalikeSchema(databasePath, fixture) {
  const migrationSql = await fs.readFile(
    path.join(migrationsRoot, canvasTablesMigration, 'migration.sql'),
    'utf8'
  );
  assert.equal(migrationSql.includes(fixture.original), true, fixture.name);
  const lookalikeSql = migrationSql.replace(
    fixture.original,
    fixture.replacement
  );
  assert.notEqual(lookalikeSql, migrationSql, fixture.name);
  await withClient(databasePath, (client) =>
    client.executeMultiple(lookalikeSql)
  );
}

async function appliedMigrationNames(databasePath) {
  return withClient(databasePath, async (client) => {
    const result = await client.execute(
      'SELECT "name" FROM "_dao_local_migrations" ORDER BY "name"'
    );
    return result.rows.map((row) => String(row.name));
  });
}

async function pragmaValue(databasePath, pragma) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(pragma)) {
    throw new Error(`Unsafe SQLite pragma name: ${pragma}`);
  }
  return withClient(databasePath, async (client) => {
    const result = await client.execute(`PRAGMA ${pragma}`);
    return String(result.rows[0]?.[0] ?? '').toLowerCase();
  });
}

async function assertCurrentControlPlaneSchema(databasePath) {
  await assertCurrentCanvasSchema(databasePath);
  await withClient(databasePath, async (client) => {
    const tables = await schemaObjectNames(client, 'table');
    assert.equal(tables.has('RoomToolConfirmationRequest'), true);
    assert.equal(tables.has('RoomToolConfirmationGrant'), false);

    const agentColumns = await tableColumnNames(client, 'AgentProfile');
    for (const column of ['capabilitiesJson', 'configJson', 'revision']) {
      assert.equal(agentColumns.has(column), true, `AgentProfile.${column}`);
    }

    const requestColumns = await tableColumnNames(
      client,
      'RoomToolConfirmationRequest'
    );
    for (const column of [
      'toolCallId',
      'parametersJson',
      'status',
      'revision',
      'executionJobId',
    ]) {
      assert.equal(
        requestColumns.has(column),
        true,
        `RoomToolConfirmationRequest.${column}`
      );
    }

    assert.equal(
      await hasUniqueIndex(client, 'RoomToolConfirmationRequest', [
        'organizationId',
        'roomSessionId',
        'deliveryId',
        'toolCallId',
      ]),
      true
    );
    assert.equal(
      await hasUniqueIndex(client, 'RoomToolConfirmationRequest', [
        'executionJobId',
      ]),
      true
    );

    const proposalColumns = await tableColumnNames(client, 'StagedChangeSet');
    for (const column of [
      'baseVersionSha256',
      'baseDraftRevision',
      'patchSchemaVersion',
      'patchSha256',
      'reviewedByUserId',
      'reviewedAt',
    ]) {
      assert.equal(proposalColumns.has(column), true, `StagedChangeSet.${column}`);
    }
    assert.equal(await hasIndex(client, 'StagedChangeSet_baseVersionId_idx'), true);
    assert.equal(
      await hasIndex(client, 'StagedChangeSet_appliedCheckpointVersionId_idx'),
      true
    );
    assert.equal(await hasIndex(client, 'StagedChangeSet_reviewedByUserId_idx'), true);
    assert.equal(
      await hasForeignKey(client, 'StagedChangeSet', {
        column: 'baseVersionId',
        referencedColumn: 'id',
        referencedTable: 'Version',
        onDelete: 'SET NULL',
      }),
      true
    );
    assert.equal(
      await hasForeignKey(client, 'StagedChangeSet', {
        column: 'appliedCheckpointVersionId',
        referencedColumn: 'id',
        referencedTable: 'Version',
        onDelete: 'SET NULL',
      }),
      true
    );
    assert.equal(
      await hasForeignKey(client, 'StagedChangeSet', {
        column: 'reviewedByUserId',
        referencedColumn: 'id',
        referencedTable: 'User',
        onDelete: 'SET NULL',
      }),
      true
    );
    assert.equal(
      await hasTrigger(client, 'Version_immutable_snapshot_update', 'Version'),
      true
    );

    await assertCurrentDelegationLedgerSchema(client);
  });
}

async function assertCurrentCanvasSchema(databasePath) {
  await withClient(databasePath, async (client) => {
    const tables = await schemaObjectNames(client, 'table');
    assert.equal(tables.has('NodeRelation'), true);
    assert.equal(tables.has('ProjectCanvasLayout'), true);

    assert.deepEqual(
      await tableColumnSchema(client, 'NodeRelation'),
      canvasColumnSchemas.NodeRelation
    );
    assert.deepEqual(
      await tableColumnSchema(client, 'ProjectCanvasLayout'),
      canvasColumnSchemas.ProjectCanvasLayout
    );

    await assertCurrentCanvasIndexesAndForeignKeys(client);
  });
}

async function assertCurrentCanvasIndexesAndForeignKeys(client) {
  for (const [table, index, columns, unique] of [
    [
      'NodeRelation',
      'NodeRelation_organizationId_sourceNodeId_idx',
      ['organizationId', 'sourceNodeId'],
      false,
    ],
    [
      'NodeRelation',
      'NodeRelation_organizationId_targetNodeId_idx',
      ['organizationId', 'targetNodeId'],
      false,
    ],
    [
      'NodeRelation',
      'NodeRelation_sourceNodeId_targetNodeId_kind_key',
      ['sourceNodeId', 'targetNodeId', 'kind'],
      true,
    ],
    [
      'ProjectCanvasLayout',
      'ProjectCanvasLayout_organizationId_projectId_key',
      ['organizationId', 'projectId'],
      true,
    ],
  ]) {
    assert.equal(
      await hasNamedIndexOnColumns(client, table, index, columns, unique),
      true,
      index
    );
  }

  for (const [table, expected] of [
    [
      'NodeRelation',
      {
        column: 'organizationId',
        referencedColumn: 'id',
        referencedTable: 'Organization',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
    [
      'NodeRelation',
      {
        column: 'sourceNodeId',
        referencedColumn: 'id',
        referencedTable: 'Document',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
    [
      'NodeRelation',
      {
        column: 'targetNodeId',
        referencedColumn: 'id',
        referencedTable: 'Document',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
    [
      'ProjectCanvasLayout',
      {
        column: 'organizationId',
        referencedColumn: 'id',
        referencedTable: 'Organization',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
    [
      'ProjectCanvasLayout',
      {
        column: 'projectId',
        referencedColumn: 'id',
        referencedTable: 'Document',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
  ]) {
    assert.equal(await hasForeignKey(client, table, expected), true);
  }
}

async function assertCurrentDelegationLedgerSchema(client) {
  const tables = await schemaObjectNames(client, 'table');
  for (const table of [
    'RoomDelegationGrant',
    'RoomDelegationRootBudget',
    'RoomDelegationInvocation',
  ]) {
    assert.equal(tables.has(table), true, table);
  }
  assert.equal(tables.has('new_RoomDelegationGrant'), false);

  const grantColumns = await tableColumnNames(client, 'RoomDelegationGrant');
  for (const column of [
    'expiresAt',
    'hopLimit',
    'invocationLimit',
    'invocationCount',
  ]) {
    assert.equal(grantColumns.has(column), true, `RoomDelegationGrant.${column}`);
  }

  assert.equal(
    await hasUniqueIndex(client, 'RoomDelegationRootBudget', [
      'organizationId',
      'roomId',
      'rootMessageId',
    ]),
    true
  );
  assert.equal(
    await hasUniqueIndex(client, 'RoomDelegationInvocation', [
      'organizationId',
      'roomId',
      'invocationId',
    ]),
    true
  );
  for (const [table, constraint] of [
    ['RoomDelegationGrant', 'RoomDelegationGrant_agents_check'],
    ['RoomDelegationGrant', 'RoomDelegationGrant_count_check'],
    ['RoomDelegationRootBudget', 'RoomDelegationRootBudget_count_check'],
    ['RoomDelegationInvocation', 'RoomDelegationInvocation_status_check'],
    ['RoomDelegationInvocation', 'RoomDelegationInvocation_accepted_receipt_check'],
    ['RoomDelegationInvocation', 'RoomDelegationInvocation_blocked_receipt_check'],
  ]) {
    assert.equal(await hasCheckConstraint(client, table, constraint), true, constraint);
  }
}

async function schemaObjectNames(client, type) {
  const result = await client.execute({
    sql: 'SELECT "name" FROM sqlite_master WHERE "type" = ?',
    args: [type],
  });
  return new Set(result.rows.map((row) => String(row.name)));
}

async function tableColumnNames(client, table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
    throw new Error(`Unsafe SQLite table name: ${table}`);
  }
  const result = await client.execute(`PRAGMA table_info("${table}")`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function tableColumnSchema(client, table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
    throw new Error(`Unsafe SQLite table name: ${table}`);
  }
  const result = await client.execute(`PRAGMA table_info("${table}")`);
  return result.rows
    .map((row) => ({
      name: String(row.name),
      type: String(row.type).trim().toUpperCase(),
      notNull: Boolean(Number(row.notnull)),
      defaultValue:
        row.dflt_value === null || row.dflt_value === undefined
          ? null
          : String(row.dflt_value),
      primaryKeyPosition: Number(row.pk),
      position: Number(row.cid),
    }))
    .sort((left, right) => left.position - right.position)
    .map((column) => ({
      name: column.name,
      type: column.type,
      notNull: column.notNull,
      defaultValue: column.defaultValue,
      primaryKeyPosition: column.primaryKeyPosition,
    }));
}

async function hasUniqueIndex(client, table, columns) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
    throw new Error(`Unsafe SQLite table name: ${table}`);
  }
  const indexes = await client.execute(`PRAGMA index_list("${table}")`);
  for (const index of indexes.rows) {
    if (Number(index.unique) !== 1) continue;
    const name = String(index.name);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`Unsafe SQLite index name: ${name}`);
    }
    const indexedColumns = await client.execute(`PRAGMA index_info("${name}")`);
    const actual = indexedColumns.rows
      .map((row) => ({ name: String(row.name), sequence: Number(row.seqno) }))
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ name: column }) => column);
    if (
      actual.length === columns.length &&
      actual.every((column, position) => column === columns[position])
    ) {
      return true;
    }
  }
  return false;
}

async function hasNamedIndexOnColumns(
  client,
  table,
  indexName,
  columns,
  unique
) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
    throw new Error(`Unsafe SQLite table name: ${table}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(indexName)) {
    throw new Error(`Unsafe SQLite index name: ${indexName}`);
  }
  const indexes = await client.execute(`PRAGMA index_list("${table}")`);
  const index = indexes.rows.find(
    (candidate) => String(candidate.name) === indexName
  );
  if (!index || Boolean(Number(index.unique)) !== unique) {
    return false;
  }

  const indexedColumns = await client.execute(
    `PRAGMA index_info("${indexName}")`
  );
  const actual = indexedColumns.rows
    .map((row) => ({ name: String(row.name), sequence: Number(row.seqno) }))
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ name }) => name);
  return (
    actual.length === columns.length &&
    actual.every((column, position) => column === columns[position])
  );
}

async function hasIndex(client, index) {
  const result = await client.execute({
    sql: 'SELECT 1 FROM sqlite_master WHERE "type" = ? AND "name" = ? LIMIT 1',
    args: ['index', index],
  });
  return result.rows.length > 0;
}

async function hasForeignKey(client, table, expected) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
    throw new Error(`Unsafe SQLite table name: ${table}`);
  }
  const result = await client.execute(`PRAGMA foreign_key_list("${table}")`);
  return result.rows.some(
    (foreignKey) =>
      String(foreignKey.from) === expected.column &&
      String(foreignKey.table) === expected.referencedTable &&
      String(foreignKey.to) === expected.referencedColumn &&
      String(foreignKey.on_delete).toUpperCase() === expected.onDelete &&
      (expected.onUpdate === undefined ||
        String(foreignKey.on_update).toUpperCase() === expected.onUpdate)
  );
}

async function hasTrigger(client, trigger, table) {
  const result = await client.execute({
    sql: 'SELECT "sql" FROM sqlite_master WHERE "type" = ? AND "name" = ? AND "tbl_name" = ? LIMIT 1',
    args: ['trigger', trigger, table],
  });
  return result.rows.length === 1;
}

async function hasCheckConstraint(client, table, constraint) {
  const result = await client.execute({
    sql: 'SELECT "sql" FROM sqlite_master WHERE "type" = ? AND "name" = ? LIMIT 1',
    args: ['table', table],
  });
  return String(result.rows[0]?.sql ?? '').includes(`CONSTRAINT "${constraint}" CHECK`);
}

async function selectRow(client, sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0] ?? null;
}

async function labelKinds(databasePath, versionId) {
  return withClient(databasePath, async (client) => {
    const result = await client.execute({
      sql: 'SELECT "kind" FROM "Label" WHERE "versionId" = ? ORDER BY "kind"',
      args: [versionId],
    });
    return result.rows.map((row) => String(row.kind));
  });
}

async function seedManualVersion(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('org-1', 'org-1', 'Organization', CURRENT_TIMESTAMP);
      INSERT INTO "Session" ("id", "organizationId", "updatedAt")
      VALUES ('session-1', 'org-1', CURRENT_TIMESTAMP);
      INSERT INTO "Document" ("id", "organizationId", "sessionId", "updatedAt")
      VALUES ('document-1', 'org-1', 'session-1', CURRENT_TIMESTAMP);
      INSERT INTO "Version" (
        "id",
        "organizationId",
        "documentId",
        "versionNum",
        "content",
        "title",
        "versionType"
      ) VALUES (
        'version-1',
        'org-1',
        'document-1',
        1,
        '[]',
        'Version 1',
        'manual'
      );
      INSERT INTO "Version" (
        "id",
        "organizationId",
        "documentId",
        "versionNum",
        "content",
        "title",
        "versionType"
      ) VALUES (
        'version-2',
        'org-1',
        'document-1',
        2,
        '[]',
        'Version 2',
        'checkpoint'
      );
      INSERT INTO "Version" (
        "id",
        "organizationId",
        "documentId",
        "versionNum",
        "content",
        "title",
        "versionType"
      ) VALUES (
        'version-3',
        'org-1',
        'document-1',
        3,
        '[]',
        'Version 3',
        'checkpoint_pinned'
      );
    `);
  });
}

async function seedCurrentSchemaDocumentProposals(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('proposal-org', 'proposal-org', 'Proposal Org', CURRENT_TIMESTAMP);
      INSERT INTO "Session" ("id", "organizationId", "updatedAt")
      VALUES ('proposal-session', 'proposal-org', CURRENT_TIMESTAMP);
      INSERT INTO "Document" (
        "id", "organizationId", "sessionId", "draftRevision", "updatedAt"
      ) VALUES (
        'proposal-document', 'proposal-org', 'proposal-session', 3, CURRENT_TIMESTAMP
      );
      INSERT INTO "Version" (
        "id", "organizationId", "documentId", "versionNum",
        "content", "title", "versionType"
      ) VALUES (
        'proposal-version', 'proposal-org', 'proposal-document', 1,
        '[]', 'Proposal Version', 'manual'
      );
      INSERT INTO "StagedChangeSet" (
        "id", "organizationId", "documentId", "baseVersionId",
        "title", "summary", "status", "changesJson", "updatedAt"
      ) VALUES (
        'legacy-pending-proposal', 'proposal-org', 'proposal-document',
        'proposal-version', 'Legacy proposal', 'Missing CAS metadata',
        'pending', '[]', CURRENT_TIMESTAMP
      );
      INSERT INTO "StagedChangeSet" (
        "id", "organizationId", "documentId", "baseVersionId",
        "baseVersionSha256", "baseDraftRevision", "patchSchemaVersion",
        "patchSha256", "title", "summary", "status",
        "changesJson", "updatedAt"
      ) VALUES (
        'cas-pending-proposal', 'proposal-org', 'proposal-document',
        'proposal-version', '${'a'.repeat(64)}', 3, 1, '${'b'.repeat(64)}',
        'CAS proposal', 'Complete CAS metadata', 'pending', '[]', CURRENT_TIMESTAMP
      );
    `);
  });
}

async function seedLegacyDocumentProposals(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('legacy-proposal-org', 'legacy-proposal-org', 'Legacy Proposal Org', CURRENT_TIMESTAMP);
      INSERT INTO "Session" ("id", "organizationId", "updatedAt")
      VALUES ('legacy-proposal-session', 'legacy-proposal-org', CURRENT_TIMESTAMP);
      INSERT INTO "Document" ("id", "organizationId", "sessionId", "updatedAt")
      VALUES ('legacy-proposal-document', 'legacy-proposal-org', 'legacy-proposal-session', CURRENT_TIMESTAMP);
      INSERT INTO "Version" (
        "id", "organizationId", "documentId", "versionNum",
        "content", "title", "versionType"
      ) VALUES (
        'legacy-migration-version', 'legacy-proposal-org',
        'legacy-proposal-document', 1, '[]', 'Legacy Version', 'manual'
      );
      INSERT INTO "StagedChangeSet" (
        "id", "organizationId", "documentId", "baseVersionId",
        "title", "summary", "status", "changesJson", "updatedAt"
      ) VALUES (
        'legacy-migration-pending', 'legacy-proposal-org',
        'legacy-proposal-document', 'legacy-migration-version',
        'Pending legacy proposal', 'Must be terminalized', 'pending', '[]',
        CURRENT_TIMESTAMP
      );
      INSERT INTO "StagedChangeSet" (
        "id", "organizationId", "documentId", "baseVersionId", "appliedCheckpointVersionId",
        "title", "summary", "status", "changesJson", "discardedAt",
        "revision", "updatedAt"
      ) VALUES (
        'legacy-migration-terminal', 'legacy-proposal-org',
        'legacy-proposal-document', 'missing-base-version', 'missing-checkpoint-version',
        'Terminal legacy proposal', 'Must remain terminal', 'discarded', '[]',
        '2026-08-20T00:00:00.000Z', 4, '2026-08-20T00:00:00.000Z'
      );
    `);
  });
}

async function assertVersionImmutability(
  databasePath,
  versionId = 'proposal-version'
) {
  await withClient(databasePath, async (client) => {
    await assert.rejects(
      client.execute({
        sql: 'UPDATE "Version" SET "content" = ? WHERE "id" = ?',
        args: ['mutated', versionId],
      }),
      /Version snapshot fields are immutable/u
    );
    await client.execute({
      sql: 'UPDATE "Version" SET "revision" = "revision" + 1, "deletedAt" = ? WHERE "id" = ?',
      args: [new Date().toISOString(), versionId],
    });
  });
}

async function createLegacyControlPlaneDatabase(databasePath) {
  const migrations = await localMigrationNames();
  const cutoff = '20260821100000_add_room_tool_confirmation_grants';
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_local_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    for (const migration of migrations) {
      if (migration > cutoff) {
        break;
      }
      const sql = await fs.readFile(
        path.join(migrationsRoot, migration, 'migration.sql'),
        'utf8'
      );
      if (sql.trim()) {
        await client.executeMultiple(sql);
      }
      await client.execute({
        sql: 'INSERT INTO "_dao_local_migrations" ("name") VALUES (?)',
        args: [migration],
      });
    }
  });
}

async function seedLegacyAgentProfileAndRoomConfirmationData(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('org-legacy', 'org-legacy', 'Legacy Org', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        "id", "name", "email", "createdAt", "updatedAt"
      ) VALUES (
        'user-legacy', 'Legacy User', 'legacy@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "OrganizationMembership" (
        "id", "organizationId", "userId", "role", "createdAt", "updatedAt"
      ) VALUES (
        'membership-legacy', 'org-legacy', 'user-legacy', 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "AgentProfile" (
        "id", "organizationId", "handle", "name", "description", "skillsJson", "enabled", "builtin", "updatedAt"
      ) VALUES (
        'agent-1', 'org-legacy', '@agent-1', 'Agent One', 'Legacy agent', '["research","summarization"]', true, false, CURRENT_TIMESTAMP
      );

      INSERT INTO "Room" (
        "id", "organizationId", "key", "name", "hostAgentId", "policyJson", "updatedAt"
      ) VALUES (
        'room-1', 'org-legacy', 'default', 'Legacy Room', 'agent-1', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomMessage" (
        "id", "organizationId", "roomId", "sequence", "actorType", "actorId", "text"
      ) VALUES (
        'room-message-1', 'org-legacy', 'room-1', 1, 'user', 'user-legacy', 'Please run the tool'
      );

      INSERT INTO "RoomAgentSession" (
        "id", "organizationId", "roomId", "agentId", "agentHandle", "agentDisplayName", "agentConfigVersion", "updatedAt"
      ) VALUES (
        'room-session-1', 'org-legacy', 'room-1', 'agent-1', '@agent-1', 'Agent One', 'v1', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomInboxDelivery" (
        "id", "organizationId", "roomId", "roomSessionId", "messageId", "deliverySequence", "intent", "causeJson", "updatedAt"
      ) VALUES (
        'delivery-1', 'org-legacy', 'room-1', 'room-session-1', 'room-message-1', 1, 'tool-confirmation', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomToolConfirmationGrant" (
        "id", "organizationId", "actorUserId", "roomId", "roomMessageId", "roomSessionId", "toolName", "parametersHash", "nonceHash", "expiresAt", "updatedAt"
      ) VALUES (
        'grant-1', 'org-legacy', 'user-legacy', 'room-1', 'room-message-1', 'room-session-1', 'write_file',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        DATETIME('now', '+1 day'),
        CURRENT_TIMESTAMP
      );
    `);
  });
}

async function seedCurrentSchemaLegacyAgentData(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('org-current', 'org-current', 'Current Org', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        "id", "name", "email", "createdAt", "updatedAt"
      ) VALUES (
        'user-current', 'Current User', 'current@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "OrganizationMembership" (
        "id", "organizationId", "userId", "role", "createdAt", "updatedAt"
      ) VALUES (
        'membership-current', 'org-current', 'user-current', 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "AgentProfile" (
        "id", "organizationId", "handle", "name", "description", "skillsJson", "capabilitiesJson", "configJson", "enabled", "builtin", "revision", "updatedAt"
      ) VALUES (
        'agent-current-1', 'org-current', '@agent-current', 'Agent Current', 'Current schema row',
        '["planning","coding"]',
        '{"schemaVersion":1,"skills":[]}',
        '{"schemaVersion":1,"room":{"runtimeId":"pi-agent-core","configVersion":1}}',
        true, false, 1, CURRENT_TIMESTAMP
      );

      INSERT INTO "Room" (
        "id", "organizationId", "key", "name", "hostAgentId", "policyJson", "updatedAt"
      ) VALUES (
        'room-current-1', 'org-current', 'default', 'Current Room', 'agent-current-1', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomMessage" (
        "id", "organizationId", "roomId", "sequence", "actorType", "actorId", "text"
      ) VALUES (
        'room-message-current-1', 'org-current', 'room-current-1', 1, 'user', 'user-current', 'Current schema tool request'
      );

      INSERT INTO "RoomAgentSession" (
        "id", "organizationId", "roomId", "agentId", "agentHandle", "agentDisplayName", "agentConfigVersion", "updatedAt"
      ) VALUES (
        'room-session-current-1', 'org-current', 'room-current-1', 'agent-current-1', '@agent-current', 'Agent Current', 'v1', CURRENT_TIMESTAMP
      );
    `);
  });
}

async function seedCurrentDelegationLedger(databasePath, options = {}) {
  const targetAgentId = options.invalidGrant ? 'agent-delegation-a' : 'agent-delegation-b';
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('org-delegation', 'org-delegation', 'Delegation Org', CURRENT_TIMESTAMP);

      INSERT INTO "AgentProfile" (
        "id", "organizationId", "handle", "name", "description",
        "skillsJson", "capabilitiesJson", "configJson", "enabled",
        "builtin", "revision", "updatedAt"
      ) VALUES
        ('agent-delegation-a', 'org-delegation', '@delegation-a', 'Delegation A', '', '[]',
         '{"schemaVersion":1,"skills":[]}', '{}', true, false, 1, CURRENT_TIMESTAMP),
        ('agent-delegation-b', 'org-delegation', '@delegation-b', 'Delegation B', '', '[]',
         '{"schemaVersion":1,"skills":[]}', '{}', true, false, 1, CURRENT_TIMESTAMP);

      INSERT INTO "Room" (
        "id", "organizationId", "key", "name", "hostAgentId", "policyJson", "updatedAt"
      ) VALUES (
        'room-delegation', 'org-delegation', 'delegation', 'Delegation Room',
        'agent-delegation-a', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomMessage" (
        "id", "organizationId", "roomId", "sequence", "actorType", "actorId", "text"
      ) VALUES (
        'delegation-message-current', 'org-delegation', 'room-delegation', 1,
        'agent', 'agent-delegation-a', 'Delegate work'
      );

      INSERT INTO "RoomAgentSession" (
        "id", "organizationId", "roomId", "agentId", "agentHandle",
        "agentDisplayName", "agentConfigVersion", "updatedAt"
      ) VALUES (
        'delegation-session-current', 'org-delegation', 'room-delegation',
        'agent-delegation-a', '@delegation-a', 'Delegation A', '1', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomInboxDelivery" (
        "id", "organizationId", "roomId", "roomSessionId", "messageId",
        "deliverySequence", "intent", "causeJson", "updatedAt"
      ) VALUES (
        'delegation-delivery-current', 'org-delegation', 'room-delegation',
        'delegation-session-current', 'delegation-message-current', 1,
        'delegation', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomEvent" (
        "id", "organizationId", "roomId", "sequence", "type", "dataJson"
      ) VALUES (
        'delegation-event-current', 'org-delegation', 'room-delegation', 1,
        'delegation.blocked', '{}'
      );

      INSERT INTO "RoomDelegationGrant" (
        "id", "organizationId", "roomId", "issuedByUserId",
        "fromAgentId", "targetAgentId", "scope", "status",
        "rootMessageId", "expiresAt", "hopLimit", "invocationLimit",
        "invocationCount", "updatedAt"
      ) VALUES (
        'delegation-grant-current', 'org-delegation', 'room-delegation', 'user-delegation',
        'agent-delegation-a', '${targetAgentId}', 'room', 'active',
        'root-message-current', '2030-02-01 00:00:00', 3, 8, 0, CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomDelegationRootBudget" (
        "id", "organizationId", "roomId", "rootMessageId",
        "invocationLimit", "invocationCount", "updatedAt"
      ) VALUES (
        'delegation-budget-current', 'org-delegation', 'room-delegation',
        'root-message-current', 8, 0, CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomDelegationInvocation" (
        "id", "organizationId", "roomId", "invocationId", "requestHash",
        "rootMessageId", "fromAgentId", "targetAgentId", "sourceRoomSessionId",
        "sourceDeliveryId", "sourceGeneration", "hop", "blockedEventId",
        "failureCode", "status", "completedAt", "updatedAt"
      ) VALUES (
        'delegation-invocation-current', 'org-delegation', 'room-delegation',
        'invocation-current', 'request-hash-current', 'root-message-current',
        'agent-delegation-a', 'agent-delegation-b', 'delegation-session-current',
        'delegation-delivery-current', 0, 1, 'delegation-event-current',
        'policy_denied', 'blocked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);
  });
}

async function assertDelegationSeedPreserved(databasePath) {
  await withClient(databasePath, async (client) => {
    const grant = await selectRow(
      client,
      `SELECT "targetAgentId", "rootMessageId", "expiresAt", "hopLimit",
              "invocationLimit", "invocationCount"
       FROM "RoomDelegationGrant" WHERE "id" = ?`,
      ['delegation-grant-current']
    );
    assert.equal(grant?.targetAgentId, 'agent-delegation-b');
    assert.equal(grant?.rootMessageId, 'root-message-current');
    assert.equal(grant?.expiresAt, '2030-02-01 00:00:00');
    assert.equal(Number(grant?.hopLimit), 3);
    assert.equal(Number(grant?.invocationLimit), 8);
    assert.equal(Number(grant?.invocationCount), 0);

    const budget = await selectRow(
      client,
      'SELECT "rootMessageId", "invocationLimit", "invocationCount" FROM "RoomDelegationRootBudget" WHERE "id" = ?',
      ['delegation-budget-current']
    );
    assert.equal(budget?.rootMessageId, 'root-message-current');
    assert.equal(Number(budget?.invocationLimit), 8);
    assert.equal(Number(budget?.invocationCount), 0);

    const invocation = await selectRow(
      client,
      `SELECT "invocationId", "requestHash", "sourceGeneration", "hop",
              "blockedEventId", "failureCode", "status"
       FROM "RoomDelegationInvocation" WHERE "id" = ?`,
      ['delegation-invocation-current']
    );
    assert.equal(invocation?.invocationId, 'invocation-current');
    assert.equal(invocation?.requestHash, 'request-hash-current');
    assert.equal(Number(invocation?.sourceGeneration), 0);
    assert.equal(Number(invocation?.hop), 1);
    assert.equal(invocation?.blockedEventId, 'delegation-event-current');
    assert.equal(invocation?.failureCode, 'policy_denied');
    assert.equal(invocation?.status, 'blocked');
  });
}

async function seedLegacyDelegationGrant(databasePath) {
  await withClient(databasePath, async (client) => {
    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "updatedAt")
      VALUES ('org-delegation-legacy', 'org-delegation-legacy', 'Legacy Delegation Org', CURRENT_TIMESTAMP);

      INSERT INTO "AgentProfile" (
        "id", "organizationId", "handle", "name", "description",
        "skillsJson", "capabilitiesJson", "configJson", "enabled",
        "builtin", "revision", "updatedAt"
      ) VALUES
        ('agent-delegation-legacy-a', 'org-delegation-legacy', '@legacy-a', 'Legacy A', '', '[]',
         '{"schemaVersion":1,"skills":[]}', '{}', true, false, 1, CURRENT_TIMESTAMP),
        ('agent-delegation-legacy-b', 'org-delegation-legacy', '@legacy-b', 'Legacy B', '', '[]',
         '{"schemaVersion":1,"skills":[]}', '{}', true, false, 1, CURRENT_TIMESTAMP);

      INSERT INTO "Room" (
        "id", "organizationId", "key", "name", "hostAgentId", "policyJson", "updatedAt"
      ) VALUES (
        'room-delegation-legacy', 'org-delegation-legacy', 'delegation-legacy',
        'Legacy Delegation Room', 'agent-delegation-legacy-a', '{}', CURRENT_TIMESTAMP
      );

      INSERT INTO "RoomDelegationGrant" (
        "id", "organizationId", "roomId", "issuedByUserId",
        "fromAgentId", "targetAgentId", "scope", "status",
        "rootMessageId", "consumedByInvocationId", "consumedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        'delegation-grant-legacy', 'org-delegation-legacy', 'room-delegation-legacy',
        'user-delegation-legacy', 'agent-delegation-legacy-a', 'agent-delegation-legacy-b',
        'once', 'consumed', 'delegation-message-legacy', 'invocation-legacy',
        '2030-01-01 00:01:00', '2030-01-01 00:00:00', '2030-01-01 00:00:00'
      );
    `);
  });
}

async function withClient(databasePath, operation) {
  const client = createClient({ url: `file:${databasePath}` });
  try {
    return await operation(client);
  } finally {
    await client.close();
  }
}
