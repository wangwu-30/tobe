import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PRODUCT_NAME = '成形';
const REQUIRE = createRequire(import.meta.url);
const { findPackagedApps } = REQUIRE('./finalize-packaged-app.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('desktop:smoke:packaged only supports macOS app bundles.');
  }

  const sourceAppPath = await resolvePackagedAppPath();
  const smokeRoot = path.join(projectRoot, '.tmp', 'packaged-app-smoke');
  const installRoot = path.join(smokeRoot, 'install');
  const appDataRoot = path.join(smokeRoot, 'app-data');
  const installedAppPath = path.join(installRoot, path.basename(sourceAppPath));

  await fs.rm(smokeRoot, { force: true, recursive: true });
  await fs.mkdir(installRoot, { recursive: true });
  await fs.mkdir(appDataRoot, { recursive: true });
  await copyAppBundleForInstallSmoke({
    destinationPath: installedAppPath,
    sourcePath: sourceAppPath,
  });

  await runBackendSmoke({
    appDataRoot,
    appPath: installedAppPath,
  });
  await runStartupSmoke({
    appDataRoot,
    appPath: installedAppPath,
  });

  process.stdout.write(
    `[desktop smoke] packaged app passed install-like smoke at ${installedAppPath}\n`
  );
}

async function copyAppBundleForInstallSmoke(params) {
  // `ditto` preserves the relative framework symlinks inside macOS app bundles.
  // Node's recursive fs.cp rewrites those links to absolute source paths on macOS,
  // which makes an install-like smoke copy load framework resources from the wrong bundle.
  await new Promise((resolve, reject) => {
    const child = spawn('ditto', [params.sourcePath, params.destinationPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ditto failed while preparing install-like smoke bundle with exit code ${code ?? 'unknown'}.\n${output.trim()}`
        )
      );
    });
  });
}

async function resolvePackagedAppPath() {
  const outRoot = path.join(projectRoot, 'out');
  const entries = await fs.readdir(outRoot, { withFileTypes: true }).catch(() => []);
  const outputPaths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name));
  const appPaths = await findPackagedApps(outputPaths, PRODUCT_NAME);

  if (appPaths.length === 0) {
    throw new Error('Could not find a packaged 成形.app under out/. Run npm run desktop:package first.');
  }

  const candidates = await Promise.all(
    appPaths.map(async (appPath) => ({
      appPath,
      mtimeMs: (await fs.stat(appPath)).mtimeMs,
    }))
  );
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0].appPath;
}

async function runBackendSmoke(params) {
  const resourcesPath = path.join(params.appPath, 'Contents', 'Resources');
  const backendModulePath = path.join(resourcesPath, 'build', 'backend.js');
  const originalParentPort = process.parentPort;
  const originalRuntimeRoot = process.env.DAO_DESKTOP_RUNTIME_ROOT;
  const harness = new BackendHarness();

  process.parentPort = harness;
  process.env.DAO_DESKTOP_RUNTIME_ROOT = resourcesPath;

  try {
    await import(`${pathToFileURL(backendModulePath).href}?smoke=${Date.now()}`);

    await harness.initialize({
      appDataRoot: params.appDataRoot,
      appPath: resourcesPath,
      appVersion: '0.1.0-smoke',
      channel: 'smoke',
      deviceId: 'smoke-device',
      organizationId: 'smoke-org',
      userId: 'smoke-user',
    });

    const statusResponse = await harness.route({
      body: { kind: 'empty' },
      headers: {
        'x-dao-device-id': 'smoke-device',
        'x-dao-organization-id': 'smoke-org',
        'x-dao-user-id': 'smoke-user',
      },
      method: 'GET',
      path: '/api/platform/status',
    });
    if (statusResponse.status !== 200) {
      throw new Error(
        `Packaged backend status route failed with ${statusResponse.status}: ${statusResponse.text}`
      );
    }

    const searchProvidersResponse = await harness.route({
      body: { kind: 'empty' },
      headers: {
        'x-dao-device-id': 'smoke-device',
        'x-dao-organization-id': 'smoke-org',
        'x-dao-user-id': 'smoke-user',
      },
      method: 'GET',
      path: '/api/search/providers',
    });

    if (searchProvidersResponse.status !== 200) {
      throw new Error(
        `Packaged backend search providers route failed with ${searchProvidersResponse.status}: ${searchProvidersResponse.text}`
      );
    }

    const searchProvidersPayload = JSON.parse(searchProvidersResponse.text);
    if (!Array.isArray(searchProvidersPayload?.providers) || searchProvidersPayload.providers.length === 0) {
      throw new Error(
        `Packaged backend search providers route returned an empty payload: ${searchProvidersResponse.text}`
      );
    }

    const createResponse = await harness.route({
      body: {
        kind: 'text',
        value: JSON.stringify({
          deliverableType: 'document',
          goal: 'Packaged smoke workspace',
          title: 'Packaged smoke workspace',
        }),
      },
      headers: {
        'content-type': 'application/json',
        'x-dao-device-id': 'smoke-device',
        'x-dao-idempotency-key': 'packaged-smoke-workspace',
        'x-dao-organization-id': 'smoke-org',
        'x-dao-user-id': 'smoke-user',
      },
      method: 'POST',
      path: '/api/workspaces',
    });

    if (createResponse.status !== 200) {
      throw new Error(
        `Packaged backend workspace creation failed with ${createResponse.status}: ${createResponse.text}`
      );
    }

    const payload = JSON.parse(createResponse.text);
    if (!payload?.workspace?.id || !payload?.primaryFile?.id || !payload?.conversation?.id) {
      throw new Error(
        `Packaged backend workspace creation returned an incomplete payload: ${createResponse.text}`
      );
    }

    const searchQueryResponse = await harness.route({
      body: {
        kind: 'text',
        value: JSON.stringify({
          maxResults: 3,
          query: 'packaged smoke',
        }),
      },
      headers: {
        'content-type': 'application/json',
        'x-dao-device-id': 'smoke-device',
        'x-dao-organization-id': 'smoke-org',
        'x-dao-user-id': 'smoke-user',
      },
      method: 'POST',
      path: '/api/search/query',
    });

    const searchQueryPayload = JSON.parse(searchQueryResponse.text);
    if (searchQueryResponse.status === 200) {
      if (!Array.isArray(searchQueryPayload?.results)) {
        throw new Error(
          `Packaged backend search query returned an invalid success payload: ${searchQueryResponse.text}`
        );
      }
    } else if (
      searchQueryResponse.status !== 400 ||
      typeof searchQueryPayload?.error !== 'string'
    ) {
      throw new Error(
        `Packaged backend search query returned an unexpected failure payload: ${searchQueryResponse.status} ${searchQueryResponse.text}`
      );
    }

    const planGenerateResponse = await harness.route({
      body: { kind: 'empty' },
      headers: {
        'x-dao-device-id': 'smoke-device',
        'x-dao-organization-id': 'smoke-org',
        'x-dao-user-id': 'smoke-user',
      },
      method: 'POST',
      path: `/api/workspaces/${payload.workspace.id}/plan/generate`,
    });

    const planGeneratePayload = JSON.parse(planGenerateResponse.text);
    if (planGenerateResponse.status === 200) {
      if (!Array.isArray(planGeneratePayload?.stages)) {
        throw new Error(
          `Packaged backend plan generate returned an invalid success payload: ${planGenerateResponse.text}`
        );
      }
    } else if (
      !planGeneratePayload?.plan ||
      planGeneratePayload.plan.status !== 'blocked' ||
      typeof planGeneratePayload.error !== 'string'
    ) {
      throw new Error(
        `Packaged backend plan generate returned an unexpected failure payload: ${planGenerateResponse.status} ${planGenerateResponse.text}`
      );
    }
  } finally {
    if (typeof originalParentPort === 'undefined') {
      delete process.parentPort;
    } else {
      process.parentPort = originalParentPort;
    }

    if (typeof originalRuntimeRoot === 'undefined') {
      delete process.env.DAO_DESKTOP_RUNTIME_ROOT;
    } else {
      process.env.DAO_DESKTOP_RUNTIME_ROOT = originalRuntimeRoot;
    }
  }
}

async function runStartupSmoke(params) {
  const binaryPath = path.join(params.appPath, 'Contents', 'MacOS', PRODUCT_NAME);
  const startupTracePath = path.join(params.appDataRoot, 'startup-trace.log');
  const child = spawn(binaryPath, [], {
    cwd: path.dirname(params.appPath),
    env: {
      ...process.env,
      DAO_APP_DATA_ROOT: params.appDataRoot,
      DAO_DEVICE_ID: 'smoke-device',
      DAO_ORGANIZATION_ID: 'smoke-org',
      DAO_PLATFORM: 'desktop',
      DAO_USER_ID: 'smoke-user',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exitInfo = null;
  let stderr = '';
  let stdout = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  try {
    await waitForStartupTrace({
      forbiddenStages: ['backend.ensureReady.error'],
      requiredStages: ['backend.ensureReady.ok', 'window.didFinishLoad'],
      startupTracePath,
      timeoutMs: 30_000,
    });
    await delay(3_000);

    if (exitInfo) {
      throw new Error(
        `Packaged app exited after startup readiness: ${JSON.stringify(exitInfo)}\nstdout:\n${stdout}\nstderr:\n${stderr}`
      );
    }
  } catch (error) {
    const traceTail = await readFileIfExists(startupTracePath);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nstartup trace:\n${traceTail}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  } finally {
    if (!child.killed && !exitInfo) {
      child.kill('SIGTERM');
      await waitForProcessExit(child, 5_000).catch(() => {
        child.kill('SIGKILL');
      });
    }
  }
}

async function waitForStartupTrace(params) {
  const deadline = Date.now() + params.timeoutMs;

  while (Date.now() < deadline) {
    const trace = await readTraceStages(params.startupTracePath);
    for (const forbiddenStage of params.forbiddenStages) {
      if (trace.stages.has(forbiddenStage)) {
        throw new Error(`Startup trace reached forbidden stage ${forbiddenStage}.`);
      }
    }

    if (params.requiredStages.every((stage) => trace.stages.has(stage))) {
      return;
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for startup trace stages ${params.requiredStages.join(', ')}.`
  );
}

async function readTraceStages(startupTracePath) {
  const content = await readFileIfExists(startupTracePath);
  const stages = new Set();

  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.stage === 'string') {
        stages.add(parsed.stage);
      }
    } catch {
      // Ignore malformed lines in best-effort trace output.
    }
  }

  return {
    content,
    stages,
  };
}

