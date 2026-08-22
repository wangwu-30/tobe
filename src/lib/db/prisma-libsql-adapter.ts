import {
  createClient,
  type Client,
  type Config,
  type InValue,
  type Row,
} from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { ColumnTypeEnum, DriverAdapterError } from '@prisma/driver-adapter-utils';
import type {
  ArgType,
  ColumnType,
  IsolationLevel,
  ResultValue,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlResultSet,
  Transaction,
} from '@prisma/driver-adapter-utils';

const LOCAL_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_BUSY_PRIMARY_CODE = 5;
const SQLITE_PRIMARY_CODE_MASK = 0xff;

/**
 * The upstream Prisma libSQL adapter leaves a detached native transaction
 * open when COMMIT fails. Prisma then forgets that transaction, so a later
 * disconnect cannot roll it back and the connection can retain a SQLite lock.
 *
 * This local-file adapter keeps the same public Prisma driver contract while
 * using BEGIN IMMEDIATE on the parent client handle. This is intentional:
 * `Client.transaction()` detaches its native SQLite handle, while the public
 * transaction `close()` only rolls it back and cannot physically close that
 * handle after a failed COMMIT. Keeping the transaction on the parent handle
 * lets us roll it back directly or replace the handle with `reconnect()` when
 * cleanup also fails. Remote libSQL URLs continue to use Prisma's adapter.
 */
export class SafePrismaLibSqlAdapterV1
  implements SqlMigrationAwareDriverAdapterFactory
{
  readonly provider = 'sqlite' as const;
  readonly adapterName = '@prisma/adapter-libsql';

  constructor(private readonly config: Config) {}

  async connect(): Promise<SqlDriverAdapter> {
    if (!isLocalDatabaseUrl(this.config.url)) {
      return new PrismaLibSql(this.config).connect();
    }
    const client = createClient(localClientConfig(this.config));
    const connection = new SafeLocalLibSqlConnectionV1(client);
    try {
      await connection.initialize();
      return connection;
    } catch (error) {
      try {
        await connection.dispose();
      } catch {
        // Initialization remains the authoritative error.
      }
      throw error;
    }
  }

  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    const connection = new SafeLocalLibSqlConnectionV1(
      createClient(localClientConfig({ ...this.config, url: ':memory:' }))
    );
    try {
      await connection.initialize();
      return connection;
    } catch (error) {
      try {
        await connection.dispose();
      } catch {
        // Initialization remains the authoritative error.
      }
      throw error;
    }
  }
}

/** Public seam for lifecycle fault-injection tests and custom local clients. */
export function createSafeLocalLibSqlConnectionV1(
  client: Client
): SqlDriverAdapter {
  return new SafeLocalLibSqlConnectionV1(client);
}

class SafeLocalLibSqlQueryableV1<
  TClient extends Client,
> {
  readonly provider = 'sqlite' as const;
  readonly adapterName = '@prisma/adapter-libsql';

  constructor(protected readonly client: TClient) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    try {
      const result = await this.client.execute({
        sql: query.sql,
        args: query.args.map((arg, index) =>
          mapArgument(arg, query.argTypes[index])
        ),
      });
      const columnTypes = getColumnTypes(result.columnTypes, result.rows);
      return {
        columnNames: result.columns,
        columnTypes,
        rows: result.rows.map((row) =>
          Array.from(row, (value, index) =>
            mapResultValue(value, columnTypes[index])
          )
        ),
      };
    } catch (error) {
      throw toDriverAdapterError(error);
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    try {
      const result = await this.client.execute({
        sql: query.sql,
        args: query.args.map((arg, index) =>
          mapArgument(arg, query.argTypes[index])
        ),
      });
      return result.rowsAffected;
    } catch (error) {
      throw toDriverAdapterError(error);
    }
  }
}

