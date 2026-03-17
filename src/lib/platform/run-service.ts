import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { prisma } from '@/lib/db/prisma';
import { getPlatformPaths } from '@/lib/platform/paths';
import {
  materializeWorkspaceMirror,
} from '@/lib/platform/mirror-manager';
import type { WorkspaceRunData } from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export interface WorkspaceRunService {
  getWorkspaceRun(params: {
    organizationId: string;
    runId: string;
    workspaceId: string;
  }): Promise<WorkspaceRunData | null>;
  listWorkspaceRuns(params: {
    organizationId: string;
    workspaceId: string;
  }): Promise<WorkspaceRunData[]>;
  startWorkspaceCommand(
    actor: ActorContext,
    input: {
      command: WorkspaceCommand;
      versionId?: string | null;
      workspaceId: string;
    }
  ): Promise<WorkspaceRunData>;
  startWorkspacePreview(
    actor: ActorContext,
    input: {
      versionId?: string | null;
      workspaceId: string;
    }
  ): Promise<WorkspaceRunData>;
  stopWorkspacePreview(
    organizationId: string,
    workspaceId: string
  ): Promise<{ stoppedRunIds: string[] }>;
}

type WorkspaceCommand = 'npm install' | 'npm run build' | 'npm run dev' | 'npm test';

const STATIC_PREVIEW_COMMAND = '__static_preview__';
const RUN_COMMANDS = new Set<WorkspaceCommand>([
  'npm install',
  'npm run build',
  'npm run dev',
  'npm test',
]);

const globalForWorkspaceRuns = globalThis as typeof globalThis & {
  __daoWorkspaceRunProcesses?: Map<string, ChildProcessWithoutNullStreams>;
};
const STALE_PREVIEW_GRACE_MS = 15_000;
const PREVIEW_PROBE_TIMEOUT_MS = 500;

function getWorkspaceRunProcesses() {
  if (!globalForWorkspaceRuns.__daoWorkspaceRunProcesses) {
    globalForWorkspaceRuns.__daoWorkspaceRunProcesses = new Map();
  }

  return globalForWorkspaceRuns.__daoWorkspaceRunProcesses;
}

export async function listWorkspaceRuns(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const runs = await prisma.workspaceRun.findMany({
    where: {
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    take: 30,
  });

  await reconcileActivePreviewRuns(runs);
  return runs.map(mapWorkspaceRun);
}

export async function getWorkspaceRun(params: {
  organizationId: string;
  runId: string;
  workspaceId: string;
}) {
  const run = await prisma.workspaceRun.findFirst({
    where: {
      documentId: params.workspaceId,
      id: params.runId,
      organizationId: params.organizationId,
    },
  });

  if (!run) {
    return null;
  }

  await reconcileActivePreviewRuns([run]);
  return mapWorkspaceRun(run);
}

export async function startWorkspaceCommand(
  actor: ActorContext,
  input: {
    command: WorkspaceCommand;
    versionId?: string | null;
    workspaceId: string;
  }
) {
  if (!RUN_COMMANDS.has(input.command)) {
    throw new Error('Command is not allowed.');
  }

  const mirrorDir = await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    versionId: input.versionId || null,
    workspaceId: input.workspaceId,
  });

  const port = input.command === 'npm run dev' ? await reservePort() : null;
  const previewUrl = port ? `http://127.0.0.1:${port}` : null;

  const run = await prisma.workspaceRun.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      versionId: input.versionId || null,
      kind: input.command === 'npm run dev' ? 'preview' : 'command',
      command: input.command,
      status: 'pending',
      previewUrl,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  const child = await spawnWorkspaceProcess({
    command: input.command,
    cwd: mirrorDir,
    port,
    runId: run.id,
  });

  attachWorkspaceRunLifecycle({
    child,
    runId: run.id,
  });

  return getRequiredWorkspaceRun(run.id);
}

export async function startWorkspacePreview(
  actor: ActorContext,
  input: {
    versionId?: string | null;
    workspaceId: string;
  }
) {
  await stopWorkspacePreview(actor.organizationId, input.workspaceId);

  const mirrorDir = await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    versionId: input.versionId || null,
    workspaceId: input.workspaceId,
  });

  const previewTarget = await detectPreviewTarget(mirrorDir);
  const port = await reservePort();
  const previewUrl = `http://127.0.0.1:${port}`;

  const run = await prisma.workspaceRun.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      versionId: input.versionId || null,
      kind: 'preview',
      command: previewTarget.command,
      status: 'pending',
      previewUrl,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  const child = await spawnWorkspaceProcess({
    command: previewTarget.command,
    cwd: mirrorDir,
    port,
    runId: run.id,
  });

  attachWorkspaceRunLifecycle({
    child,
    runId: run.id,
  });

  return getRequiredWorkspaceRun(run.id);
}

export async function stopWorkspacePreview(
  organizationId: string,
  workspaceId: string
) {
  const activeRuns = await prisma.workspaceRun.findMany({
    where: {
      documentId: workspaceId,
      kind: 'preview',
      organizationId,
      status: {
        in: ['pending', 'running'],
      },
    },
  });

  await Promise.all(activeRuns.map((run) => stopWorkspaceRun(run.id)));

  return {
    stoppedRunIds: activeRuns.map((run) => run.id),
  };
}

export async function stopWorkspaceRun(runId: string) {
  const processes = getWorkspaceRunProcesses();
  const child = processes.get(runId);

  if (child) {
    child.kill('SIGTERM');
    processes.delete(runId);
  }

  await prisma.workspaceRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      status: 'stopped',
    },
  });
}