async function readFileIfExists(filePath) {
  return fs.readFile(filePath, 'utf8').catch(() => '');
}

async function waitForProcessExit(child, timeoutMs) {
  await Promise.race([
    new Promise((resolve) => {
      child.once('exit', () => resolve(undefined));
    }),
    delay(timeoutMs).then(() => {
      throw new Error('Timed out waiting for process exit.');
    }),
  ]);
}

class BackendHarness extends EventEmitter {
  constructor() {
    super();
    this.pendingRequests = new Map();
    this.pendingStreams = new Map();
  }

  postMessage(message) {
    this.handleMessage(message);
  }

  async initialize(payload) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this.pendingRequests.set(requestId, { reject, resolve, type: 'initialize' });
      this.emit('message', {
        payload,
        requestId,
        type: 'backend.initialize',
      });
    });
  }

  async route(request) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this.pendingRequests.set(requestId, { reject, resolve, type: 'route' });
      this.emit('message', {
        request,
        requestId,
        type: 'route.stream',
      });
    });
  }

  handleMessage(message) {
    const payload = message && typeof message === 'object' ? message : {};
    const type = typeof payload.type === 'string' ? payload.type : '';

    if (type === 'backend.initialized') {
      this.resolvePending(payload.requestId, undefined);
      return;
    }

    if (type === 'route.stream.start') {
      const pending = this.pendingRequests.get(String(payload.requestId || ''));
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(String(payload.requestId || ''));
      this.pendingStreams.set(payload.payload.streamId, {
        chunks: [],
        headers: payload.payload.headers,
        reject: pending.reject,
        resolve: pending.resolve,
        status: payload.payload.status,
        statusText: payload.payload.statusText,
      });
      return;
    }

    if (type === 'route.stream.event') {
      const streamPayload = payload.payload;
      const collector = this.pendingStreams.get(streamPayload.streamId);
      if (!collector) {
        return;
      }

      if (streamPayload.type === 'chunk') {
        collector.chunks.push(Buffer.from(streamPayload.chunk));
        return;
      }

      if (streamPayload.type === 'error') {
        collector.reject(new Error(streamPayload.error));
        this.pendingStreams.delete(streamPayload.streamId);
        return;
      }

      collector.resolve({
        headers: collector.headers,
        status: collector.status,
        statusText: collector.statusText,
        text: Buffer.concat(collector.chunks).toString('utf8'),
      });
      this.pendingStreams.delete(streamPayload.streamId);
      return;
    }

    if (type === 'route.stream.error' || type === 'backend.request.error') {
      this.rejectPending(
        payload.requestId,
        new Error(String(payload.error || 'Packaged backend request failed.'))
      );
      return;
    }

    if (type === 'backend-error') {
      const error = new Error(String(payload.message || 'Packaged backend reported an error.'));
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
    }
  }

  resolvePending(requestId, value) {
    const key = String(requestId || '');
    const pending = this.pendingRequests.get(key);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(key);
    pending.resolve(value);
  }

  rejectPending(requestId, error) {
    const key = String(requestId || '');
    const pending = this.pendingRequests.get(key);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(key);
    pending.reject(error);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