class SafeLocalLibSqlConnectionV1
  extends SafeLocalLibSqlQueryableV1<Client>
  implements SqlDriverAdapter
{
  private readonly lock = new ExclusiveLockV1();
  private state: 'open' | 'disposing' | 'disposed' = 'open';
  private initialized = false;
  private activeTransaction: SafeLocalLibSqlTransactionV1 | null = null;
  private disposePromise: Promise<void> | null = null;

  constructor(client: Client) {
    super(client);
  }

  async initialize(): Promise<void> {
    return this.exclusive(async () => undefined);
  }

  override queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    return this.exclusive(() => super.queryRaw(query));
  }

  override executeRaw(query: SqlQuery): Promise<number> {
    return this.exclusive(() => super.executeRaw(query));
  }

  async executeScript(script: string): Promise<void> {
    return this.exclusive(async () => {
      try {
        await this.client.executeMultiple(script);
      } catch (error) {
        throw toDriverAdapterError(error);
      }
    });
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      });
    }
    const releaseLock = await this.lock.acquire();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseLock();
    };
    try {
      this.assertOpen();
      await this.initializeCurrentHandle();
      this.assertOpen();
      await this.client.execute('BEGIN IMMEDIATE');
      const safeTransaction = new SafeLocalLibSqlTransactionV1(
        this.client,
        () => {
          if (this.activeTransaction === safeTransaction) {
            this.activeTransaction = null;
          }
          release();
        },
        () => this.recoverCurrentHandle()
      );
      this.activeTransaction = safeTransaction;
      if (this.state !== 'open') {
        await safeTransaction.cancel();
        throw connectionClosedError();
      }
      return safeTransaction;
    } catch (error) {
      release();
      throw toDriverAdapterError(error);
    }
  }

  getConnectionInfo() {
    return { supportsRelationJoins: false };
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    if (this.state === 'disposed') return;

    this.state = 'disposing';
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    let originalError: unknown;
    const transaction = this.activeTransaction;
    if (transaction) {
      try {
        await transaction.cancel();
      } catch (error) {
        originalError = error;
      }
    }

    const release = await this.lock.acquire();
    try {
      try {
        this.client.close();
      } catch (error) {
        if (originalError === undefined) originalError = error;
      } finally {
        this.state = 'disposed';
      }
    } finally {
      release();
    }
    if (originalError !== undefined) throw toDriverAdapterError(originalError);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.lock.acquire();
    try {
      this.assertOpen();
      await this.initializeCurrentHandle();
      this.assertOpen();
      return await operation();
    } finally {
      release();
    }
  }

  private async initializeCurrentHandle(): Promise<void> {
    if (this.initialized) return;
    try {
      await initializeLocalConnection(this.client);
      this.initialized = true;
    } catch (error) {
      throw toDriverAdapterError(error);
    }
  }

  private async recoverCurrentHandle(): Promise<void> {
    this.initialized = false;
    try {
      await Promise.resolve(this.client.reconnect());
    } finally {
      // reconnect() creates a fresh native handle. The next operation must set
      // both pragmas on that handle before exposing it to Prisma.
      this.initialized = false;
    }
  }

  private assertOpen(): void {
    if (this.state !== 'open') throw connectionClosedError();
  }
}

class SafeLocalLibSqlTransactionV1
  extends SafeLocalLibSqlQueryableV1<Client>
  implements Transaction
{
  readonly options = { usePhantomQuery: true } as const;
  private readonly lock = new ExclusiveLockV1();
  private state: 'active' | 'terminating' | 'closed' = 'active';
  private parentReleased = false;

  constructor(
    client: Client,
    private readonly onClosed: () => void,
    private readonly recoverHandle: () => Promise<void>
  ) {
    super(client);
  }

  override queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    return this.runAction(() => super.queryRaw(query));
  }

  override executeRaw(query: SqlQuery): Promise<number> {
    return this.runAction(() => super.executeRaw(query));
  }

  async commit(): Promise<void> {
    return this.lock.runExclusive(() => this.terminate('commit'));
  }

  async rollback(): Promise<void> {
    return this.lock.runExclusive(() => this.terminate('rollback'));
  }

  async cancel(): Promise<void> {
    return this.lock.runExclusive(() => this.terminate('rollback'));
  }

  private async runAction<T>(operation: () => Promise<T>): Promise<T> {
    return this.lock.runExclusive(async () => {
      this.assertActive();
      try {
        return await operation();
      } catch (error) {
        await this.cleanupWithoutMasking();
        throw error;
      }
    });
  }

  private async terminate(action: 'commit' | 'rollback'): Promise<void> {
    if (this.state === 'closed') return;
    this.assertActive();
    this.state = 'terminating';
    let originalError: unknown;
    try {
      if (action === 'commit') {
        // The local client's execute() path can retain the failed COMMIT's
        // prepared statement until garbage collection, keeping an OS-level
        // SQLite lock even after ROLLBACK and reconnect(). executeMultiple()
        // finalizes the statement synchronously and rolls back in its own
        // finally path when COMMIT fails. It still executes on this same
        // parent Client/native handle.
        await this.client.executeMultiple('COMMIT');
      } else {
        await this.client.execute('ROLLBACK');
      }
    } catch (error) {
      originalError = error;
      if (action === 'commit') {
        await this.rollbackWithoutMasking();
        // A failed COMMIT leaves the native connection in an uncertain state.
        // Even when the best-effort ROLLBACK reports success, replace the
        // physical handle before releasing the parent connection lock.
        await this.recoverWithoutMasking();
      } else {
        await this.recoverWithoutMasking();
      }
    } finally {
      this.finishCleanup();
    }
    if (originalError !== undefined) throw toDriverAdapterError(originalError);
  }

  private async cleanupWithoutMasking(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'terminating';
    try {
      const rolledBack = await this.rollbackWithoutMasking();
      if (!rolledBack) await this.recoverWithoutMasking();
    } finally {
      this.finishCleanup();
    }
  }

  private async rollbackWithoutMasking(): Promise<boolean> {
    try {
      await this.client.execute('ROLLBACK');
      return true;
    } catch {
      return false;
    }
  }

  private async recoverWithoutMasking(): Promise<void> {
    try {
      await this.recoverHandle();
    } catch {
      // The original transaction error remains authoritative. reconnect()
      // performs its close in a finally-backed replacement path.
    }
  }

  private finishCleanup(): void {
    this.state = 'closed';
    if (this.parentReleased) return;
    this.parentReleased = true;
    this.onClosed();
  }

  private assertActive(): void {
    if (this.state !== 'active') {
      throw new DriverAdapterError({
        kind: 'TransactionAlreadyClosed',
        cause: 'The libSQL transaction is already closed.',
      });
    }
  }
}

