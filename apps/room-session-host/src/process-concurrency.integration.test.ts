import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

const run = promisify(execFile);
const ENTRY = path.resolve(
  process.cwd(),
  '.vite/room-session-host/process-test-host.mjs'
);
const ORGANIZATION_ID = 'room-host-process-org';
const USER_ID = 'room-host-process-user';
const ROOM_ID = 'room-host-process-room';
const RUNTIME_ID = 'process-stub-runtime';
const HOST_TIMEOUT_MS = 15_000;

type HostProcess = ChildProcessByStdio<null, Readable, Readable> & {
  capturedStderr: string;
  capturedStdout: string;
};

type SessionSeed = {
  agentId: string;
  deliveries: Array<{ deliveryId: string; messageId: string; text: string }>;
  handle: string;
  sessionId: string;
};

const DELEGATION_COMMAND_ENV = 'DAO_ROOM_HOST_TEST_DELEGATION_COMMAND';

test('two independent hosts race one pending delivery and only one responds', async () => {
  test.setTimeout(45_000);
  const fixture = await createFixture('claim-race');
  const hosts: HostProcess[] = [];
  try {
    await seedRoom(fixture.database, [
      {
        agentId: 'claim-agent',
        deliveries: [
          {
            deliveryId: 'claim-delivery-1',
            messageId: 'claim-message-1',
            text: '@claim process exactly once',
          },
        ],
        handle: '@claim',
        sessionId: 'claim-session',
      },
    ]);
    const [configA, configB] = await Promise.all([
      fixture.writeConfig('claim-host-a', 1),
      fixture.writeConfig('claim-host-b', 1),
    ]);
    hosts.push(
      startHost(fixture.environment(configA, {
        name: 'same-pending-delivery',
        participants: 2,
        phase: 'claim',
      })),
      startHost(fixture.environment(configB, {
        name: 'same-pending-delivery',
        participants: 2,
        phase: 'claim',
      }))
    );
    await Promise.all(hosts.map((host) => waitForStructuredEvent(host, 'ready')));

    const arrivals = await waitForArrivals(
      fixture.barrierDirectory,
      'same-pending-delivery',
      2,
      () => Promise.all(hosts.map(describeHost))
    );
    expect(new Set(arrivals.map(({ pid }) => pid))).toEqual(
      new Set(hosts.map(({ pid }) => pid))
    );
    expect(
      new Set(arrivals.map(({ roomSessionId }) => roomSessionId))
    ).toEqual(new Set(['claim-session']));

    await releaseBarrier(fixture.barrierDirectory, 'same-pending-delivery');
    await waitForDeliveryStatuses(
      fixture.database,
      [['claim-delivery-1', 'completed']],
      async () => ({
        hosts: await Promise.all(hosts.map(describeHost)),
        state: await readRoomState(fixture.database),
      })
    );

    const state = await readRoomState(fixture.database);
    expect(state.deliveries).toEqual([
      expect.objectContaining({
        attempt: 1,
        deliveryId: 'claim-delivery-1',
        status: 'completed',
      }),
    ]);
    expect(state.sessions).toEqual([
      expect.objectContaining({
        generation: 1,
        leaseOwnerId: null,
        sessionId: 'claim-session',
      }),
    ]);
    expect(state.agentMessages).toEqual([
      expect.objectContaining({
        actorId: 'claim-agent',
        text: 'response-claim-race',
      }),
    ]);
    expect(state.terminalEvents).toEqual([
      expect.objectContaining({ deliveryId: 'claim-delivery-1' }),
    ]);
  } finally {
    try {
      await stopHosts(hosts);
    } finally {
      await fixture.dispose();
    }
  }
});

