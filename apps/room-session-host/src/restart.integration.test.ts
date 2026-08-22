import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

const run = promisify(execFile);
const ENTRY = path.resolve(
  process.cwd(),
  '.vite/room-session-host/index.mjs'
);
const ORGANIZATION_ID = 'room-host-restart-org';
const USER_ID = 'room-host-restart-user';
const AGENT_ID = 'room-host-restart-agent';
const ROOM_ID = 'room-host-restart-room';
const SESSION_ID = 'room-host-restart-session';
const MESSAGE_ID = 'room-host-restart-message';
const DELIVERY_ID = 'room-host-restart-delivery';
const RUNTIME_ID = 'restart-stub-runtime';
const ACCEPTED_MESSAGE_TEXT = '@restart process this accepted message';
const RESTARTED_RESPONSE_TEXT = 'response-from-restarted-host';
type HostProcess = ChildProcessByStdio<null, Readable, Readable> & {
  capturedStderr: string;
};

test('a separately restarted built host reclaims and completes a persisted accepted message after SIGKILL', async () => {
  test.setTimeout(45_000);
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'tobe-room-host-restart-')
  );
  const databasePath = path.join(temporaryRoot, 'dev.db');
  const firstConfigPath = path.join(temporaryRoot, 'room-host-first.json');
  const secondConfigPath = path.join(temporaryRoot, 'room-host-second.json');
  const environment = {
    ...process.env,
    DAO_APP_DATA_ROOT: temporaryRoot,
    DATABASE_URL: `file:${databasePath}`,
  };
  let first: HostProcess | null = null;
  let second: HostProcess | null = null;
  let database = createClient({ url: `file:${databasePath}` });

  try {
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      { cwd: process.cwd(), env: environment }
    );
    await database.execute('PRAGMA journal_mode = WAL');
    await seedAcceptedMessage(database);
    await Promise.all([
      writeHostConfig(
        firstConfigPath,
        'room-host-before-crash',
        RESTARTED_RESPONSE_TEXT
      ),
      writeHostConfig(
        secondConfigPath,
        'room-host-after-crash',
        RESTARTED_RESPONSE_TEXT
      ),
    ]);

    const firstHost = startHost({
      ...environment,
      DAO_ROOM_SESSION_HOST_CONFIG_PATH: firstConfigPath,
    });
    first = firstHost;
    await waitForStructuredEvent(firstHost, 'ready');
    await waitForDelivery(database, {
      status: 'claimed',
      workerId: 'room-host-before-crash',
    });

    firstHost.kill('SIGKILL');
    await waitForExit(firstHost);
    first = null;
    // Drop the observer connection that overlapped the killed writer. This
    // mirrors a genuinely independent restart and lets SQLite recover any hot
    // journal before either the assertions or the replacement host reconnect.
    await database.close();
    database = createClient({ url: `file:${databasePath}` });

    const stranded = await waitForReadableDelivery(database);
    expect(stranded).toMatchObject({
      attempt: 1,
      status: 'claimed',
      workerId: 'room-host-before-crash',
    });

    const secondHost = startHost({
      ...environment,
      DAO_ROOM_SESSION_HOST_CONFIG_PATH: secondConfigPath,
    });
    second = secondHost;
    await waitForStructuredEvent(secondHost, 'ready');
    let completed;
    try {
      completed = await waitForDelivery(database, {
        status: 'completed',
        workerId: null,
      });
    } catch (error) {
      const hostStderr = secondHost.capturedStderr;
      secondHost.kill('SIGKILL');
      await waitForExit(secondHost);
      second = null;
      const persisted = await waitForReadableDelivery(database);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
          `Persisted state: ${JSON.stringify(persisted)}. ` +
          `Host stderr: ${hostStderr}`
      );
    }
    expect(completed.attempt).toBe(2);
    expect(completed.generation).toBe(2);

    const outputMessages = await database.execute({
      sql: `SELECT "text" FROM "RoomMessage"
        WHERE "roomId" = ? AND "actorType" = 'agent'`,
      args: [ROOM_ID],
    });
    expect(outputMessages.rows).toHaveLength(1);
    expect(String(outputMessages.rows[0]?.text)).toBe(RESTARTED_RESPONSE_TEXT);

    const terminalEvents = await database.execute({
      sql: `SELECT "type" FROM "RoomEvent"
        WHERE "roomId" = ? AND "type" = 'room.delivery.completed'`,
      args: [ROOM_ID],
    });
    expect(terminalEvents.rows).toHaveLength(1);

    secondHost.kill('SIGTERM');
    const exit = await waitForExit(secondHost);
    second = null;
    expect(exit.code).toBe(0);
  } finally {
    first?.kill('SIGKILL');
    second?.kill('SIGKILL');
    await database.close();
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

async function seedAcceptedMessage(database: Client) {
  const now = new Date().toISOString();
  const policy = JSON.stringify({
    schemaVersion: 1,
    participation: {
      mode: 'quiet-host',
      hostAgentId: AGENT_ID,
      unmentionedHostAction: 'observe',
    },
    delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
  });
  const message = {
    schemaVersion: 1,
    envelopeType: 'room.message',
    messageId: MESSAGE_ID,
    organizationId: ORGANIZATION_ID,
    roomId: ROOM_ID,
    sequence: 1,
    createdAt: now,
    actor: { type: 'human', userId: USER_ID },
    text: ACCEPTED_MESSAGE_TEXT,
    mentions: [
      {
        type: 'agent',
        agentId: AGENT_ID,
        handle: '@restart',
        range: { start: 0, end: 8 },
      },
    ],
    attachments: [],
    correlationId: 'room-host-restart-correlation',
  };

  await database.batch(
    [
      {
        sql: `INSERT INTO "Organization"
          ("id", "slug", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?)`,
        args: [ORGANIZATION_ID, ORGANIZATION_ID, 'Room Host Restart Org', now, now],
      },
      {
        sql: `INSERT INTO "User" ("id", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?)`,
        args: [USER_ID, 'Room Host Restart User', now, now],
      },
      {
        sql: `INSERT INTO "OrganizationMembership"
          ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'owner', ?, ?)`,
        args: ['room-host-restart-membership', ORGANIZATION_ID, USER_ID, now, now],
      },
      {
        sql: `INSERT INTO "AgentProfile"
          ("id", "organizationId", "handle", "name", "description", "skillsJson", "enabled", "builtin", "createdAt", "updatedAt")
          VALUES (?, ?, '@restart', 'Restart Agent', '', '[]', 1, 0, ?, ?)`,
        args: [AGENT_ID, ORGANIZATION_ID, now, now],
      },
      {
        sql: `INSERT INTO "Room"
          ("id", "organizationId", "key", "name", "hostAgentId", "policyJson", "messageSequence", "eventSequence", "createdByUserId", "createdAt", "updatedAt")
          VALUES (?, ?, 'default', 'Restart Room', ?, ?, 1, 1, ?, ?, ?)`,
        args: [ROOM_ID, ORGANIZATION_ID, AGENT_ID, policy, USER_ID, now, now],
      },
      {
        sql: `INSERT INTO "RoomMessage"
          ("id", "organizationId", "roomId", "sequence", "actorType", "actorId", "text", "attachmentsJson", "correlationId", "createdAt")
          VALUES (?, ?, ?, 1, 'human', ?, ?, '[]', ?, ?)`,
        args: [
          MESSAGE_ID,
          ORGANIZATION_ID,
          ROOM_ID,
          USER_ID,
          message.text,
          message.correlationId,
          now,
        ],
      },
      {
        sql: `INSERT INTO "RoomMention"
          ("id", "organizationId", "roomId", "messageId", "mentionIndex", "agentId", "handle", "rangeStart", "rangeEnd", "createdAt")
          VALUES ('room-host-restart-mention', ?, ?, ?, 0, ?, '@restart', 0, 8, ?)`,
        args: [ORGANIZATION_ID, ROOM_ID, MESSAGE_ID, AGENT_ID, now],
      },
      {
        sql: `INSERT INTO "RoomAgentSession"
          ("id", "organizationId", "roomId", "agentId", "agentHandle", "agentDisplayName", "deliverySequence", "runtimeId", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, '@restart', 'Restart Agent', 1, ?, ?, ?)`,
        args: [SESSION_ID, ORGANIZATION_ID, ROOM_ID, AGENT_ID, RUNTIME_ID, now, now],
      },
      {
        sql: `INSERT INTO "RoomInboxDelivery"
          ("id", "organizationId", "roomId", "roomSessionId", "messageId", "deliverySequence", "intent", "causeJson", "attempt", "status", "availableAt", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, 1, 'respond', ?, 1, 'pending', ?, ?, ?)`,
        args: [
          DELIVERY_ID,
          ORGANIZATION_ID,
          ROOM_ID,
          SESSION_ID,
          MESSAGE_ID,
          JSON.stringify({ type: 'typed-mention', mentionIndexes: [0] }),
          now,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO "RoomEvent"
          ("id", "organizationId", "roomId", "sequence", "type", "dataJson", "createdAt")
          VALUES ('room-host-restart-accepted-event', ?, ?, 1, 'message.accepted', ?, ?)`,
        args: [
          ORGANIZATION_ID,
          ROOM_ID,
          JSON.stringify({
            message,
            deliveries: [
              {
                deliveryId: DELIVERY_ID,
                deliverySequence: 1,
                intent: 'respond',
                roomSessionId: SESSION_ID,
                targetAgentId: AGENT_ID,
              },
            ],
          }),
          now,
        ],
      },
    ],
    'write'
  );
}

async function writeHostConfig(
  configPath: string,
  workerId: string,
  responseText: string
) {
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      organizationId: ORGANIZATION_ID,
      workerId,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 100,
      leaseDurationMs: 300,
      shutdownGraceMs: 2_000,
      maxConcurrentSessions: 1,
      maxDeliveryAttempts: 3,
      retryBaseDelayMs: 25,
      retryMaxDelayMs: 250,
      runtimes: [
        {
          driver: 'stub',
          runtimeId: RUNTIME_ID,
          runtimeVersion: '1.0.0',
          responseText,
        },
      ],
    }),
    'utf8'
  );
}

function startHost(environment: NodeJS.ProcessEnv): HostProcess {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const host = Object.assign(child, { capturedStderr: '' });
  host.stderr.on('data', (chunk: Buffer | string) => {
    host.capturedStderr += String(chunk);
  });
  return host;
}

function waitForStructuredEvent(
  child: HostProcess,
  type: string
) {
  return new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => finish(new Error(
      `Timed out waiting for Room Host ${type}. stderr: ${stderr}`
    )), 10_000);
    const onStdout = (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.split('\n').some((line) => {
        try {
          return JSON.parse(line).type === type;
        } catch {
          return false;
        }
      })) finish();
    };
    const onStderr = (chunk: Buffer | string) => { stderr += String(chunk); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`Room Host exited before ${type}: ${code}/${signal}. ${stderr}`));
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);

    function finish(error?: Error) {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    }
  });
}

async function waitForDelivery(
  database: Client,
  expected: { status: string; workerId: string | null }
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    let delivery;
    try {
      delivery = await readDelivery(database);
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2));
      continue;
    }
    if (
      delivery.status === expected.status &&
      delivery.workerId === expected.workerId
    ) {
      return delivery;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(
    `Timed out waiting for delivery ${expected.status}/${expected.workerId}.`
  );
}

async function waitForReadableDelivery(database: Client) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return await readDelivery(database);
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('Persisted Room delivery remained locked after host exit.');
}

function isSqliteBusy(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes('SQLITE_BUSY') ||
      error.message.includes('database is locked'))
  );
}

async function readDelivery(database: Client) {
  const result = await database.execute({
    sql: `SELECT delivery."status", delivery."attempt",
        session."generation", session."leaseOwnerId" AS "workerId"
      FROM "RoomInboxDelivery" AS delivery
      INNER JOIN "RoomAgentSession" AS session
        ON session."id" = delivery."roomSessionId"
      WHERE delivery."id" = ?`,
    args: [DELIVERY_ID],
  });
  const row = result.rows[0];
  if (!row) throw new Error('Persisted Room delivery disappeared.');
  return {
    attempt: Number(row.attempt),
    generation: Number(row.generation),
    status: String(row.status),
    workerId: row.workerId === null ? null : String(row.workerId),
  };
}

function waitForExit(child: HostProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Timed out waiting for Room Host process exit.'));
      }, 10_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    }
  );
}
