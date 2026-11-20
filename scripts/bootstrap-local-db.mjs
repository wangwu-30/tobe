/**
 * Core local SQLite bootstrapper: enforces WAL mode, foreign keys, and replays
 * Prisma migrations in deterministic order.
 *
 * Historical drift-repair probes live in scripts/db/legacy-repairs.mjs (frozen);
 * all new schema changes must go strictly through prisma/migrations/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

import {
  MIGRATION_ACTION_MARK,
  MIGRATION_ACTION_REPAIR,
  MIGRATION_PROBES,
  resolveMigrationStrategy,
} from "./db/legacy-repairs.mjs";
import {
  createSchemaInspector,
  quoteSqliteString,
} from "./db/schema-inspector.mjs";

export { MIGRATION_PROBES };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const migrationsRoot = path.join(repoRoot, "prisma", "migrations");

async function markMigrationApplied(client, migrationName) {
  const statements = [
    "BEGIN IMMEDIATE;",
    `INSERT INTO "_dao_local_migrations" ("name") VALUES (${quoteSqliteString(migrationName)});`,
    "COMMIT;",
  ].join("\n\n");
  await client.executeMultiple(statements);
}

async function executeMigrationStep(client, migrationName, sql) {
  const trimmedSql = sql?.trim();
  if (!trimmedSql) {
    return;
  }

  if (hasForeignKeyManagedMigration(trimmedSql)) {
    await executeForeignKeyManagedMigrationStep(
      client,
      migrationName,
      trimmedSql,
    );
    return;
  }

  const statements = [
    "BEGIN IMMEDIATE;",
    trimmedSql,
    `INSERT INTO "_dao_local_migrations" ("name") VALUES (${quoteSqliteString(migrationName)});`,
    "COMMIT;",
  ]
    .filter(Boolean)
    .join("\n\n");
  await client.executeMultiple(statements);
}

async function assertNoForeignKeyViolations(client, migrationName) {
  const result = await client.execute("PRAGMA foreign_key_check");
  if (result.rows.length === 0) {
    return;
  }

  const details = result.rows
    .slice(0, 5)
    .map((row) => {
      const table = String(row.table ?? "");
      const rowId = String(row.rowid ?? "");
      const parent = String(row.parent ?? "");
      const foreignKeyId = String(row.fkid ?? "");
      return `table=${table || "unknown"}, rowid=${rowId || "unknown"}, parent=${parent || "unknown"}, fkid=${foreignKeyId || "unknown"}`;
    })
    .join("; ");
  const remainder =
    result.rows.length > 5 ? ` (+${result.rows.length - 5} more)` : "";
  throw new Error(
    `${migrationName} failed foreign_key_check after schema changes: ${details}${remainder}`,
  );
}

function hasForeignKeyManagedMigration(sql) {
  return /PRAGMA\s+foreign_keys\s*=\s*OFF\b/i.test(sql);
}

function stripManagedForeignKeyPragmas(sql) {
  return sql
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*OFF\s*;\s*$/gim, "")
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, "")
    .replace(/^\s*PRAGMA\s+foreign_key_check\s*;\s*$/gim, "")
    .trim();
}

async function executeForeignKeyManagedMigrationStep(
  client,
  migrationName,
  sql,
) {
  const body = stripManagedForeignKeyPragmas(sql);
  if (!body) {
    throw new Error(
      `${migrationName} declared PRAGMA foreign_keys=OFF but has no executable migration body after stripping managed pragmas.`,
    );
  }

  await client.execute("PRAGMA foreign_keys = OFF");
  const transaction = await client.transaction("write");
  try {
    for (const statement of splitSqlStatements(body)) {
      await transaction.execute(statement);
    }
    await assertNoForeignKeyViolations(transaction, migrationName);
    await transaction.execute({
      sql: 'INSERT INTO "_dao_local_migrations" ("name") VALUES (?)',
      args: [migrationName],
    });
    await transaction.commit();
  } catch (error) {
    try {
      if (!transaction.closed) {
        await transaction.rollback();
      }
    } catch {
      // Best-effort rollback; preserve the original failure.
    }
    throw error;
  } finally {
    if (!transaction.closed) {
      transaction.close();
    }
    await client.execute("PRAGMA foreign_keys = ON");
  }
}

function splitSqlStatements(sql) {
  const statements = [];
  let buffer = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let isTriggerStatement = false;
  let triggerBlockDepth = 0;

  const flushToken = () => {
    if (!token) return;
    const upper = token.toUpperCase();
    if (upper === "TRIGGER") {
      isTriggerStatement = true;
    } else if (isTriggerStatement && upper === "BEGIN") {
      triggerBlockDepth += 1;
    } else if (isTriggerStatement && upper === "END" && triggerBlockDepth > 0) {
      triggerBlockDepth -= 1;
    }
    token = "";
  };

  const flushStatement = () => {
    const statement = buffer.trim();
    if (statement) {
      statements.push(statement);
    }
    buffer = "";
    token = "";
    isTriggerStatement = false;
    triggerBlockDepth = 0;
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] ?? "";
    buffer += char;

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        buffer += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        buffer += next;
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      flushToken();
      buffer += next;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      flushToken();
      buffer += next;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      flushToken();
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      flushToken();
      inDoubleQuote = true;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      token += char;
      continue;
    }

    if (/[0-9]/.test(char) && token) {
      token += char;
      continue;
    }

    flushToken();

    if (char === ";") {
      if (!isTriggerStatement || triggerBlockDepth === 0) {
        flushStatement();
      }
    }
  }

  flushToken();
  flushStatement();
  return statements;
}

async function main() {
  const targetDbPath = path.join(resolveAppDataRoot(), "dev.db");
  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
  const client = createClient({
    url: `file:${targetDbPath}`,
  });
  const inspector = createSchemaInspector(client);

  try {
    const journalMode = await client.execute('PRAGMA journal_mode = WAL');
    const effectiveJournalMode = String(
      journalMode.rows[0]?.journal_mode ?? journalMode.rows[0]?.[0] ?? '',
    ).toLowerCase();
    if (effectiveJournalMode !== 'wal') {
      throw new Error(
        `Could not enable SQLite WAL mode for ${targetDbPath}; got ${effectiveJournalMode || 'no result'}.`,
      );
    }
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA foreign_keys = ON');
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_local_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = await client.execute(
      'SELECT "name" FROM "_dao_local_migrations" ORDER BY "name" ASC',
    );
    const appliedMigrations = new Set(
      appliedRows.rows
        .map((row) =>
          typeof row.name === "string" ? row.name : String(row.name ?? ""),
        )
        .filter(Boolean),
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

      const strategy = await resolveMigrationStrategy(migrationName, inspector);
      if (strategy.action === MIGRATION_ACTION_MARK) {
        console.log(
          `Marking existing schema as already satisfying ${migrationName}`,
        );
        await assertNoForeignKeyViolations(client, migrationName);
        await markMigrationApplied(client, migrationName);
        continue;
      }

      if (strategy.action === MIGRATION_ACTION_REPAIR) {
        console.log(`Repairing existing schema for ${migrationName}`);
        await executeMigrationStep(client, migrationName, strategy.sql);
        if (!strategy.sql?.trim()) {
          await assertNoForeignKeyViolations(client, migrationName);
          await markMigrationApplied(client, migrationName);
        }
        continue;
      }

      const migrationPath = path.join(
        migrationsRoot,
        migrationName,
        "migration.sql",
      );
      const migrationSql = fs.readFileSync(migrationPath, "utf8");
      if (migrationSql.trim()) {
        console.log(`Applying ${migrationName}`);
      }
      await executeMigrationStep(client, migrationName, migrationSql);
      if (!migrationSql.trim()) {
        await assertNoForeignKeyViolations(client, migrationName);
        await markMigrationApplied(client, migrationName);
      }
    }
  } finally {
    await client.close();
  }
}

function resolveAppDataRoot() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--app-data-root");
  if (flagIndex !== -1) {
    const nextValue = args[flagIndex + 1];
    if (!nextValue) {
      throw new Error("Missing value for --app-data-root");
    }

    return path.resolve(nextValue);
  }

  const envAppDataRoot = process.env.DAO_APP_DATA_ROOT?.trim();
  if (envAppDataRoot) {
    return path.resolve(envAppDataRoot);
  }

  return repoRoot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