test('two hosts consume one durable delegation once and a crashed source replays without redelivery', async () => {
  test.setTimeout(60_000);
  const fixture = await createFixture('durable-delegation');
  const hosts: HostProcess[] = [];
  const sourceDeliveryId = 'delegation-source-delivery';
  const invocationId = 'delegation-process-invocation';
  const instruction = 'Verify the durable delegation exactly once.';
  const sourceAgentId = 'delegation-source-agent';
  const targetAgentId = 'delegation-target-agent';
  try {
    await seedRoom(fixture.database, [
      {
        agentId: sourceAgentId,
        deliveries: [
          {
            deliveryId: sourceDeliveryId,
            messageId: 'delegation-root-message',
            text: '@delegator hand this off exactly once',
          },
        ],
        handle: '@delegator',
        sessionId: 'delegation-source-session',
      },
      {
        agentId: targetAgentId,
        deliveries: [],
        handle: '@delegate',
        sessionId: 'delegation-target-session',
      },
    ]);
    await seedOnceDelegationGrant(fixture.database, {
      fromAgentId: sourceAgentId,
      grantId: 'delegation-once-grant',
      rootMessageId: 'delegation-root-message',
      targetAgentId,
    });
    const [configA, configB] = await Promise.all([
      fixture.writeConfig('delegation-host-a', 1),
      fixture.writeConfig('delegation-host-b', 1),
    ]);
    const delegationCommand = {
      afterConsumeBarrierName: 'delegation-committed',
      instruction,
      invocationId,
      sourceDeliveryId,
      targetAgentId,
      userId: USER_ID,
    };
    hosts.push(
      startHost({
        ...fixture.environment(configA, {
          name: 'delegation-source-race',
          participants: 2,
          phase: 'claim',
        }),
        [DELEGATION_COMMAND_ENV]: JSON.stringify(delegationCommand),
        DAO_ROOM_HOST_TEST_ONLY_SESSION_ID: 'delegation-source-session',
      }),
      startHost({
        ...fixture.environment(configB, {
          name: 'delegation-source-race',
          participants: 2,
          phase: 'claim',
        }),
        [DELEGATION_COMMAND_ENV]: JSON.stringify(delegationCommand),
        DAO_ROOM_HOST_TEST_ONLY_SESSION_ID: 'delegation-source-session',
      })
    );
    await Promise.all(hosts.map((host) => waitForStructuredEvent(host, 'ready')));

    const racers = await waitForArrivals(
      fixture.barrierDirectory,
      'delegation-source-race',
      2,
      () => Promise.all(hosts.map(describeHost))
    );
    expect(new Set(racers.map(({ pid }) => pid))).toEqual(
      new Set(hosts.map(({ pid }) => pid))
    );
    expect(new Set(racers.map(({ roomSessionId }) => roomSessionId))).toEqual(
      new Set(['delegation-source-session'])
    );
    await releaseBarrier(fixture.barrierDirectory, 'delegation-source-race');

    const [committed] = await waitForArrivals(
      fixture.barrierDirectory,
      'delegation-committed',
      1,
      async () => ({
        hosts: await Promise.all(hosts.map(describeHost)),
        state: await readDelegationState(fixture.database, invocationId),
      })
    );
    expect(committed).toMatchObject({
      delegationStatus: 'accepted',
      invocationId,
      roomSessionId: 'delegation-source-session',
    });
    const targetDeliveryId = requiredArrivalText(
      committed.targetDeliveryId,
      'targetDeliveryId'
    );
    const sourceHost = hosts.find(({ pid }) => pid === committed.pid);
    const losingHost = hosts.find(({ pid }) => pid !== committed.pid);
    expect(sourceHost).toBeTruthy();
    expect(losingHost).toBeTruthy();
    if (!sourceHost || !losingHost) throw new Error('Expected two live Host processes.');

    sourceHost.kill('SIGKILL');
    expect(await waitForExit(sourceHost, 3_000)).toBe(true);
    losingHost.kill('SIGTERM');
    expect(await waitForExit(losingHost, 3_000)).toBe(true);
    expect(losingHost.exitCode).toBe(0);

    await assertDelegationExactlyOnce(fixture.database, {
      instruction,
      invocationId,
      sourceDeliveryId,
      targetAgentId,
      targetDeliveryId,
    });

    const restartConfig = await fixture.writeConfig('delegation-host-restarted', 1);
    const restartInvocationId = `${invocationId}-after-restart`;
    const restarted = startHost({
      ...fixture.environmentWithoutBarrier(restartConfig),
      DAO_ROOM_HOST_TEST_BARRIER_DIRECTORY: fixture.barrierDirectory,
      DAO_ROOM_HOST_TEST_ONLY_SESSION_ID: 'delegation-source-session',
      [DELEGATION_COMMAND_ENV]: JSON.stringify({
        ...delegationCommand,
        afterConsumeBarrierName: 'delegation-replayed',
        beforeConsumeBarrierName: 'delegation-restart-claimed',
        invocationId: restartInvocationId,
      }),
    });
    hosts.push(restarted);
    await waitForStructuredEvent(restarted, 'ready');
    await waitForArrivals(
      fixture.barrierDirectory,
      'delegation-restart-claimed',
      1,
      async () => ({
        restarted: await describeHost(restarted),
        state: await readRoomState(fixture.database),
      })
    );
    const replayInFlight = await readRoomState(fixture.database);
    expect(replayInFlight.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attempt: 2,
          deliveryId: sourceDeliveryId,
          status: 'claimed',
        }),
        expect.objectContaining({
          attempt: 1,
          deliveryId: targetDeliveryId,
          status: 'pending',
        }),
      ])
    );
    await releaseBarrier(
      fixture.barrierDirectory,
      'delegation-restart-claimed'
    );
    const [replayed] = await waitForArrivals(
      fixture.barrierDirectory,
      'delegation-replayed',
      1,
      async () => ({
        restarted: await describeHost(restarted),
        state: await readDelegationState(fixture.database, invocationId),
      })
    );
    expect(replayed).toMatchObject({
      delegationStatus: 'blocked',
      failureCode: 'duplicate-delegation',
      invocationId: restartInvocationId,
      pid: restarted.pid,
    });
    await assertDelegationExactlyOnce(fixture.database, {
      instruction,
      invocationId,
      sourceDeliveryId,
      targetAgentId,
      targetDeliveryId,
    });
    const restartState = await readDelegationState(
      fixture.database,
      restartInvocationId
    );
    expect(restartState.invocations).toEqual([
      expect.objectContaining({
        failureCode: 'duplicate-delegation',
        invocationId: restartInvocationId,
        status: 'blocked',
        targetDeliveryId: null,
      }),
    ]);
    await releaseBarrier(fixture.barrierDirectory, 'delegation-replayed');
    await waitForDeliveryStatuses(
      fixture.database,
      [[sourceDeliveryId, 'completed']],
      async () => ({
        restarted: await describeHost(restarted),
        state: await readRoomState(fixture.database),
      })
    );
    await assertDelegationExactlyOnce(fixture.database, {
      instruction,
      invocationId,
      sourceDeliveryId,
      targetAgentId,
      targetDeliveryId,
    });

    const completed = await readRoomState(fixture.database);
    expect(completed.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: 2,
          leaseOwnerId: null,
          sessionId: 'delegation-source-session',
        }),
        expect.objectContaining({
          generation: 1,
          leaseOwnerId: null,
          sessionId: 'delegation-target-session',
        }),
      ])
    );
  } finally {
    try {
      await stopHosts(hosts);
    } finally {
      await fixture.dispose();
    }
  }
});

