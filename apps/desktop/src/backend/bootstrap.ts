import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';

type SchemaInspector = {
  hasColumn: (table: string, column: string) => Promise<boolean>;
  hasTable: (table: string) => Promise<boolean>;
};

const MIGRATION_PROBES: Record<
  string,
  (inspector: SchemaInspector) => Promise<boolean>
> = {
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

export async function bootstrapDesktopDatabase(params: {
  appDataRoot: string;
  appPath: string;
  log: (event: string, context?: Record<string, unknown>) => Promise<void>;
}) {
  const targetDbPath = path.join(params.appDataRoot, 'dev.db');
  const runtimeRoot = process.env.DAO_DESKTOP_RUNTIME_ROOT?.trim() || params.appPath;
  const migrationsRoot = path.join(runtimeRoot, 'prisma', 'migrations');
  const client = createClient({
    url: `file:${targetDbPath}`,
  });
  const inspector = createSchemaInspector(client);

  try {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_desktop_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = await client.execute(
      'SELECT "name" FROM "_dao_desktop_migrations" ORDER BY "name" ASC'
    );
    const appliedMigrations = new Set(
      appliedRows.rows
        .map((row) => (typeof row.name === 'string' ? row.name : String(row.name ?? '')))
        .filter(Boolean)
    );

    const migrationEntries = await fs.readdir(migrationsRoot, { withFileTypes: true });
    const migrationNames = migrationEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationNames) {
      if (appliedMigrations.has(migrationName)) {
        continue;
      }

      if (await schemaAlreadySatisfiesMigration(inspector, migrationName)) {
        await params.log('desktop.migration.markExisting', {
          migrationName,
          targetDbPath,
        });
        await markMigrationApplied(client, migrationName);
        continue;
      }

      const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
      const migrationSql = await fs.readFile(migrationPath, 'utf8');
      await params.log('desktop.migration.apply', {
        migrationName,
        targetDbPath,
      });

      if (migrationSql.trim()) {
        await client.executeMultiple(migrationSql);
      }

      await markMigrationApplied(client, migrationName);
    }
  } finally {
    await client.close();
  }
}

function createSchemaInspector(client: ReturnType<typeof createClient>): SchemaInspector {
  return {
    async hasTable(table) {
      const result = await client.execute({
        sql: 'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
        args: ['table', table],
      });
      return result.rows.length > 0;
    },
    async hasColumn(table, column) {
      const safeTableName = quoteSqliteIdentifier(table);
      const result = await client.execute(`PRAGMA table_info(${safeTableName})`);
      return result.rows.some((row) => {
        const name = typeof row.name === 'string' ? row.name : String(row.name ?? '');
        return name === column;
      });
    },
  };
}

async function markMigrationApplied(
  client: ReturnType<typeof createClient>,
  migrationName: string
) {
  await client.execute({
    sql: 'INSERT INTO "_dao_desktop_migrations" ("name") VALUES (?)',
    args: [migrationName],
  });
}

async function schemaAlreadySatisfiesMigration(
  inspector: SchemaInspector,
  migrationName: string
) {
  const probe = MIGRATION_PROBES[migrationName];
  if (!probe) {
    return false;
  }

  return probe(inspector);
}

function quoteSqliteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }

  return `"${value}"`;
}