class ExclusiveLockV1 {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let unlock!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
    };
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function initializeLocalConnection(client: Client): Promise<void> {
  await client.execute(`PRAGMA busy_timeout = ${LOCAL_BUSY_TIMEOUT_MS}`);
  await client.execute('PRAGMA foreign_keys = ON');
}

function localClientConfig(config: Config): Config {
  return { ...config, timeout: LOCAL_BUSY_TIMEOUT_MS };
}

function isLocalDatabaseUrl(url: string): boolean {
  return url === ':memory:' || url.startsWith('file:');
}

function mapArgument(value: unknown, type: ArgType): InValue {
  if (value === null) return null;
  if (type?.scalarType === 'bigint' && typeof value === 'string') {
    return BigInt(value);
  }
  if (type?.scalarType === 'decimal' && typeof value === 'string') {
    return Number.parseFloat(value);
  }
  if (type?.scalarType === 'datetime' && typeof value === 'string') {
    return new Date(value).toISOString().replace('Z', '+00:00');
  }
  if (type?.scalarType === 'bytes' && typeof value === 'string') {
    return Buffer.from(value, 'base64');
  }
  if (value instanceof Date) return value.toISOString().replace('Z', '+00:00');
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new DriverAdapterError({
    kind: 'InvalidInputValue',
    message: `Unsupported libSQL argument value: ${describeValue(value)}`,
  });
}

function mapColumnType(type: string): ColumnType | null {
  switch (type.toUpperCase()) {
    case '':
      return null;
    case 'INT':
    case 'INTEGER':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'TINYINT':
    case 'SERIAL':
    case 'INT2':
      return ColumnTypeEnum.Int32;
    case 'BIGINT':
    case 'UNSIGNED BIG INT':
    case 'INT8':
      return ColumnTypeEnum.Int64;
    case 'FLOAT':
      return ColumnTypeEnum.Float;
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'REAL':
    case 'NUMERIC':
      return ColumnTypeEnum.Double;
    case 'DECIMAL':
      return ColumnTypeEnum.Numeric;
    case 'BOOLEAN':
      return ColumnTypeEnum.Boolean;
    case 'CHAR':
    case 'CHARACTER':
      return ColumnTypeEnum.Character;
    case 'TEXT':
    case 'CLOB':
    case 'VARCHAR':
    case 'VARYING CHARACTER':
    case 'NCHAR':
    case 'NATIVE CHARACTER':
    case 'NVARCHAR':
      return ColumnTypeEnum.Text;
    case 'DATE':
      return ColumnTypeEnum.Date;
    case 'TIME':
      return ColumnTypeEnum.Time;
    case 'DATETIME':
    case 'TIMESTAMP':
      return ColumnTypeEnum.DateTime;
    case 'JSONB':
      return ColumnTypeEnum.Json;
    case 'BLOB':
      return ColumnTypeEnum.Bytes;
    default:
      return null;
  }
}

