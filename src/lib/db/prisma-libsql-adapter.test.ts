import {
  createClient,
  type Client,
} from '@libsql/client';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  SafePrismaLibSqlAdapterV1,
  createSafeLocalLibSqlConnectionV1,
} from './prisma-libsql-adapter';

const EMPTY_QUERY = { args: [], argTypes: [], sql: 'SELECT 1' };

test('local file connection preserves WAL, sets pragmas, and dispose releases an active writer', async () => {
  await usingDatabase(async (databaseUrl) => {
    const bootstrap = createClient({ url: databaseUrl });
    try {
      const journalMode = await bootstrap.execute('PRAGMA journal_mode = WAL');
      expect(resultValue(journalMode.rows[0], 'journal_mode')).toBe('wal');
      await bootstrap.execute('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    } finally {
      bootstrap.close();
    }

    const adapter = new SafePrismaLibSqlAdapterV1({ url: databaseUrl });
    const connection = await adapter.connect();
    const observer = createClient({ timeout: 150, url: databaseUrl });
    try {
      expect(await pragmaText(connection, 'journal_mode')).toBe('wal');
      expect(await pragmaValue(connection, 'busy_timeout')).toBe(5_000);
      expect(await pragmaValue(connection, 'foreign_keys')).toBe(1);

      const transaction = await connection.startTransaction('SERIALIZABLE');
      await transaction.executeRaw(sql('INSERT INTO items (id) VALUES (1)'));
      await Promise.all([connection.dispose(), connection.dispose()]);

      await observer.execute('INSERT INTO items (id) VALUES (2)');
      const rows = await observer.execute('SELECT id FROM items ORDER BY id');
      expect(rows.rows.map((row) => Number(row.id))).toEqual([2]);
      await expect(transaction.commit()).resolves.toBeUndefined();
      await expect(connection.queryRaw(EMPTY_QUERY)).rejects.toMatchObject({
        cause: { kind: 'ConnectionClosed' },
      });
    } finally {
      observer.close();
      await connection.dispose();
    }
  });
});

test('failed COMMIT physically reconnects before a second independent writer continues', async () => {
  await usingDatabase(async (databaseUrl) => {
    const setup = createClient({ url: databaseUrl });
    try {
      const journalMode = await setup.execute('PRAGMA journal_mode = DELETE');
      expect(resultValue(journalMode.rows[0], 'journal_mode')).toBe('delete');
      await setup.execute(
        'CREATE TABLE items (id INTEGER PRIMARY KEY)'
      );
      await setup.execute('INSERT INTO items (id) VALUES (0)');
    } finally {
      setup.close();
    }

    const clientCalls: string[] = [];
    const physicalClient = createClient({ timeout: 150, url: databaseUrl });
    const connection = createSafeLocalLibSqlConnectionV1(
      observeRealClient(physicalClient, clientCalls, {
        forbidDetachedTransactions: true,
      })
    );
    const secondWriter = createClient({ timeout: 500, url: databaseUrl });
    const releaseReader = await holdReadLockInChild(databaseUrl);
    try {
      // Keep this real contention test fast without changing the production
      // adapter's verified 5 second default. Reconnect must restore 5000.
      await connection.executeRaw(sql('PRAGMA busy_timeout = 150'));

      const transaction = await connection.startTransaction('SERIALIZABLE');
      await transaction.executeRaw(sql('INSERT INTO items (id) VALUES (1)'));
      await expect(transaction.commit()).rejects.toMatchObject({
        cause: { kind: 'SocketTimeout', originalCode: '5' },
      });
      await releaseReader();

      expect(clientCalls.filter((call) => call === 'client.reconnect')).toHaveLength(1);
      await secondWriter.execute('INSERT INTO items (id) VALUES (2)');
      const rows = await secondWriter.execute('SELECT id FROM items ORDER BY id');
      expect(rows.rows.map((row) => Number(row.id))).toEqual([0, 2]);

      // The first adapter operation after physical replacement initializes
      // the fresh handle before returning it to Prisma.
      expect(await pragmaValue(connection, 'busy_timeout')).toBe(5_000);
      expect(await pragmaValue(connection, 'foreign_keys')).toBe(1);
    } finally {
      await releaseReader().catch(() => undefined);
      secondWriter.close();
      await connection.dispose();
    }
  });
});

test('transaction control stays on the parent handle while connection work waits', async () => {
  await usingDatabase(async (databaseUrl) => {
    const clientCalls: string[] = [];
    const physicalClient = createClient({ url: databaseUrl });
    const connection = createSafeLocalLibSqlConnectionV1(
      observeRealClient(physicalClient, clientCalls, {
        forbidDetachedTransactions: true,
      })
    );
    const observer = createClient({ url: databaseUrl });
    try {
      await connection.executeScript(
        'CREATE TABLE items (id INTEGER PRIMARY KEY)'
      );
      clientCalls.length = 0;

      const committed = await connection.startTransaction('SERIALIZABLE');
      await committed.executeRaw(sql('INSERT INTO items (id) VALUES (1)'));
      const queuedRead = connection.queryRaw(
        sql('SELECT id FROM items ORDER BY id')
      );
      await nextTask();
      expect(clientCalls).toEqual([
        'client.execute:BEGIN IMMEDIATE',
        'client.execute:INSERT INTO items (id) VALUES (1)',
      ]);

      await committed.commit();
      expect((await queuedRead).rows.map((row) => Number(row[0]))).toEqual([1]);
      expect(clientCalls).toEqual([
        'client.execute:BEGIN IMMEDIATE',
        'client.execute:INSERT INTO items (id) VALUES (1)',
        'client.executeMultiple:COMMIT',
        'client.execute:SELECT id FROM items ORDER BY id',
      ]);

      const rolledBack = await connection.startTransaction('SERIALIZABLE');
      await rolledBack.executeRaw(sql('INSERT INTO items (id) VALUES (2)'));
      await rolledBack.rollback();
      const rows = await observer.execute('SELECT id FROM items ORDER BY id');
      expect(rows.rows.map((row) => Number(row.id))).toEqual([1]);
      expect(clientCalls.slice(-3)).toEqual([
        'client.execute:BEGIN IMMEDIATE',
        'client.execute:INSERT INTO items (id) VALUES (2)',
        'client.execute:ROLLBACK',
      ]);
    } finally {
      observer.close();
      await connection.dispose();
    }
  });
});

test('failed commit preserves its error when rollback and close cleanup also fail', async () => {
  const calls: string[] = [];
  const commitError = driverError('commit boom');
  const client = fakeClient(
    {
      commitError,
      reconnectError: driverError('close boom'),
      rollbackError: driverError('rollback boom'),
    },
    calls
  );
  const connection = createSafeLocalLibSqlConnectionV1(client);

  const safeTransaction = await connection.startTransaction('SERIALIZABLE');
  await expect(safeTransaction.commit()).rejects.toMatchObject({
    cause: { originalMessage: 'commit boom' },
  });
  expect(calls).toEqual([
    'client.execute:PRAGMA busy_timeout = 5000',
    'client.execute:PRAGMA foreign_keys = ON',
    'client.execute:BEGIN IMMEDIATE',
    'client.executeMultiple:COMMIT',
    'client.execute:ROLLBACK',
    'client.reconnect',
  ]);

  await connection.executeRaw(EMPTY_QUERY);
  await connection.dispose();
  expect(calls.at(-1)).toBe('client.close');
});

test('a recovered handle is initialized again before its next Prisma query', async () => {
  const calls: string[] = [];
  const connection = createSafeLocalLibSqlConnectionV1(
    fakeClient(
      {
        commitError: driverError('commit boom'),
      },
      calls
    )
  );

  const transaction = await connection.startTransaction('SERIALIZABLE');
  await expect(transaction.commit()).rejects.toMatchObject({
    cause: { originalMessage: 'commit boom' },
  });
  await connection.queryRaw(EMPTY_QUERY);

  expect(
    calls.filter((call) => call === 'client.execute:PRAGMA busy_timeout = 5000')
  ).toHaveLength(2);
  expect(
    calls.filter((call) => call === 'client.execute:PRAGMA foreign_keys = ON')
  ).toHaveLength(2);
  await connection.dispose();
});

test('dispose cancels one active transaction exactly once and is idempotent', async () => {
  const calls: string[] = [];
  const connection = createSafeLocalLibSqlConnectionV1(fakeClient({}, calls));

  await connection.startTransaction('SERIALIZABLE');
  await Promise.all([connection.dispose(), connection.dispose()]);

  expect(calls.filter((call) => call === 'client.execute:ROLLBACK')).toHaveLength(1);
  expect(calls.filter((call) => call === 'client.close')).toHaveLength(1);
  await expect(connection.queryRaw(EMPTY_QUERY)).rejects.toMatchObject({
    cause: { kind: 'ConnectionClosed' },
  });
});

function sql(statement: string) {
  return { args: [], argTypes: [], sql: statement };
}

async function pragmaValue(
  connection: Awaited<ReturnType<SafePrismaLibSqlAdapterV1['connect']>>,
  pragma: string
): Promise<number> {
  const result = await connection.queryRaw(sql(`PRAGMA ${pragma}`));
  return Number(result.rows[0]?.[0]);
}

async function pragmaText(
  connection: Awaited<ReturnType<SafePrismaLibSqlAdapterV1['connect']>>,
  pragma: string
): Promise<string> {
  const result = await connection.queryRaw(sql(`PRAGMA ${pragma}`));
  return String(result.rows[0]?.[0] ?? '').toLowerCase();
}

async function usingDatabase(
  operation: (databaseUrl: string) => Promise<void>
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-safe-libsql-'));
  try {
    await operation(`file:${path.join(directory, 'dev.db')}`);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
}

function driverError(message: string): Error & { code: string; rawCode: number } {
  return Object.assign(new Error(message), { code: 'SQLITE_BUSY', rawCode: 5 });
}

function observeRealClient(
  client: Client,
  calls: string[],
  options: { forbidDetachedTransactions?: boolean } = {}
): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'execute') {
        return (...args: unknown[]) => {
          calls.push(`client.execute:${statementSql(args[0])}`);
          return Reflect.apply(target.execute, target, args);
        };
      }
      if (property === 'reconnect') {
        return async () => {
          calls.push('client.reconnect');
          await target.reconnect();
        };
      }
      if (property === 'executeMultiple') {
        return (...args: unknown[]) => {
          calls.push(`client.executeMultiple:${String(args[0] ?? '')}`);
          return Reflect.apply(target.executeMultiple, target, args);
        };
      }
      if (property === 'transaction' && options.forbidDetachedTransactions) {
        return async () => {
          throw new Error(
            'The safe local adapter must use the parent client handle.'
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function statementSql(statement: unknown): string {
  return typeof statement === 'string'
    ? statement
    : String((statement as { sql?: unknown } | null)?.sql ?? '');
}

function resultValue(
  row: Record<string, unknown> | undefined,
  column: string
): string {
  return String(row?.[column] ?? row?.[0] ?? '').toLowerCase();
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function holdReadLockInChild(
  databaseUrl: string
): Promise<() => Promise<void>> {
  const script = `
    import { createClient } from '@libsql/client';
    const client = createClient({ timeout: 150, url: process.argv[1] });
    try {
      await client.execute('BEGIN DEFERRED');
      await client.execute('SELECT id FROM items');
      console.log('ready');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      await client.execute('ROLLBACK');
    } finally {
      client.close();
    }
  `;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', script, databaseUrl],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.once('data', (chunk) => {
      if (String(chunk).includes('ready')) resolve();
      else reject(new Error(`Unexpected read-lock helper output: ${String(chunk)}`));
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      reject(
        new Error(
          `Read-lock helper exited before readiness (${String(code)}): ${stderr}`
        )
      );
    });
  });

  let releasePromise: Promise<void> | null = null;
  return () => {
    if (releasePromise) return releasePromise;
    releasePromise = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else {
          reject(
            new Error(
              `Read-lock helper failed during release (${String(code)}): ${stderr}`
            )
          );
        }
      });
      child.stdin.end('release\n');
    });
    return releasePromise;
  };
}