test('different Agent sessions run in parallel across real hosts while each remains FIFO', async () => {
  test.setTimeout(45_000);
  const fixture = await createFixture('parallel-fifo');
  const hosts: HostProcess[] = [];
  try {
    await seedRoom(fixture.database, [
      {
        agentId: 'agent-a',
        deliveries: [
          {
            deliveryId: 'session-a-delivery-1',
            messageId: 'session-a-message-1',
            text: '@agent-a first',
          },
          {
            deliveryId: 'session-a-delivery-2',
            messageId: 'session-a-message-2',
            text: '@agent-a second',
          },
        ],
        handle: '@agent-a',
        sessionId: 'session-a',
      },
      {
        agentId: 'agent-b',
        deliveries: [
          {
            deliveryId: 'session-b-delivery-1',
            messageId: 'session-b-message-1',
            text: '@agent-b first',
          },
          {
            deliveryId: 'session-b-delivery-2',
            messageId: 'session-b-message-2',
            text: '@agent-b second',
          },
        ],
        handle: '@agent-b',
        sessionId: 'session-b',
      },
    ]);
    const [configA, configB] = await Promise.all([
      fixture.writeConfig('parallel-host-a', 1),
      fixture.writeConfig('parallel-host-b', 1),
    ]);
    hosts.push(
      startHost(fixture.environment(configA, {
        name: 'first-deliveries',
        participants: 2,
        phase: 'handle',
      })),
      startHost(fixture.environment(configB, {
        name: 'first-deliveries',
        participants: 2,
        phase: 'handle',
      }))
    );
    await Promise.all(hosts.map((host) => waitForStructuredEvent(host, 'ready')));

    const arrivals = await waitForArrivals(
      fixture.barrierDirectory,
      'first-deliveries',
      2,
      async () => ({
        hosts: await Promise.all(hosts.map(describeHost)),
        state: await readRoomState(fixture.database),
      })
    );
    expect(new Set(arrivals.map(({ pid }) => pid))).toEqual(
      new Set(hosts.map(({ pid }) => pid))
    );
    expect(new Set(arrivals.map(({ roomSessionId }) => roomSessionId))).toEqual(
      new Set(['session-a', 'session-b'])
    );
    expect(new Set(arrivals.map(({ deliverySequence }) => deliverySequence))).toEqual(
      new Set([1])
    );

    const inFlight = await readRoomState(fixture.database);
    expect(inFlight.deliveries).toEqual([
      expect.objectContaining({ deliveryId: 'session-a-delivery-1', status: 'claimed' }),
      expect.objectContaining({ deliveryId: 'session-a-delivery-2', status: 'pending' }),
      expect.objectContaining({ deliveryId: 'session-b-delivery-1', status: 'claimed' }),
      expect.objectContaining({ deliveryId: 'session-b-delivery-2', status: 'pending' }),
    ]);
    expect(inFlight.agentMessages).toEqual([]);

    const [firstArrival, secondArrival] = [...arrivals].sort(
      (left, right) => left.roomSessionId.localeCompare(right.roomSessionId)
    );
    await releaseParticipant(
      fixture.barrierDirectory,
      'first-deliveries',
      firstArrival.participantId
    );
    await waitForSessionDeliveryStatuses(
      fixture.database,
      firstArrival.roomSessionId,
      ['completed', 'completed'],
      async () => ({
        hosts: await Promise.all(hosts.map(describeHost)),
        state: await readRoomState(fixture.database),
      })
    );
    const otherStillInFlight = await readRoomState(fixture.database);
    expect(
      otherStillInFlight.deliveries
        .filter(({ roomSessionId }) => roomSessionId === secondArrival.roomSessionId)
        .map(({ status }) => status)
    ).toEqual(['claimed', 'pending']);

    await releaseParticipant(
      fixture.barrierDirectory,
      'first-deliveries',
      secondArrival.participantId
    );
    await waitForDeliveryStatuses(
      fixture.database,
      [
        ['session-a-delivery-1', 'completed'],
        ['session-a-delivery-2', 'completed'],
        ['session-b-delivery-1', 'completed'],
        ['session-b-delivery-2', 'completed'],
      ],
      async () => ({
        hosts: await Promise.all(hosts.map(describeHost)),
        state: await readRoomState(fixture.database),
      })
    );

    const completed = await readRoomState(fixture.database);
    expect(completed.agentMessages).toHaveLength(4);
    for (const agentId of ['agent-a', 'agent-b']) {
      const deliverySequences = completed.terminalEvents
        .filter((event) => event.agentId === agentId)
        .map((event) => event.deliverySequence);
      expect(deliverySequences).toEqual([1, 2]);
    }
    expect(
      completed.sessions.map(({ generation, sessionId }) => ({
        generation,
        sessionId,
      }))
    ).toEqual([
      { generation: 2, sessionId: 'session-a' },
      { generation: 2, sessionId: 'session-b' },
    ]);
  } finally {
    try {
      await stopHosts(hosts);
    } finally {
      await fixture.dispose();
    }
  }
});