function getColumnTypes(
  declaredTypes: readonly string[],
  rows: readonly Row[]
): ColumnType[] {
  return declaredTypes.map((declaredType, columnIndex) => {
    const mapped = mapColumnType(declaredType);
    if (mapped !== null) return mapped;
    for (const row of rows) {
      const value = row[columnIndex];
      if (value !== null) return inferColumnType(value);
    }
    return ColumnTypeEnum.Int32;
  });
}

function inferColumnType(value: unknown): ColumnType {
  if (typeof value === 'string') return ColumnTypeEnum.Text;
  if (typeof value === 'bigint') return ColumnTypeEnum.Int64;
  if (typeof value === 'boolean') return ColumnTypeEnum.Boolean;
  if (typeof value === 'number') return ColumnTypeEnum.UnknownNumber;
  if (value instanceof ArrayBuffer) return ColumnTypeEnum.Bytes;
  throw new Error(`Unexpected libSQL result value: ${String(value)}`);
}

function mapResultValue(value: unknown, columnType: ColumnType): ResultValue {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'bigint') return value.toString();
  if (
    typeof value === 'number' &&
    (columnType === ColumnTypeEnum.Int32 ||
      columnType === ColumnTypeEnum.Int64) &&
    !Number.isInteger(value)
  ) {
    return Math.trunc(value);
  }
  if (
    (typeof value === 'number' || typeof value === 'bigint') &&
    columnType === ColumnTypeEnum.DateTime
  ) {
    return new Date(Number(value)).toISOString();
  }
  return value as ResultValue;
}

function toDriverAdapterError(error: unknown): DriverAdapterError {
  if (error instanceof DriverAdapterError) return error;
  if (!isLibSqlDriverError(error)) throw error;
  const record = error as Record<string, unknown>;
  const message = record.message as string;
  const originalRawCode = numericCode(record.rawCode);
  const rawCode =
    originalRawCode ?? numericCode(nestedRawCode(record.cause)) ?? 1;
  const originalCode =
    originalRawCode === null ? undefined : String(originalRawCode);
  const original = { originalCode, originalMessage: message };
  if (rawCode === 2067 || rawCode === 1555) {
    return new DriverAdapterError({
      kind: 'UniqueConstraintViolation',
      constraint: constraintFields(message),
      ...original,
    });
  }
  if (rawCode === 1299) {
    return new DriverAdapterError({
      kind: 'NullConstraintViolation',
      constraint: constraintFields(message),
      ...original,
    });
  }
  if (rawCode === 787 || rawCode === 1811) {
    return new DriverAdapterError({
      kind: 'ForeignKeyConstraintViolation',
      constraint: { foreignKey: {} },
      ...original,
    });
  }
  if ((rawCode & SQLITE_PRIMARY_CODE_MASK) === SQLITE_BUSY_PRIMARY_CODE) {
    return new DriverAdapterError({
      kind: 'SocketTimeout',
      ...original,
    });
  }
  if (message.startsWith('no such table')) {
    return new DriverAdapterError({
      kind: 'TableDoesNotExist',
      table: message.split(': ').at(1),
      ...original,
    });
  }
  if (message.startsWith('no such column')) {
    return new DriverAdapterError({
      kind: 'ColumnNotFound',
      column: message.split(': ').at(1),
      ...original,
    });
  }
  if (message.includes('has no column named ')) {
    return new DriverAdapterError({
      kind: 'ColumnNotFound',
      column: message.split('has no column named ').at(1),
      ...original,
    });
  }
  return new DriverAdapterError({
    kind: 'sqlite',
    extendedCode: rawCode,
    message,
    ...original,
  });
}

function constraintFields(
  message: string
): { fields: string[] } | undefined {
  const fields = message
    .split('constraint failed: ')
    .at(1)
    ?.split(', ')
    .map((field) => field.split('.').at(-1) ?? field);
  return fields ? { fields } : undefined;
}

function connectionClosedError(): DriverAdapterError {
  return new DriverAdapterError({ kind: 'ConnectionClosed' });
}

function nestedRawCode(value: unknown): unknown {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>).rawCode
    : undefined;
}

function isLibSqlDriverError(
  error: unknown
): error is {
  code: string;
  message: string;
  rawCode?: number | string;
  cause?: unknown;
} {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return (
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    (record.rawCode === undefined || numericCode(record.rawCode) !== null)
  );
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    return Object.prototype.toString.call(value);
  }
  return typeof value;
}

function numericCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}
