/**
 * SQLite schema introspection helpers used by the local DB bootstrapper and
 * historical drift repair probes.
 */

export function quoteSqliteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }

  return `"${value}"`;
}

export function quoteSqliteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function createSchemaInspector(client) {
  return {
    async hasTable(table) {
      const result = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["table", table],
      });
      return result.rows.length > 0;
    },
    async lacksTable(table) {
      return !(await this.hasTable(table));
    },
    async hasColumn(table, column) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      return result.rows.some((row) => {
        const name =
          typeof row.name === "string" ? row.name : String(row.name ?? "");
        return name === column;
      });
    },
    async hasColumnDefinition(table, expected) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      return result.rows.some((row) => {
        const column = {
          defaultValue:
            row.dflt_value === null || row.dflt_value === undefined
              ? null
              : String(row.dflt_value),
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          notNull: Boolean(Number(row.notnull)),
          primaryKeyPosition: Number(row.pk),
          type: String(row.type ?? "").trim().toUpperCase(),
        };
        return (
          column.name === expected.name &&
          column.type === expected.type.trim().toUpperCase() &&
          column.notNull === expected.notNull &&
          column.defaultValue === expected.defaultValue &&
          column.primaryKeyPosition === expected.primaryKeyPosition
        );
      });
    },
    async hasExactColumns(table, columns) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      const actual = result.rows
        .map((row) => ({
          defaultValue:
            row.dflt_value === null || row.dflt_value === undefined
              ? null
              : String(row.dflt_value),
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          notNull: Boolean(Number(row.notnull)),
          position: Number(row.cid),
          primaryKeyPosition: Number(row.pk),
          type: String(row.type ?? "").trim().toUpperCase(),
        }))
        .sort((left, right) => left.position - right.position);
      return (
        actual.length === columns.length &&
        actual.every((column, position) => {
          const expected = columns[position];
          if (typeof expected === "string") {
            return column.name === expected;
          }
          return (
            column.name === expected.name &&
            column.type === expected.type.trim().toUpperCase() &&
            column.notNull === expected.notNull &&
            column.defaultValue === expected.defaultValue &&
            column.primaryKeyPosition === expected.primaryKeyPosition
          );
        })
      );
    },
    async hasIndex(index) {
      const result = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["index", index],
      });
      return result.rows.length > 0;
    },
    async hasUniqueIndex(table, columns) {
      return this.hasIndexOnColumns(table, columns, true);
    },
    async hasIndexOnColumns(table, columns, unique) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      for (const index of indexes.rows) {
        if (Boolean(Number(index.unique)) !== unique) continue;
        const name =
          typeof index.name === "string"
            ? index.name
            : String(index.name ?? "");
        if (!name) continue;
        const indexedColumns = await client.execute(
          `PRAGMA index_info(${quoteSqliteIdentifier(name)})`,
        );
        const actual = indexedColumns.rows
          .map((row) => ({
            name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
            sequence: Number(row.seqno),
          }))
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ name: column }) => column);
        if (
          actual.length === columns.length &&
          actual.every((column, index) => column === columns[index])
        ) {
          return true;
        }
      }
      return false;
    },
    async hasNamedIndexOnColumns(table, indexName, columns, unique) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      const index = indexes.rows.find(
        (candidate) => String(candidate.name ?? "") === indexName,
      );
      if (!index || Boolean(Number(index.unique)) !== unique) {
        return false;
      }

      const indexedColumns = await client.execute(
        `PRAGMA index_info(${quoteSqliteIdentifier(indexName)})`,
      );
      const actual = indexedColumns.rows
        .map((row) => ({
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          sequence: Number(row.seqno),
        }))
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ name }) => name);
      return (
        actual.length === columns.length &&
        actual.every((column, position) => column === columns[position])
      );
    },
    async hasForeignKey(table, expected) {
      const foreignKeys = await client.execute(
        `PRAGMA foreign_key_list(${quoteSqliteIdentifier(table)})`,
      );
      return foreignKeys.rows.some((foreignKey) => {
        const column = String(foreignKey.from ?? "");
        const referencedTable = String(foreignKey.table ?? "");
        const referencedColumn = String(foreignKey.to ?? "");
        const onDelete = String(foreignKey.on_delete ?? "").toUpperCase();
        const onUpdate = String(foreignKey.on_update ?? "").toUpperCase();
        return (
          column === expected.column &&
          referencedTable === expected.referencedTable &&
          referencedColumn === expected.referencedColumn &&
          onDelete === expected.onDelete &&
          (expected.onUpdate === undefined || onUpdate === expected.onUpdate)
        );
      });
    },
    async hasTrigger(trigger, table) {
      const result = await client.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? AND tbl_name = ? LIMIT 1",
        args: ["trigger", trigger, table],
      });
      const sql = String(result.rows[0]?.sql ?? "");
      return (
        sql.includes("Version snapshot fields are immutable") &&
        sql.includes('NEW."content" IS NOT OLD."content"') &&
        sql.includes('NEW."versionType" IS NOT OLD."versionType"')
      );
    },
    async hasPartialUniqueIndex(table, columns, predicateSql) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      const normalizedPredicate = predicateSql.replace(/\s+/g, " ").trim();
      for (const index of indexes.rows) {
        if (Number(index.unique) !== 1 || Number(index.partial) !== 1) continue;
        const name =
          typeof index.name === "string"
            ? index.name
            : String(index.name ?? "");
        if (!name) continue;
        const indexedColumns = await client.execute(
          `PRAGMA index_info(${quoteSqliteIdentifier(name)})`,
        );
        const actual = indexedColumns.rows
          .map((row) => ({
            name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
            sequence: Number(row.seqno),
          }))
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ name: column }) => column);
        if (
          actual.length !== columns.length ||
          !actual.every((column, position) => column === columns[position])
        ) {
          continue;
        }

        const definition = await client.execute({
          sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
          args: ["index", name],
        });
        const sql =
          typeof definition.rows[0]?.sql === "string"
            ? definition.rows[0].sql
            : String(definition.rows[0]?.sql ?? "");
        if (!sql) continue;
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        if (normalizedSql.includes(normalizedPredicate)) {
          return true;
        }
      }
      return false;
    },
    async hasCheckConstraint(table, constraintName, expressionSql) {
      const definition = await client.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["table", table],
      });
      const sql =
        typeof definition.rows[0]?.sql === "string"
          ? definition.rows[0].sql
          : String(definition.rows[0]?.sql ?? "");
      if (!sql) return false;

      const expected = `CONSTRAINT ${quoteSqliteIdentifier(constraintName)} CHECK (${expressionSql})`;
      return normalizeSqliteSchemaSql(sql).includes(
        normalizeSqliteSchemaSql(expected),
      );
    },
    async hasAnyRows(sql) {
      const result = await client.execute(sql);
      return result.rows.length > 0;
    },
    async hasNoRows(sql) {
      return !(await this.hasAnyRows(sql));
    },
    async scalarEquals(leftSql, rightSql) {
      const [left, right] = await Promise.all([
        client.execute(leftSql),
        client.execute(rightSql),
      ]);
      return (
        String(left.rows[0]?.[0] ?? left.rows[0]?.value ?? "") ===
        String(right.rows[0]?.[0] ?? right.rows[0]?.value ?? "")
      );
    },
  };
}

export function normalizeSqliteSchemaSql(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