async function createFixture(name: string) {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), `tobe-room-host-${name}-`)
  );
  const databasePath = path.join(temporaryRoot, 'dev.db');
  const barrierDirectory = path.join(temporaryRoot, 'barriers');
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DAO_APP_DATA_ROOT: temporaryRoot,
    DATABASE_URL: `file:${databasePath}`,
    NODE_ENV: 'test',
  };
  await run(
    process.execPath,
    ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
    { cwd: process.cwd(), env: baseEnvironment }
  );
  const database = createClient({ url: `file:${databasePath}` });
  await database.execute('PRAGMA journal_mode = WAL');

  return {
    barrierDirectory,
    database,
    async dispose() {
      await database.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    },
    environment(
      configPath: string,
      barrier: { name: string; participants: number; phase: 'claim' | 'handle' }
    ) {
      return {
        ...baseEnvironment,
        DAO_ROOM_SESSION_HOST_CONFIG_PATH: configPath,
        DAO_ROOM_HOST_TEST_BARRIER_DIRECTORY: barrierDirectory,
        DAO_ROOM_HOST_TEST_BARRIER_NAME: barrier.name,
        DAO_ROOM_HOST_TEST_BARRIER_PARTICIPANTS: String(barrier.participants),
        DAO_ROOM_HOST_TEST_BARRIER_PHASE: barrier.phase,
      };
    },
    environmentWithoutBarrier(configPath: string) {
      return {
        ...baseEnvironment,
        DAO_ROOM_SESSION_HOST_CONFIG_PATH: configPath,
      };
    },
    async writeConfig(workerId: string, maxConcurrentSessions: number) {
      const configPath = path.join(temporaryRoot, `${workerId}.json`);
      await writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          organizationId: ORGANIZATION_ID,
          workerId,
          pollIntervalMs: 5,
          heartbeatIntervalMs: 200,
          leaseDurationMs: 3_000,
          shutdownGraceMs: 2_000,
          maxConcurrentSessions,
          maxDeliveryAttempts: 3,
          retryBaseDelayMs: 25,
          retryMaxDelayMs: 250,
          runtimes: [
            {
              driver: 'stub',
              runtimeId: RUNTIME_ID,
              runtimeVersion: '1.0.0',
              responseText: `response-${name}`,
            },
          ],
        }),
        'utf8'
      );
      return configPath;
    },
  };
}

