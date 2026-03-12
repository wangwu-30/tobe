import path from 'node:path';
import process from 'node:process';
import { getPrismaClient, getPrismaRuntimeInfo } from '@/lib/db/prisma';
import { getPlatformStatus } from '@/lib/platform/runtime';
import { invokeDesktopApiRoute } from './api-router';
import { bootstrapDesktopDatabase } from './bootstrap';
import { appendJsonLog } from '../shared/diagnostics-node';
import type { DesktopApiRequest } from '../shared/bridge';

type BackendInitializeMessage = {
  appDataRoot: string;
  appPath: string;
  appVersion: string;
  channel: string;
  deviceId: string;
  organizationId: string;
  userId: string;
};

type ParentPortLike = {
  on: (event: 'message', listener: (message: unknown) => void) => void;
  postMessage: (message: unknown) => void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;

if (!parentPort) {
  throw new Error('Desktop backend must be launched as an Electron utility process.');
}

let runtime: BackendInitializeMessage | null = null;

process.on('uncaughtException', (error) => {
  void log('error', 'backend.uncaughtException', { message: error.message, stack: error.stack });
  parentPort.postMessage({
    message: error.message,
    stack: error.stack || null,
    type: 'backend-error',
  });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack || null : null;
  void log('error', 'backend.unhandledRejection', { message, stack });
  parentPort.postMessage({
    message,
    stack,
    type: 'backend-error',
  });
});

parentPort.on('message', async (message) => {
  const payload = (
    message && typeof message === 'object' && 'data' in message
      ? (message as { data: unknown }).data
      : message
  ) as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type : '';

  try {
    if (type === 'backend.initialize') {
      runtime = payload.payload as BackendInitializeMessage;
      const bootstrapDatabaseUrl = `file:${path.join(runtime.appDataRoot, 'dev.db')}`;
      process.env.DAO_APP_DATA_ROOT = runtime.appDataRoot;
      process.env.DAO_DEVICE_ID = runtime.deviceId;
      process.env.DAO_ORGANIZATION_ID = runtime.organizationId;
      process.env.DAO_PLATFORM = 'desktop';
      process.env.DAO_USER_ID = runtime.userId;
      process.env.DATABASE_URL = bootstrapDatabaseUrl;

      await bootstrapDesktopDatabase({
        appDataRoot: runtime.appDataRoot,
        appPath: runtime.appPath,
        log: async (event, context) => {
          await log('info', event, context);
        },
      });

      const prismaRuntime = getPrismaRuntimeInfo();
      await log('info', 'backend.database.binding', {
        appDataRoot: runtime.appDataRoot,
        bootstrapDatabaseUrl,
        prismaDatabaseUrl: prismaRuntime.databaseUrl,
      });

      if (prismaRuntime.databaseUrl !== bootstrapDatabaseUrl) {
        throw new Error(
          `Desktop backend database binding mismatch: bootstrap=${bootstrapDatabaseUrl} prisma=${prismaRuntime.databaseUrl}`
        );
      }

      await getPrismaClient().$queryRaw`SELECT 1`;

      await log('info', 'backend.initialized', {
        appDataRoot: runtime.appDataRoot,
        bootstrapDatabaseUrl,
        prismaDatabaseUrl: prismaRuntime.databaseUrl,
      });
      parentPort.postMessage({
        requestId: String(payload.requestId || ''),
        type: 'backend.initialized',
      });
      return;
    }

    ensureRuntime();

    if (type === 'route.stream') {
      await handleRouteStream({
        request: payload.request as DesktopApiRequest,
        requestId: String(payload.requestId || ''),
      });
      return;
    }

    if (type === 'diagnostics.snapshot') {
      parentPort.postMessage({
        payload: await buildDiagnosticsSnapshot(),
        requestId: String(payload.requestId || ''),
        type: 'diagnostics.snapshot.result',
      });
      return;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || null : null;
    await log('error', 'backend.requestFailed', {
      message: messageText,
      requestId: payload.requestId || null,
      stack,
      type,
    });
    parentPort.postMessage({
      error: messageText,
      requestId: String(payload.requestId || ''),
      stack,
      type: type === 'route.stream' ? 'route.stream.error' : 'backend.request.error',
    });
  }
});

async function handleRouteStream(params: {
  request: DesktopApiRequest;
  requestId: string;
}) {
  const response = await invokeDesktopApiRoute(params.request);
  const streamId = cryptoRandomId();
  parentPort.postMessage({
    payload: {
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText,
      streamId,
    },
    requestId: params.requestId,
    type: 'route.stream.start',
  });
  await Promise.resolve();

  const reader = response.body?.getReader();
  if (!reader) {
    parentPort.postMessage({
      payload: {
        streamId,
        type: 'end',
      },
      type: 'route.stream.event',
    });
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    parentPort.postMessage({
      payload: {
        chunk: value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        ),
        streamId,
        type: 'chunk',
      },
      type: 'route.stream.event',
    });
  }

  parentPort.postMessage({
    payload: {
      streamId,
      type: 'end',
    },
    type: 'route.stream.event',
  });
}

async function buildDiagnosticsSnapshot() {
  ensureRuntime();
  const prisma = getPrismaClient();

  const [recentWorkspaces, recentRuns, platformStatus] = await Promise.all([
    prisma.document.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
      take: 5,
      where: {
        deletedAt: null,
        organizationId: runtime!.organizationId,
      },
    }),
    prisma.workspaceRun.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
      take: 10,
      where: {
        organizationId: runtime!.organizationId,
      },
    }),
    getPlatformStatus({
      deviceId: runtime!.deviceId,
      organizationId: runtime!.organizationId,
      userId: runtime!.userId,
    }),
  ]);

  return {
    platformStatus,
    recentRunIds: recentRuns.map((run) => run.id),
    recentWorkspaceIds: recentWorkspaces.map((workspace) => workspace.id),
  };
}

async function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  context?: Record<string, unknown>
) {
  if (!runtime) {
    return;
  }

  await appendJsonLog({
    appVersion: runtime.appVersion,
    channel: runtime.channel,
    context,
    deviceId: runtime.deviceId,
    event,
    filePath: path.join(runtime.appDataRoot, 'logs', 'backend.jsonl'),
    level,
    processType: 'backend',
  });
}

function ensureRuntime() {
  if (!runtime) {
    throw new Error('Desktop backend received a request before initialization.');
  }
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