function fakeClient(
  options: {
    commitError?: Error;
    reconnectError?: Error;
    rollbackError?: Error;
  },
  calls: string[]
): Client {
  let closed = false;
  const client = {
    batch: async () => [],
    close() {
      calls.push('client.close');
      closed = true;
    },
    get closed() {
      return closed;
    },
    execute: async (statement: unknown) => {
      const value =
        typeof statement === 'string'
          ? statement
          : String((statement as { sql?: unknown }).sql ?? '');
      calls.push(`client.execute:${value}`);
      if (value === 'COMMIT' && options.commitError) throw options.commitError;
      if (value === 'ROLLBACK' && options.rollbackError) {
        throw options.rollbackError;
      }
      return emptyResultSet();
    },
    executeMultiple: async (script: string) => {
      calls.push(`client.executeMultiple:${script}`);
      if (script === 'COMMIT' && options.commitError) {
        throw options.commitError;
      }
    },
    migrate: async () => [],
    protocol: 'file',
    reconnect: () => {
      calls.push('client.reconnect');
      closed = false;
      if (options.reconnectError) throw options.reconnectError;
    },
    sync: async () => undefined,
    transaction: async () => {
      throw new Error('The safe local adapter must not detach a native handle.');
    },
  };
  return client as Client;
}

function emptyResultSet() {
  return {
    columnTypes: [],
    columns: [],
    lastInsertRowid: undefined,
    rows: [],
    rowsAffected: 0,
    toJSON() {
      return {};
    },
  };
}