async function seedRoom(database: Client, sessions: SessionSeed[]) {
  const now = new Date().toISOString();
  const policy = JSON.stringify({
    schemaVersion: 1,
    participation: {
      mode: 'quiet-host',
      hostAgentId: sessions[0].agentId,
      unmentionedHostAction: 'observe',
    },
    delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
  });
  const messageCount = sessions.reduce(
    (total, session) => total + session.deliveries.length,
    0
  );
  await database.batch(
    [
      {
        sql: `INSERT INTO "Organization"
          ("id", "slug", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?)`,
        args: [ORGANIZATION_ID, ORGANIZATION_ID, 'Process Test Org', now, now],
      },
      {
        sql: `INSERT INTO "User" ("id", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?)`,
        args: [USER_ID, 'Process Test User', now, now],
      },
      {
        sql: `INSERT INTO "OrganizationMembership"
          ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
          VALUES (?, ?, ?, 'owner', ?, ?)`,
        args: ['process-membership', ORGANIZATION_ID, USER_ID, now, now],
      },
      ...sessions.map((session) => ({
        sql: `INSERT INTO "AgentProfile"
          ("id", "organizationId", "handle", "name", "description", "skillsJson", "configJson", "enabled", "builtin", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, '', '[]', ?, 1, 0, ?, ?)`,
        args: [
          session.agentId,
          ORGANIZATION_ID,
          session.handle,
          `Process ${session.agentId}`,
          JSON.stringify({
            schemaVersion: 1,
            room: { configVersion: 1, runtimeId: RUNTIME_ID },
          }),
          now,
          now,
        ],
      })),
      {
        sql: `INSERT INTO "Room"
          ("id", "organizationId", "key", "name", "hostAgentId", "policyJson", "messageSequence", "eventSequence", "createdByUserId", "createdAt", "updatedAt")
          VALUES (?, ?, 'default', 'Process Room', ?, ?, ?, 0, ?, ?, ?)`,
        args: [
          ROOM_ID,
          ORGANIZATION_ID,
          sessions[0].agentId,
          policy,
          messageCount,
          USER_ID,
          now,
          now,
        ],
      },
      ...sessions.flatMap((session) =>
        session.deliveries.flatMap((delivery, index) => {
          const messageSequence = messageSequenceFor(sessions, session, index);
          return [
            {
              sql: `INSERT INTO "RoomMessage"
                ("id", "organizationId", "roomId", "sequence", "actorType", "actorId", "text", "attachmentsJson", "correlationId", "createdAt")
                VALUES (?, ?, ?, ?, 'human', ?, ?, '[]', ?, ?)`,
              args: [
                delivery.messageId,
                ORGANIZATION_ID,
                ROOM_ID,
                messageSequence,
                USER_ID,
                delivery.text,
                `${delivery.messageId}-correlation`,
                now,
              ],
            },
            {
              sql: `INSERT INTO "RoomMention"
                ("id", "organizationId", "roomId", "messageId", "mentionIndex", "agentId", "handle", "rangeStart", "rangeEnd", "createdAt")
                VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`,
              args: [
                `${delivery.messageId}-mention`,
                ORGANIZATION_ID,
                ROOM_ID,
                delivery.messageId,
                session.agentId,
                session.handle,
                session.handle.length,
                now,
              ],
            },
          ];
        })
      ),
      ...sessions.map((session) => ({
        sql: `INSERT INTO "RoomAgentSession"
          ("id", "organizationId", "roomId", "agentId", "agentHandle", "agentDisplayName", "deliverySequence", "runtimeId", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          session.sessionId,
          ORGANIZATION_ID,
          ROOM_ID,
          session.agentId,
          session.handle,
          `Process ${session.agentId}`,
          session.deliveries.length,
          RUNTIME_ID,
          now,
          now,
        ],
      })),
      ...sessions.flatMap((session) =>
        session.deliveries.map((delivery, index) => ({
          sql: `INSERT INTO "RoomInboxDelivery"
            ("id", "organizationId", "roomId", "roomSessionId", "messageId", "deliverySequence", "intent", "causeJson", "attempt", "status", "availableAt", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?, ?, 'respond', ?, 1, 'pending', ?, ?, ?)`,
          args: [
            delivery.deliveryId,
            ORGANIZATION_ID,
            ROOM_ID,
            session.sessionId,
            delivery.messageId,
            index + 1,
            JSON.stringify({ type: 'typed-mention', mentionIndexes: [0] }),
            now,
            now,
            now,
          ],
        }))
      ),
    ],
    'write'
  );
}

async function seedOnceDelegationGrant(
  database: Client,
  input: {
    fromAgentId: string;
    grantId: string;
    rootMessageId: string;
    targetAgentId: string;
  }
) {
  const now = new Date();
  await database.execute({
    sql: `INSERT INTO "RoomDelegationGrant"
      ("id", "organizationId", "roomId", "issuedByUserId", "fromAgentId", "targetAgentId", "scope", "status", "rootMessageId", "expiresAt", "hopLimit", "invocationLimit", "invocationCount", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, 'once', 'active', ?, ?, 3, 1, 0, ?, ?)`,
    args: [
      input.grantId,
      ORGANIZATION_ID,
      ROOM_ID,
      USER_ID,
      input.fromAgentId,
      input.targetAgentId,
      input.rootMessageId,
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    ],
  });
}

function messageSequenceFor(
  sessions: SessionSeed[],
  selected: SessionSeed,
  deliveryIndex: number
) {
  let sequence = deliveryIndex + 1;
  for (const session of sessions) {
    if (session === selected) return sequence;
    sequence += session.deliveries.length;
  }
  throw new Error('Unknown seeded session.');
}

function startHost(environment: NodeJS.ProcessEnv): HostProcess {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const host = Object.assign(child, { capturedStderr: '', capturedStdout: '' });
  child.stdout.on('data', (chunk: Buffer | string) => {
    host.capturedStdout += String(chunk);
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    host.capturedStderr += String(chunk);
  });
  return host;
}

async function waitForArrivals(
  directory: string,
  barrierName: string,
  expected: number,
  diagnostics?: () => Promise<unknown>
) {
  return pollUntil(async () => {
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const matching = files.filter(
      (file) =>
        file.startsWith(`${barrierName}.arrived.`) && file.endsWith('.json')
    );
    if (matching.length !== expected) return null;
    return Promise.all(
      matching.map(async (file) =>
        JSON.parse(await readFile(path.join(directory, file), 'utf8')) as {
          delegationStatus?: string;
          deliverySequence?: number;
          deliveryId?: string;
          failureCode?: string;
          invocationId?: string;
          participantId: string;
          pid: number;
          roomSessionId: string;
          targetDeliveryId?: string;
        }
      )
    );
  }, `waiting for ${expected} arrivals at ${barrierName}`, diagnostics);
}

async function releaseBarrier(directory: string, barrierName: string) {
  await writeFile(path.join(directory, `${barrierName}.release`), '', 'utf8');
}

async function releaseParticipant(
  directory: string,
  barrierName: string,
  participantId: string
) {
  await writeFile(
    path.join(
      directory,
      `${barrierName}.release.${safeFileSegment(participantId)}`
    ),
    '',
    'utf8'
  );
}

async function waitForSessionDeliveryStatuses(
  database: Client,
  roomSessionId: string,
  expected: string[],
  diagnostics?: () => Promise<unknown>
) {
  return pollUntil(async () => {
    const state = await readRoomState(database);
    const statuses = state.deliveries
      .filter((delivery) => delivery.roomSessionId === roomSessionId)
      .map(({ status }) => status);
    return JSON.stringify(statuses) === JSON.stringify(expected) ? state : null;
  }, `waiting for ${roomSessionId} delivery states ${JSON.stringify(expected)}`, diagnostics);
}

async function waitForDeliveryStatuses(
  database: Client,
  expected: Array<[deliveryId: string, status: string]>,
  diagnostics?: () => Promise<unknown>
) {
  return pollUntil(async () => {
    const state = await readRoomState(database);
    return expected.every(([deliveryId, status]) =>
      state.deliveries.some(
        (delivery) =>
          delivery.deliveryId === deliveryId && delivery.status === status
      )
    )
      ? state
      : null;
  }, `waiting for delivery states ${JSON.stringify(expected)}`, diagnostics);
}

async function readRoomState(database: Client) {
  const [deliveries, sessions, messages, terminalEvents] = await Promise.all([
    database.execute({
      sql: `SELECT "id", "roomSessionId", "deliverySequence", "attempt", "status"
        FROM "RoomInboxDelivery" WHERE "roomId" = ?
        ORDER BY "roomSessionId", "deliverySequence"`,
      args: [ROOM_ID],
    }),
    database.execute({
      sql: `SELECT "id", "generation", "leaseOwnerId"
        FROM "RoomAgentSession" WHERE "roomId" = ? ORDER BY "id"`,
      args: [ROOM_ID],
    }),
    database.execute({
      sql: `SELECT "actorId", "sequence", "text" FROM "RoomMessage"
        WHERE "roomId" = ? AND "actorType" = 'agent' ORDER BY "sequence"`,
      args: [ROOM_ID],
    }),
    database.execute({
      sql: `SELECT event."dataJson", delivery."deliverySequence", session."agentId"
        FROM "RoomEvent" AS event
        INNER JOIN "RoomInboxDelivery" AS delivery
          ON json_extract(event."dataJson", '$.deliveryId') = delivery."id"
        INNER JOIN "RoomAgentSession" AS session
          ON delivery."roomSessionId" = session."id"
        WHERE event."roomId" = ? AND event."type" = 'room.delivery.completed'
        ORDER BY event."sequence"`,
      args: [ROOM_ID],
    }),
  ]);
  return {
    deliveries: deliveries.rows.map((row) => ({
      attempt: Number(row.attempt),
      deliveryId: String(row.id),
      deliverySequence: Number(row.deliverySequence),
      roomSessionId: String(row.roomSessionId),
      status: String(row.status),
    })),
    sessions: sessions.rows.map((row) => ({
      generation: Number(row.generation),
      leaseOwnerId: row.leaseOwnerId === null ? null : String(row.leaseOwnerId),
      sessionId: String(row.id),
    })),
    agentMessages: messages.rows.map((row) => ({
      actorId: String(row.actorId),
      sequence: Number(row.sequence),
      text: String(row.text),
    })),
    terminalEvents: terminalEvents.rows.map((row) => {
      const data = JSON.parse(String(row.dataJson)) as { deliveryId: string };
      return {
        agentId: String(row.agentId),
        deliveryId: data.deliveryId,
        deliverySequence: Number(row.deliverySequence),
      };
    }),
  };
}

async function assertDelegationExactlyOnce(
  database: Client,
  input: {
    instruction: string;
    invocationId: string;
    sourceDeliveryId: string;
    targetAgentId: string;
    targetDeliveryId: string;
  }
) {
  const state = await readDelegationState(database, input.invocationId);
  expect(state.grants).toEqual([
    expect.objectContaining({
      consumedByInvocationId: input.invocationId,
      invocationCount: 1,
      status: 'consumed',
    }),
  ]);
  expect(state.rootBudgets).toEqual([
    expect.objectContaining({ invocationCount: 1 }),
  ]);
  expect(state.invocations).toEqual([
    expect.objectContaining({
      invocationId: input.invocationId,
      sourceDeliveryId: input.sourceDeliveryId,
      status: 'accepted',
      targetAgentId: input.targetAgentId,
      targetDeliveryId: input.targetDeliveryId,
    }),
  ]);
  expect(state.instructionMessages).toEqual([
    expect.objectContaining({
      actorId: 'delegation-source-agent',
      correlationId: input.invocationId,
      text: input.instruction,
    }),
  ]);
  expect(state.targetDeliveries).toEqual([
    expect.objectContaining({
      attempt: 1,
      deliveryId: input.targetDeliveryId,
      status: 'pending',
    }),
  ]);
  expect(state.targetResponses).toEqual([]);
  expect(state.acceptedEvents).toEqual([
    expect.objectContaining({ invocationId: input.invocationId }),
  ]);
  expect(state.targetTerminalEvents).toEqual([]);
  expect(state.acceptedOutboxCount).toBe(1);
}

async function readDelegationState(database: Client, invocationId: string) {
  const [
    grants,
    rootBudgets,
    invocations,
    instructionMessages,
    targetDeliveries,
    targetResponses,
    acceptedEvents,
    targetTerminalEvents,
    acceptedOutbox,
    sessionDiagnostics,
  ] = await Promise.all([
    database.execute({
      sql: `SELECT "status", "consumedByInvocationId", "invocationCount"
        FROM "RoomDelegationGrant" WHERE "roomId" = ?
        ORDER BY "createdAt", "id"`,
      args: [ROOM_ID],
    }),
    database.execute({
      sql: `SELECT "rootMessageId", "invocationCount"
        FROM "RoomDelegationRootBudget" WHERE "roomId" = ?
        ORDER BY "rootMessageId"`,
      args: [ROOM_ID],
    }),
    database.execute({
      sql: `SELECT "invocationId", "status", "failureCode", "sourceDeliveryId", "targetAgentId", "targetDeliveryId"
        FROM "RoomDelegationInvocation"
        WHERE "roomId" = ? AND "invocationId" = ?`,
      args: [ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT "actorId", "correlationId", "text" FROM "RoomMessage"
        WHERE "roomId" = ? AND "correlationId" = ?
        ORDER BY "sequence"`,
      args: [ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT delivery."id", delivery."attempt", delivery."status"
        FROM "RoomInboxDelivery" AS delivery
        INNER JOIN "RoomDelegationInvocation" AS invocation
          ON invocation."targetDeliveryId" = delivery."id"
        WHERE invocation."roomId" = ? AND invocation."invocationId" = ?`,
      args: [ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT "actorId", "correlationId", "text" FROM "RoomMessage"
        WHERE "roomId" = ? AND "correlationId" = (
          SELECT "targetDeliveryId" FROM "RoomDelegationInvocation"
          WHERE "roomId" = ? AND "invocationId" = ?
        ) ORDER BY "sequence"`,
      args: [ROOM_ID, ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT event."id", invocation."invocationId"
        FROM "RoomEvent" AS event
        INNER JOIN "RoomDelegationInvocation" AS invocation
          ON invocation."acceptedEventId" = event."id"
        WHERE invocation."roomId" = ? AND invocation."invocationId" = ?
          AND event."type" = 'delegation.accepted'`,
      args: [ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT json_extract(event."dataJson", '$.deliveryId') AS "deliveryId"
        FROM "RoomEvent" AS event
        WHERE event."roomId" = ?
          AND event."type" = 'room.delivery.completed'
          AND json_extract(event."dataJson", '$.deliveryId') = (
            SELECT "targetDeliveryId" FROM "RoomDelegationInvocation"
            WHERE "roomId" = ? AND "invocationId" = ?
          )`,
      args: [ROOM_ID, ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT outbox."id" FROM "RoomOutbox" AS outbox
        INNER JOIN "RoomDelegationInvocation" AS invocation
          ON invocation."acceptedEventId" = outbox."dedupeKey"
        WHERE invocation."roomId" = ? AND invocation."invocationId" = ?`,
      args: [ROOM_ID, invocationId],
    }),
    database.execute({
      sql: `SELECT "id", "runtimeId", "currentDeliveryId", "leaseOwnerId", "leaseExpiresAt", "status"
        FROM "RoomAgentSession" WHERE "roomId" = ? ORDER BY "id"`,
      args: [ROOM_ID],
    }),
  ]);
  return {
    grants: grants.rows.map((row) => ({
      consumedByInvocationId:
        row.consumedByInvocationId === null
          ? null
          : String(row.consumedByInvocationId),
      invocationCount: Number(row.invocationCount),
      status: String(row.status),
    })),
    rootBudgets: rootBudgets.rows.map((row) => ({
      invocationCount: Number(row.invocationCount),
      rootMessageId: String(row.rootMessageId),
    })),
    invocations: invocations.rows.map((row) => ({
      failureCode: row.failureCode === null ? null : String(row.failureCode),
      invocationId: String(row.invocationId),
      sourceDeliveryId: String(row.sourceDeliveryId),
      status: String(row.status),
      targetAgentId: String(row.targetAgentId),
      targetDeliveryId:
        row.targetDeliveryId === null ? null : String(row.targetDeliveryId),
    })),
    instructionMessages: instructionMessages.rows.map((row) => ({
      actorId: String(row.actorId),
      correlationId: String(row.correlationId),
      text: String(row.text),
    })),
    targetDeliveries: targetDeliveries.rows.map((row) => ({
      attempt: Number(row.attempt),
      deliveryId: String(row.id),
      status: String(row.status),
    })),
    targetResponses: targetResponses.rows.map((row) => ({
      actorId: String(row.actorId),
      correlationId: String(row.correlationId),
      text: String(row.text),
    })),
    acceptedEvents: acceptedEvents.rows.map((row) => ({
      eventId: String(row.id),
      invocationId: String(row.invocationId),
    })),
    targetTerminalEvents: targetTerminalEvents.rows.map((row) => ({
      deliveryId: String(row.deliveryId),
    })),
    acceptedOutboxCount: acceptedOutbox.rows.length,
    sessionDiagnostics: sessionDiagnostics.rows.map((row) => ({
      currentDeliveryId: row.currentDeliveryId,
      id: row.id,
      leaseExpiresAt: row.leaseExpiresAt,
      leaseOwnerId: row.leaseOwnerId,
      runtimeId: row.runtimeId,
      status: row.status,
    })),
  };
}

async function pollUntil<T>(
  operation: () => Promise<T | null>,
  description: string,
  diagnostics?: () => Promise<unknown>
): Promise<T> {
  const deadline = Date.now() + HOST_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
      if (!isSqliteBusy(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const details = diagnostics ? await diagnostics().catch(() => null) : null;
  throw new Error(
    `Timed out ${description}.${lastError ? ` Last error: ${String(lastError)}` : ''}${details ? ` Diagnostics: ${JSON.stringify(details)}` : ''}`
  );
}

function waitForStructuredEvent(child: HostProcess, type: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for ${type}.${diagnostics(child)}`)),
      HOST_TIMEOUT_MS
    );
    const onStdout = () => {
      if (
        child.capturedStdout.split('\n').some((line) => {
          try {
            return JSON.parse(line).type === type;
          } catch {
            return false;
          }
        })
      ) {
        finish();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(
          `Room Host exited before ${type}: ${code}/${signal}.${diagnostics(child)}`
        )
      );
    child.stdout.on('data', onStdout);
    child.once('exit', onExit);

    function finish(error?: Error) {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    }
  });
}

async function stopHosts(hosts: HostProcess[]) {
  const results = await Promise.allSettled(
    hosts.map(async (host) => {
      if (host.exitCode !== null || host.signalCode !== null) return;
      host.kill('SIGTERM');
      if (await waitForExit(host, 3_000)) return;
      host.kill('SIGKILL');
      if (!(await waitForExit(host, 3_000))) {
        throw new Error(`Room Host process did not exit.${diagnostics(host)}`);
      }
    })
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) throw failure.reason;
}

function waitForExit(child: HostProcess, timeoutMs: number) {
  return new Promise<boolean>(
    (resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(true);
        return;
      }
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const onError = (error: Error) => {
        cleanup();
        clearTimeout(timeout);
        reject(error);
      };
      const onClose = () => {
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('error', onError);
        child.off('close', onClose);
      };
      child.once('error', onError);
      child.once('close', onClose);
    }
  );
}

function diagnostics(child: HostProcess) {
  return ` stdout=${JSON.stringify(child.capturedStdout)} stderr=${JSON.stringify(child.capturedStderr)}`;
}

async function describeHost(host: HostProcess) {
  return {
    exitCode: host.exitCode,
    pid: host.pid,
    signalCode: host.signalCode,
    stderr: host.capturedStderr,
    stdout: host.capturedStdout,
  };
}

function isSqliteBusy(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes('SQLITE_BUSY') ||
      error.message.includes('database is locked'))
  );
}

function safeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function requiredArrivalText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Barrier arrival did not include ${field}.`);
  }
  return value;
}
