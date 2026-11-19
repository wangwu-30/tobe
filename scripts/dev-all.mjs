import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), '..');

export const DEV_ALL_SERVICES = [
  'web',
  'room-session-host',
  'execution-daemon',
  'knowledge-merge-worker',
];

const DAEMON_BUNDLES = {
  'execution-daemon': {
    buildCommand: ['npm', 'run', 'execution:daemon:build'],
    bundleRelativePath: '.vite/execution-daemon/index.mjs',
  },
  'knowledge-merge-worker': {
    buildCommand: ['npm', 'run', 'knowledge:merge-worker:build'],
    bundleRelativePath: '.vite/knowledge-merge-worker/index.mjs',
  },
  'room-session-host': {
    buildCommand: ['npm', 'run', 'room:host:build'],
    bundleRelativePath: '.vite/room-session-host/index.mjs',
  },
};

export function parseDevAllArgs(argv) {
  const options = {
    appDataRoot: null,
    build: false,
    dryRun: false,
    hostname: '127.0.0.1',
    includeWeb: true,
    organizationId: 'local-org',
    port: 3000,
    runtimeDir: null,
    skipBootstrap: false,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-web') {
      options.includeWeb = false;
    } else if (arg === '--build') {
      options.build = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--skip-bootstrap') {
      options.skipBootstrap = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--port') {
      const next = argv[index + 1];
      const parsed = Number(next);
      if (!next || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${next ?? '(missing)'}`);
      }
      options.port = parsed;
      index += 1;
    } else if (arg === '--hostname') {
      const next = argv[index + 1]?.trim();
      if (!next) throw new Error('Missing value for --hostname.');
      options.hostname = next;
      index += 1;
    } else if (arg === '--organization-id') {
      const next = argv[index + 1]?.trim();
      if (!next) throw new Error('Missing value for --organization-id.');
      options.organizationId = next;
      index += 1;
    } else if (arg === '--app-data-root') {
      const next = argv[index + 1]?.trim();
      if (!next) throw new Error('Missing value for --app-data-root.');
      options.appDataRoot = path.resolve(next);
      index += 1;
    } else if (arg === '--runtime-dir') {
      const next = argv[index + 1]?.trim();
      if (!next) throw new Error('Missing value for --runtime-dir.');
      options.runtimeDir = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown dev:all option: ${arg}`);
    }
  }

  return options;
}

export function buildDefaultRoomSessionHostConfig({
  organizationId = 'local-org',
} = {}) {
  return {
    schemaVersion: 1,
    organizationId,
    workerId: 'dev-room-session-host',
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 5_000,
    leaseDurationMs: 30_000,
    shutdownGraceMs: 5_000,
    maxConcurrentSessions: 4,
    maxDeliveryAttempts: 3,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 10_000,
    runtimes: [
      {
        driver: 'stub',
        runtimeId: 'local-dev-stub',
        runtimeVersion: '1.0.0',
        responseText: 'Local dev Room Session Host is online.',
      },
    ],
  };
}

export function buildDefaultExecutionDaemonConfig({
  cwd = defaultRepoRoot,
  executable = process.execPath,
  organizationId = 'local-org',
} = {}) {
  return {
    schemaVersion: 1,
    organizationId,
    workerId: 'dev-execution-daemon',
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 5_000,
    leaseDurationMs: 30_000,
    shutdownGraceMs: 5_000,
    runtimes: [
      {
        driver: 'generic-cli',
        runtimeId: 'local-dev-cli',
        runtimeVersion: '1.0.0',
        executable,
        args: ['-e', "process.stdout.write('local-dev-cli ok\\n')"],
        cwd,
        envAllowlist: [],
        capacityTotal: 1,
      },
    ],
  };
}