async function spawnWorkspaceProcess(params: {
  command: string;
  cwd: string;
  port: number | null;
  runId: string;
}) {
  const logsDir = path.join(getPlatformPaths().logsRoot, 'workspace-runs');
  await fsPromises.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${params.runId}.log`);

  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    PORT: params.port ? String(params.port) : process.env.PORT,
  };

  let child: ChildProcessWithoutNullStreams;
  if (params.command === STATIC_PREVIEW_COMMAND) {
    const runtimeRoot = process.env.DAO_DESKTOP_RUNTIME_ROOT?.trim() || process.cwd();
    child = spawn(
      process.execPath,
      [
        path.join(runtimeRoot, 'scripts', 'static-preview-server.mjs'),
        params.cwd,
        String(params.port),
      ],
      {
        cwd: params.cwd,
        env,
      }
    );
  } else {
    const [binary, ...args] = params.command.split(' ');
    child = spawn(binary, args, {
      cwd: params.cwd,
      env,
    });
  }

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  await prisma.workspaceRun.update({
    where: { id: params.runId },
    data: {
      logPath,
      startedAt: new Date(),
      status: 'running',
    },
  });

  getWorkspaceRunProcesses().set(params.runId, child);
  return child;
}

function attachWorkspaceRunLifecycle(params: {
  child: ChildProcessWithoutNullStreams;
  runId: string;
}) {
  params.child.on('error', async (error) => {
    getWorkspaceRunProcesses().delete(params.runId);
    await prisma.workspaceRun.update({
      where: { id: params.runId },
      data: {
        finishedAt: new Date(),
        status: 'failed',
      },
    });
    console.error(error);
  });

  params.child.on('exit', async (code, signal) => {
    getWorkspaceRunProcesses().delete(params.runId);
    await prisma.workspaceRun.update({
      where: { id: params.runId },
      data: {
        exitCode: code,
        finishedAt: new Date(),
        status: signal
          ? 'stopped'
          : code && code !== 0
            ? 'failed'
            : 'succeeded',
      },
    });
  });
}

async function detectPreviewTarget(mirrorDir: string) {
  const packageJsonPath = path.join(mirrorDir, 'package.json');
  if (await pathExists(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(
        await fsPromises.readFile(packageJsonPath, 'utf8')
      ) as {
        scripts?: Record<string, string>;
      };

      if (packageJson.scripts?.dev) {
        return {
          command: 'npm run dev',
        };
      }
    } catch {
      // Ignore invalid package.json and keep checking fallbacks.
    }
  }

  if (await pathExists(path.join(mirrorDir, 'index.html'))) {
    return {
      command: STATIC_PREVIEW_COMMAND,
    };
  }

  throw new Error('No preview target detected. Add package.json with a dev script or an index.html file.');
}

async function pathExists(targetPath: string) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve a local port.'));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function getRequiredWorkspaceRun(runId: string) {
  const run = await prisma.workspaceRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new Error('Workspace run not found.');
  }

  return mapWorkspaceRun(run);
}

function mapWorkspaceRun(run: {
  command: string;
  createdAt: Date;
  createdByUserId: string | null;
  documentId: string;
  exitCode: number | null;
  finishedAt: Date | null;
  id: string;
  kind: string;
  logPath: string | null;
  organizationId: string;
  originDeviceId: string | null;
  previewUrl: string | null;
  startedAt: Date;
  status: string;
  updatedAt: Date;
  versionId: string | null;
}): WorkspaceRunData {
  return {
    id: run.id,
    organizationId: run.organizationId,
    workspaceId: run.documentId,
    versionId: run.versionId,
    kind: run.kind,
    command: run.command,
    status: normalizeRunStatus(run.status),
    previewUrl: run.previewUrl,
    logPath: run.logPath,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdByUserId: run.createdByUserId,
    originDeviceId: run.originDeviceId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function normalizeRunStatus(status: string): WorkspaceRunData['status'] {
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'stopped'
  ) {
    return status;
  }

  return 'failed';
}

async function reconcileActivePreviewRuns(
  runs: Array<{
    finishedAt: Date | null;
    id: string;
    kind: string;
    previewUrl: string | null;
    startedAt: Date;
    status: string;
  }>
) {
  const now = Date.now();
  const processes = getWorkspaceRunProcesses();
  const staleRunIds: string[] = [];

  for (const run of runs) {
    if (run.kind !== 'preview') {
      continue;
    }

    if (run.status !== 'pending' && run.status !== 'running') {
      continue;
    }

    if (processes.has(run.id)) {
      continue;
    }

    if (now - run.startedAt.getTime() < STALE_PREVIEW_GRACE_MS) {
      continue;
    }

    if (await canReachPreviewUrl(run.previewUrl)) {
      continue;
    }

    staleRunIds.push(run.id);
    run.status = 'stopped';
    run.finishedAt = run.finishedAt || new Date();
  }

  if (staleRunIds.length === 0) {
    return;
  }

  await prisma.workspaceRun.updateMany({
    where: {
      id: {
        in: staleRunIds,
      },
    },
    data: {
      finishedAt: new Date(),
      status: 'stopped',
    },
  });
}

async function canReachPreviewUrl(previewUrl: string | null) {
  if (!previewUrl) {
    return false;
  }

  try {
    const target = new URL(previewUrl);
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    if (!target.hostname || !Number.isFinite(port) || port <= 0) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const socket = net.connect({
        host: target.hostname,
        port,
      });
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(value);
      };
      const timeoutId = setTimeout(() => finish(false), PREVIEW_PROBE_TIMEOUT_MS);

      socket.once('connect', () => {
        clearTimeout(timeoutId);
        finish(true);
      });
      socket.once('error', () => {
        clearTimeout(timeoutId);
        finish(false);
      });
    });
  } catch {
    return false;
  }
}
