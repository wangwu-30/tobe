import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';

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

      const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
      const migrationSql = await fs.readFile(migrationPath, 'utf8');
      await params.log('desktop.migration.apply', {
        migrationName,
        targetDbPath,
      });

      if (migrationSql.trim()) {
        await client.executeMultiple(migrationSql);
      }

      await client.execute({
        sql: 'INSERT INTO "_dao_desktop_migrations" ("name") VALUES (?)',
        args: [migrationName],
      });
    }
  } finally {
    await client.close();
  }
}
