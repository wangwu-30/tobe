import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const migrationsRoot = path.join(repoRoot, 'prisma', 'migrations');
const targetDbPath = path.join(resolveAppDataRoot(), 'dev.db');

const MIGRATION_PROBES = {
  '20260312090000_current_schema_baseline': async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable('Organization'),
        inspector.hasTable('User'),
        inspector.hasTable('Session'),
        inspector.hasTable('Document'),
        inspector.hasTable('Version'),
        inspector.hasTable('WorkspacePlan'),
      ])
    ).every(Boolean),
  '20260313100000_add_project_root_path': async (inspector) =>
    inspector.hasColumn('Document', 'projectRootPath'),
  '20260314093000_add_workspace_project_fields': async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn('Document', 'projectId'),
        inspector.hasColumn('Document', 'projectTitle'),
        inspector.hasColumn('Document', 'parentDocumentId'),
      ])
    ).every(Boolean),
  '20260314112000_add_project_folders': async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn('Document', 'projectFolderId'),
        inspector.hasTable('ProjectFolder'),
      ])
    ).every(Boolean),
  '20260314143000_add_project_tree_sort_order': async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn('Document', 'treeSortOrder'),
        inspector.hasColumn('ProjectFolder', 'treeSortOrder'),
      ])
    ).every(Boolean),
  '20260314160000_rename_version_snapshot_type': async (inspector) =>
    inspector.hasColumn('Version', 'versionType'),
  '20260314190000_add_workflow_playbooks': async (inspector) =>
    inspector.hasTable('WorkflowPlaybook'),
  '20260314193000_add_active_workflow_playbook_to_workspace_plan': async (
    inspector
  ) => inspector.hasColumn('WorkspacePlan', 'activeWorkflowPlaybookId'),
  '20260314203000_add_workflow_playbook_structure_fields': async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn('WorkflowPlaybook', 'steps'),
        inspector.hasColumn('WorkflowPlaybook', 'constraints'),
        inspector.hasColumn('WorkflowPlaybook', 'checklist'),
      ])
    ).every(Boolean),
  '20260314210000_add_workflow_playbook_archiving': async (inspector) =>
    inspector.hasColumn('WorkflowPlaybook', 'archivedAt'),
};

function quoteSqliteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }

  return `"${value}"`;
}

function createSchemaInspector(client) {
  return {
    async hasTable(table) {
      const result = await client.execute({
        sql: 'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
        args: ['table', table],
      });
      return result.rows.length > 0;
    },
    async hasColumn(table, column) {
      const result = await client.execute(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`);
      return result.rows.some((row) => {
        const name = typeof row.name === 'string' ? row.name : String(row.name ?? '');
        return name === column;
      });
    },
  };
}

async function markMigrationApplied(client, migrationName) {
  await client.execute({
    sql: 'INSERT INTO "_dao_local_migrations" ("name") VALUES (?)',
    args: [migrationName],
  });
}

async function main() {
  const client = createClient({
    url: `file:${targetDbPath}`,
  });
  const inspector = createSchemaInspector(client);

  try {
    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_local_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = await client.execute(
      'SELECT "name" FROM "_dao_local_migrations" ORDER BY "name" ASC'
    );
    const appliedMigrations = new Set(
      appliedRows.rows
        .map((row) => (typeof row.name === 'string' ? row.name : String(row.name ?? '')))
        .filter(Boolean)
    );

    const migrationNames = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationNames) {
      if (appliedMigrations.has(migrationName)) {
        continue;
      }

      const probe = MIGRATION_PROBES[migrationName];
      if (probe && (await probe(inspector))) {
        console.log(`Marking existing schema as already satisfying ${migrationName}`);
        await markMigrationApplied(client, migrationName);
        continue;
      }

      const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      if (migrationSql.trim()) {
        console.log(`Applying ${migrationName}`);
        await client.executeMultiple(migrationSql);
      }
      await markMigrationApplied(client, migrationName);
    }
  } finally {
    await client.close();
  }
}

function resolveAppDataRoot() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--app-data-root');
  if (flagIndex !== -1) {
    const nextValue = args[flagIndex + 1];
    if (!nextValue) {
      throw new Error('Missing value for --app-data-root');
    }

    return path.resolve(nextValue);
  }

  const envAppDataRoot = process.env.DAO_APP_DATA_ROOT?.trim();
  if (envAppDataRoot) {
    return path.resolve(envAppDataRoot);
  }

  return repoRoot;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