export function parseDaemonStatusLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type === 'ready') {
      return {
        pid: typeof parsed.pid === 'number' ? parsed.pid : null,
        state: 'ready',
        workerId: typeof parsed.workerId === 'string' ? parsed.workerId : null,
      };
    }
    if (parsed.type === 'error') {
      return {
        code: typeof parsed.code === 'string' ? parsed.code : 'unknown-error',
        message: typeof parsed.message === 'string' ? parsed.message : 'Daemon error',
        state: 'error',
      };
    }
    if (parsed.type === 'stopped') {
      return {
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'stopped',
        state: 'stopped',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function formatHealthSummary(healthMap) {
  const entries = [...healthMap.entries()];
  const readyCount = entries.filter(([, state]) => state === 'ready').length;
  const details = entries.map(([name, state]) => `${name}=${state}`).join(', ');
  return `[dev:all] health (${readyCount}/${entries.length} ready): ${details}`;
}

export async function prepareDevAllPlan(options, env = process.env, repoRoot = defaultRepoRoot) {
  const runtimeDir =
    options.runtimeDir ?? path.join(repoRoot, '.tmp', 'dev-all');
  const knowledgeIndexRoot =
    env.DAO_KNOWLEDGE_INDEX_ROOT?.trim() ||
    path.join(runtimeDir, 'knowledge-indexes');
  const roomConfigPath =
    env.DAO_ROOM_SESSION_HOST_CONFIG_PATH?.trim() ||
    path.join(runtimeDir, 'room-session-host.json');
  const executionConfigPath =
    env.DAO_EXECUTION_DAEMON_CONFIG_PATH?.trim() ||
    path.join(runtimeDir, 'execution-daemon.json');

  const sharedEnv = { ...env };
  if (options.appDataRoot) {
    sharedEnv.DAO_APP_DATA_ROOT = options.appDataRoot;
    if (!sharedEnv.DATABASE_URL?.trim()) {
      sharedEnv.DATABASE_URL = `file:${path.join(options.appDataRoot, 'dev.db')}`;
    }
  }

  if (!options.dryRun) {
    if (options.appDataRoot) {
      await fs.mkdir(options.appDataRoot, { recursive: true });
    }
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(knowledgeIndexRoot, { recursive: true });
    if (!env.DAO_ROOM_SESSION_HOST_CONFIG_PATH?.trim()) {
      await fs.writeFile(
        roomConfigPath,
        `${JSON.stringify(
          buildDefaultRoomSessionHostConfig({
            organizationId: options.organizationId,
          }),
          null,
          2
        )}\n`,
        'utf8'
      );
    }
    if (!env.DAO_EXECUTION_DAEMON_CONFIG_PATH?.trim()) {
      await fs.writeFile(
        executionConfigPath,
        `${JSON.stringify(
          buildDefaultExecutionDaemonConfig({
            cwd: repoRoot,
            organizationId: options.organizationId,
          }),
          null,
          2
        )}\n`,
        'utf8'
      );
    }
  }

  const services = [];
  if (options.includeWeb) {
    services.push({
      command: [
        'npx',
        'next',
        'dev',
        '--webpack',
        '--hostname',
        options.hostname,
        '--port',
        String(options.port),
      ],
      env: {
        ...sharedEnv,
        HOSTNAME: options.hostname,
        PORT: String(options.port),
      },
      healthUrl: `http://${options.hostname}:${options.port}/api/platform/status`,
      name: 'web',
      readinessMode: 'http',
    });
  }

  services.push(
    {
      bundlePath: path.join(repoRoot, DAEMON_BUNDLES['room-session-host'].bundleRelativePath),
      command: [
        process.execPath,
        path.join(repoRoot, DAEMON_BUNDLES['room-session-host'].bundleRelativePath),
      ],
      env: {
        ...sharedEnv,
        DAO_ROOM_SESSION_HOST_CONFIG_PATH: roomConfigPath,
      },
      name: 'room-session-host',
      readinessMode: 'json-stdout',
    },
    {
      bundlePath: path.join(repoRoot, DAEMON_BUNDLES['execution-daemon'].bundleRelativePath),
      command: [
        process.execPath,
        path.join(repoRoot, DAEMON_BUNDLES['execution-daemon'].bundleRelativePath),
      ],
      env: {
        ...sharedEnv,
        DAO_EXECUTION_DAEMON_CONFIG_PATH: executionConfigPath,
      },
      name: 'execution-daemon',
      readinessMode: 'json-stdout',
    },
    {
      bundlePath: path.join(repoRoot, DAEMON_BUNDLES['knowledge-merge-worker'].bundleRelativePath),
      command: [
        process.execPath,
        path.join(repoRoot, DAEMON_BUNDLES['knowledge-merge-worker'].bundleRelativePath),
      ],
      env: {
        ...sharedEnv,
        DAO_KNOWLEDGE_INDEX_ROOT: knowledgeIndexRoot,
        DAO_KNOWLEDGE_ORGANIZATION_ID:
          env.DAO_KNOWLEDGE_ORGANIZATION_ID?.trim() || options.organizationId,
        DAO_KNOWLEDGE_WORKER_ID:
          env.DAO_KNOWLEDGE_WORKER_ID?.trim() || 'dev-knowledge-merge-worker',
      },
      name: 'knowledge-merge-worker',
      readinessMode: 'json-stdout',
    }
  );

  return {
    configs: {
      executionConfigPath,
      knowledgeIndexRoot,
      roomConfigPath,
      runtimeDir,
    },
    services,
    sharedEnv,
  };
}

export async function runDevAllServices({
  onHealthChange,
  repoRoot = defaultRepoRoot,
  services,
  shutdownGraceMs = 5_000,
  signal,
  write = (text) => process.stdout.write(text),
}) {
  const health = new Map(services.map((service) => [service.name, 'starting']));
  const children = new Map();
  const pollTimers = [];
  let shuttingDown = false;
  let exitCode = 0;

  const updateHealth = (name, nextState) => {
    if (health.get(name) === nextState) return;
    health.set(name, nextState);
    const summary = formatHealthSummary(health);
    write(`${summary}\n`);
    onHealthChange?.(new Map(health));
  };

  const stopAll = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const timer of pollTimers) clearInterval(timer);
    write(`[dev:all] shutting down (${reason})...\n`);
    for (const child of children.values()) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
    }
    const forceTimer = setTimeout(() => {
      for (const child of children.values()) {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      }
    }, shutdownGraceMs);
    forceTimer.unref();
  };

  const handleAbort = () => stopAll('signal');
  signal?.addEventListener('abort', handleAbort, { once: true });

  const exitPromises = services.map((service) => {
    const child = spawn(service.command[0], service.command.slice(1), {
      cwd: repoRoot,
      env: service.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.set(service.name, child);

    pipePrefixedStream(child.stdout, service.name, write, (line) => {
      if (service.readinessMode !== 'json-stdout') return;
      const status = parseDaemonStatusLine(line);
      if (status?.state === 'ready') {
        updateHealth(service.name, 'ready');
      } else if (status?.state === 'error') {
        updateHealth(service.name, 'error');
      } else if (status?.state === 'stopped') {
        updateHealth(service.name, 'stopped');
      }
    });
    pipePrefixedStream(child.stderr, service.name, write);

    if (service.readinessMode === 'http' && service.healthUrl) {
      const timer = setInterval(() => {
        if (shuttingDown || health.get(service.name) === 'ready') return;
        probeHttpOk(service.healthUrl).then((ok) => {
          if (ok && !shuttingDown) {
            updateHealth(service.name, 'ready');
          }
        });
      }, 500);
      timer.unref();
      pollTimers.push(timer);
    }

    return new Promise((resolve) => {
      child.once('error', (error) => {
        write(`[${service.name}] spawn error: ${error.message}\n`);
        updateHealth(service.name, 'error');
        if (!shuttingDown) {
          exitCode = 1;
          stopAll(`${service.name} failed to start`);
        }
        resolve();
      });
      child.once('exit', (code, exitSignal) => {
        const cleanShutdown = shuttingDown && (code === 0 || exitSignal === 'SIGTERM' || exitSignal === 'SIGINT');
        updateHealth(service.name, cleanShutdown ? 'stopped' : code === 0 ? 'stopped' : 'error');
        if (!shuttingDown) {
          exitCode = code === 0 ? 0 : (code ?? 1);
          stopAll(`${service.name} exited (${code ?? exitSignal ?? 'unknown'})`);
        }
        resolve();
      });
    });
  });

  await Promise.all(exitPromises);
  for (const timer of pollTimers) clearInterval(timer);
  signal?.removeEventListener('abort', handleAbort);
  return { exitCode, health };
}

function pipePrefixedStream(stream, prefix, write, onLine) {
  if (!stream) return;
  stream.setEncoding('utf8');
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      write(`[${prefix}] ${line}\n`);
      onLine?.(line);
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      write(`[${prefix}] ${buffer}\n`);
      onLine?.(buffer);
      buffer = '';
    }
  });
}

function probeHttpOk(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1_000 }, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function runBlockingCommand(command, env, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code ?? 'unknown'}): ${command.join(' ')}`));
    });
  });
}

async function ensureLocalOrganizationRow(databaseUrl, organizationId) {
  const client = createClient({ url: databaseUrl });
  try {
    const now = new Date().toISOString();
    const slug = organizationId === 'local-org' ? 'local' : organizationId;
    await client.execute({
      args: [organizationId, slug, 'Local Organization', now, now],
      sql: `INSERT OR IGNORE INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?)`,
    });
  } finally {
    client.close();
  }
}

async function ensurePrerequisites(options, plan, repoRoot) {
  if (!options.skipBootstrap) {
    process.stdout.write('[dev:all] bootstrapping local Prisma client and SQLite WAL database...\n');
    await runBlockingCommand(['npm', 'run', 'db:generate'], plan.sharedEnv, repoRoot);
    const bootstrapArgs = ['scripts/bootstrap-local-db.mjs'];
    if (options.appDataRoot) {
      bootstrapArgs.push('--app-data-root', options.appDataRoot);
    }
    await runBlockingCommand([process.execPath, ...bootstrapArgs], plan.sharedEnv, repoRoot);
    const effectiveAppDataRoot =
      options.appDataRoot ??
      (plan.sharedEnv.DAO_APP_DATA_ROOT?.trim()
        ? path.resolve(plan.sharedEnv.DAO_APP_DATA_ROOT.trim())
        : repoRoot);
    const databaseUrl =
      plan.sharedEnv.DATABASE_URL?.trim() ||
      `file:${path.join(effectiveAppDataRoot, 'dev.db')}`;
    await ensureLocalOrganizationRow(databaseUrl, options.organizationId);
  }

  if (options.skipBuild) return;
  for (const [name, meta] of Object.entries(DAEMON_BUNDLES)) {
    const bundlePath = path.join(repoRoot, meta.bundleRelativePath);
    const exists = await fs
      .access(bundlePath)
      .then(() => true)
      .catch(() => false);
    if (options.build || !exists) {
      process.stdout.write(`[dev:all] building ${name} bundle...\n`);
      await runBlockingCommand(meta.buildCommand, plan.sharedEnv, repoRoot);
    }
  }
}

async function main() {
  const options = parseDevAllArgs(process.argv.slice(2));
  const plan = await prepareDevAllPlan(options);

  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          configs: plan.configs,
          services: plan.services.map((service) => ({
            command: service.command,
            healthUrl: service.healthUrl ?? null,
            name: service.name,
            readinessMode: service.readinessMode,
          })),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  await ensurePrerequisites(options, plan, defaultRepoRoot);

  const abortController = new AbortController();
  const onSignal = () => abortController.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const result = await runDevAllServices({
    repoRoot: defaultRepoRoot,
    services: plan.services,
    signal: abortController.signal,
  });

  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
