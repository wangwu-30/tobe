import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
} from 'electron';
import type { UtilityProcess } from 'electron';
import {
  appendJsonLog,
  ensureDesktopRuntimeContext,
  getDiagnosticsPaths,
  type DesktopRuntimeContext,
} from './shared/diagnostics-node';
import type {
  DesktopApiRequest,
  DesktopApiStreamEvent,
  DesktopApiStreamStart,
  DesktopDiagnosticsMetadata,
  DesktopStructuredLogEntry,
} from './shared/bridge';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preloadPath = path.join(__dirname, 'preload.js');
const PRODUCT_NAME = '成形';

const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const OPENAI_CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const OPENAI_CODEX_SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication successful</title>
</head>
<body>
  <p>Authentication successful. You can close this tab and return to 成形.</p>
  <script>
    window.setTimeout(() => {
      window.close();
    }, 120);
  </script>
</body>
</html>`;

let mainWindow: BrowserWindow | null = null;
let backendProcess: UtilityProcess | null = null;
let runtimeContext: DesktopRuntimeContext | null = null;
let startupTracePath: string | null = null;

app.setName(PRODUCT_NAME);

const pendingBackendRequests = new Map<
  string,
  {
    reject: (error: Error) => void;
    resolve: (value: any) => void;
  }
>();
const pendingStreamCollectors = new Map<
  string,
  {
    chunks: Uint8Array[];
    reject: (error: Error) => void;
    resolve: (value: string) => void;
  }
>();

async function main() {
  await runStartupStage('app.whenReady', async () => {
    await app.whenReady();
    initializeStartupTracePath();
  });

  runtimeContext = await runStartupStage('runtime.ensureDesktopRuntimeContext', async () =>
    ensureDesktopRuntimeContext({
      appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || app.getPath('userData'),
      appName: app.getName(),
      appPath: app.getAppPath(),
      appVersion: app.getVersion(),
      channel: resolveAppChannel(),
      organizationId: process.env.DAO_ORGANIZATION_ID,
      userId: process.env.DAO_USER_ID,
    })
  );

  const diagnosticsPaths = getDiagnosticsPaths(runtimeContext.appDataRoot);
  await runStartupStage('diagnostics.prepareCrashPath', async () => {
    app.setPath('crashDumps', diagnosticsPaths.crashDumpsPath);
    await fs.mkdir(diagnosticsPaths.crashDumpsPath, { recursive: true });
  });

  await runStartupStage('diagnostics.crashReporter.start', async () => {
    crashReporter.start({
      compress: true,
      globalExtra: {
        appVersion: runtimeContext!.appVersion,
        channel: runtimeContext!.channel,
        deviceId: runtimeContext!.deviceId,
        processType: 'main',
      },
      ignoreSystemCrashHandler: false,
      productName: PRODUCT_NAME,
      submitURL: 'https://chengxing.invalid/crash',
      uploadToServer: false,
    });
  });

  await runStartupStage('diagnostics.registerProcessLevel', async () => {
    registerProcessLevelDiagnostics();
  });
  await runStartupStage('diagnostics.desktopStartLog', async () => {
    await log('info', 'desktop.start');
  });
  await runStartupStage('backend.ensureReady', async () => {
    await ensureBackendReady();
  });
  await runStartupStage('ipc.registerDesktopHandlers', async () => {
    registerDesktopIpcHandlers();
  });
  await runStartupStage('window.createMainWindow', async () => {
    await createMainWindow();
  });
  await runStartupStage('app.registerLifecycleHandlers', async () => {
    registerAppLifecycleHandlers();
  });
}

function registerDesktopIpcHandlers() {
  ipcMain.handle('dao:api-fetch', async (_event, request: DesktopApiRequest) => {
    return startBackendRouteStream(withPlatformHeaders(request));
  });

  ipcMain.handle('dao:platform-status', async () => {
    const start = await startBackendRouteStream(
      withPlatformHeaders({
        body: { kind: 'empty' },
        headers: {},
        method: 'GET',
        path: '/api/platform/status',
      })
    );
    const text = await collectStreamToText(start.streamId);
    return JSON.parse(text);
  });

  ipcMain.handle('dao:diagnostics-get-metadata', async (): Promise<DesktopDiagnosticsMetadata> => {
    ensureRuntimeContext();
    return {
      appVersion: runtimeContext!.appVersion,
      channel: runtimeContext!.channel,
      deviceId: runtimeContext!.deviceId,
      diagnosticsEnabled: true,
      logsPath: getDiagnosticsPaths(runtimeContext!.appDataRoot).logsPath,
    };
  });

  ipcMain.handle('dao:diagnostics-open-logs-directory', async () => {
    ensureRuntimeContext();
    return shell.openPath(getDiagnosticsPaths(runtimeContext!.appDataRoot).logsPath);
  });

  ipcMain.handle('dao:diagnostics-export-bundle', async () => {
    ensureRuntimeContext();
    const exportPath = await exportDiagnosticsBundle();
    return {
      path: exportPath,
    };
  });

  ipcMain.handle('dao:diagnostics-log-renderer', async (_event, entry: DesktopStructuredLogEntry) => {
    ensureRuntimeContext();
    await log(entry.level, entry.event, entry.context, 'renderer');
  });

  ipcMain.handle('dao:oauth-login', async (_event, providerId: string) => {
    if (providerId !== 'openai-codex') {
      throw new Error(`OAuth login is not wired in-app yet for ${providerId}.`);
    }

    const credentials = await loginOpenAICodexInSystemBrowser();
    const savedAt = await persistOAuthCredentials(providerId, credentials);
    return {
      providerId,
      savedAt,
    };
  });
}

function registerAppLifecycleHandlers() {
  app.on('activate', () => {
    appendStartupTrace('app.activate');
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });

  app.on('before-quit', () => {
    appendStartupTrace('app.beforeQuit');
    if (backendProcess) {
      backendProcess.kill();
      backendProcess = null;
    }
  });

  app.on('window-all-closed', () => {
    appendStartupTrace('app.windowAllClosed');
  });

  app.on('will-quit', () => {
    appendStartupTrace('app.willQuit');
  });

  app.on('quit', (_event, exitCode) => {
    appendStartupTrace('app.quit', { exitCode });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    appendStartupTrace('renderer.processGone', {
      exitCode: details.exitCode,
      reason: details.reason,
      url: webContents.getURL(),
    });
    void log('error', 'renderer.processGone', {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL(),
    });
  });

  app.on('child-process-gone', (_event, details) => {
    appendStartupTrace('main.childProcessGone', {
      exitCode: details.exitCode,
      name: details.name,
      reason: details.reason,
      serviceName: details.serviceName,
      type: details.type,
    });
    void log('error', 'main.childProcessGone', {
      exitCode: details.exitCode,
      name: details.name,
      reason: details.reason,
      serviceName: details.serviceName,
      type: details.type,
    });
  });
}

async function createMainWindow() {
  const window = new BrowserWindow({
    minHeight: 860,
    minWidth: 1280,
    title: PRODUCT_NAME,
    width: 1480,
    height: 980,
    backgroundColor: '#f7f6f2',
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
      sandbox: false,
    },
  });
  appendStartupTrace('window.browserWindowCreated');

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('did-start-loading', () => {
    appendStartupTrace('window.didStartLoading');
  });

  window.webContents.on('did-finish-load', () => {
    appendStartupTrace('window.didFinishLoad', { url: window.webContents.getURL() });
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendStartupTrace('window.didFailLoad', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  mainWindow = window;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    appendStartupTrace('window.loadURL', { url: MAIN_WINDOW_VITE_DEV_SERVER_URL });
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    appendStartupTrace('window.loadFile', {
      filePath: path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    });
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (process.env.DAO_DESKTOP_OPEN_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

async function ensureBackendReady() {
  ensureRuntimeContext();

  if (backendProcess) {
    return;
  }

  const backendPath = resolveBackendEntryPath();
  const backendCwd = resolveBackendWorkingDirectory();

  backendProcess = utilityProcess.fork(backendPath, [], {
    cwd: backendCwd,
    env: {
      ...process.env,
      DAO_APP_DATA_ROOT: runtimeContext!.appDataRoot,
      DAO_DESKTOP_RUNTIME_ROOT: app.isPackaged
        ? process.resourcesPath
        : runtimeContext!.appPath,
      DAO_APP_VERSION: runtimeContext!.appVersion,
      DAO_DEVICE_ID: runtimeContext!.deviceId,
      DAO_ORGANIZATION_ID: runtimeContext!.organizationId,
      DAO_PLATFORM: 'desktop',
      DAO_USER_ID: runtimeContext!.userId,
      DATABASE_URL: `file:${path.join(runtimeContext!.appDataRoot, 'dev.db')}`,
    },
    serviceName: 'chengxing-backend',
    stdio: 'pipe',
  });
  appendStartupTrace('backend.forked', { backendCwd, backendPath });

  backendProcess.stdout?.on('data', (chunk) => {
    appendStartupTrace('backend.stdout', { chunk: chunk.toString() });
    void log('info', 'backend.stdout', { chunk: chunk.toString() });
  });

  backendProcess.stderr?.on('data', (chunk) => {
    appendStartupTrace('backend.stderr', { chunk: chunk.toString() });
    void log('warn', 'backend.stderr', { chunk: chunk.toString() });
  });

  backendProcess.on('exit', (code) => {
    appendStartupTrace('backend.exit', { code });
    void log('error', 'backend.exit', { code });
    backendProcess = null;
  });

  backendProcess.on('error', (type, location, report) => {
    appendStartupTrace('backend.utilityError', { location, report, type });
    void log('error', 'backend.utilityError', { location, report, type });
  });

  backendProcess.on('message', (message) => {
    appendStartupTrace('backend.message', {
      type:
        message &&
        typeof message === 'object' &&
        'type' in (message as Record<string, unknown>)
          ? (message as Record<string, unknown>).type
          : 'unknown',
    });
    void handleBackendMessage(message);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for the desktop backend to initialize.'));
    }, 20_000);

    const requestId = crypto.randomUUID();
    pendingBackendRequests.set(requestId, {
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      resolve: () => {
        clearTimeout(timeout);
        resolve();
      },
    });

    backendProcess!.postMessage({
      payload: {
        appDataRoot: runtimeContext!.appDataRoot,
        appPath: runtimeContext!.appPath,
        appVersion: runtimeContext!.appVersion,
        channel: runtimeContext!.channel,
        deviceId: runtimeContext!.deviceId,
        organizationId: runtimeContext!.organizationId,
        userId: runtimeContext!.userId,
      },
      requestId,
      type: 'backend.initialize',
    });
  });
}

async function handleBackendMessage(message: unknown) {
  const payload = message as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type : '';

  if (type === 'backend.initialized') {
    const requestId = String(payload.requestId || '');
    const pending = pendingBackendRequests.get(requestId);
    if (pending) {
      pending.resolve(true);
      pendingBackendRequests.delete(requestId);
    }
    return;
  }

  if (type === 'route.stream.start') {
    const requestId = String(payload.requestId || '');
    const pending = pendingBackendRequests.get(requestId);
    if (pending) {
      pending.resolve(payload.payload);
      pendingBackendRequests.delete(requestId);
    }
    return;
  }

  if (type === 'diagnostics.snapshot.result') {
    const requestId = String(payload.requestId || '');
    const pending = pendingBackendRequests.get(requestId);
    if (pending) {
      pending.resolve(payload.payload);
      pendingBackendRequests.delete(requestId);
    }
    return;
  }

  if (type === 'route.stream.event') {
    const event = payload.payload as DesktopApiStreamEvent;
    const collector = pendingStreamCollectors.get(event.streamId);
    if (collector) {
      if (event.type === 'chunk') {
        collector.chunks.push(new Uint8Array(event.chunk));
      } else if (event.type === 'error') {
        collector.reject(new Error(event.error));
        pendingStreamCollectors.delete(event.streamId);
      } else {
        const combined = Buffer.concat(
          collector.chunks.map((chunk) => Buffer.from(chunk))
        );
        collector.resolve(combined.toString('utf8'));
        pendingStreamCollectors.delete(event.streamId);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dao:api-stream-event', payload.payload);
    }
    return;
  }

  if (type === 'route.stream.error' || type === 'backend.request.error') {
    const requestId = String(payload.requestId || '');
    const pending = pendingBackendRequests.get(requestId);
    if (pending) {
      pending.reject(new Error(String(payload.error || 'Desktop backend request failed.')));
      pendingBackendRequests.delete(requestId);
    }
    return;
  }

  if (type === 'backend-error') {
    await log('error', 'backend.reportedError', {
      message: payload.message || 'Unknown backend error',
      stack: payload.stack || null,
    });
  }
}

async function startBackendRouteStream(request: DesktopApiRequest): Promise<DesktopApiStreamStart> {
  await ensureBackendReady();
  const requestId = crypto.randomUUID();

  return new Promise<DesktopApiStreamStart>((resolve, reject) => {
    pendingBackendRequests.set(requestId, { resolve, reject });
    backendProcess!.postMessage({
      request,
      requestId,
      type: 'route.stream',
    });
  });
}

async function collectStreamToText(streamId: string) {
  return new Promise<string>((resolve, reject) => {
    pendingStreamCollectors.set(streamId, {
      chunks: [],
      reject,
      resolve,
    });
  });
}

async function exportDiagnosticsBundle() {
  ensureRuntimeContext();
  const diagnosticsPaths = getDiagnosticsPaths(runtimeContext!.appDataRoot);
  const snapshot = (await requestBackendSnapshot()) as {
    platformStatus: unknown;
    recentRunIds: string[];
    recentWorkspaceIds: string[];
  };
  const exportRoot = path.join(
    diagnosticsPaths.exportsPath,
    `diagnostics-${Date.now()}`
  );
  await fs.rm(exportRoot, { force: true, recursive: true });
  await fs.mkdir(exportRoot, { recursive: true });
  await fs.cp(diagnosticsPaths.logsPath, path.join(exportRoot, 'logs'), {
    force: true,
    recursive: true,
  });

  const crashDumpsPath = app.getPath('crashDumps');
  await fs.cp(crashDumpsPath, path.join(exportRoot, 'crashes'), {
    force: true,
    recursive: true,
  }).catch(() => undefined);

  await fs.writeFile(
    path.join(exportRoot, 'manifest.json'),
    JSON.stringify(
      {
        appVersion: runtimeContext!.appVersion,
        channel: runtimeContext!.channel,
        deviceId: runtimeContext!.deviceId,
        exportedAt: new Date().toISOString(),
        os: process.platform,
        arch: process.arch,
        platformStatus: snapshot.platformStatus,
        recentRunIds: snapshot.recentRunIds,
        recentWorkspaceIds: snapshot.recentWorkspaceIds,
      },
      null,
      2
    )
  );

  const defaultPath = path.join(
    diagnosticsPaths.exportsPath,
    `${PRODUCT_NAME}-diagnostics-${Date.now()}.zip`
  );
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ extensions: ['zip'], name: 'ZIP archive' }],
    title: 'Export diagnostics bundle',
  });

  if (canceled || !filePath) {
    return null;
  }

  await zipDirectory(exportRoot, filePath);
  await log('info', 'diagnostics.exported', { filePath });
  return filePath;
}

async function requestBackendSnapshot() {
  await ensureBackendReady();
  const requestId = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    pendingBackendRequests.set(requestId, { resolve, reject });
    backendProcess!.postMessage({
      requestId,
      type: 'diagnostics.snapshot',
    });
  });
}

function withPlatformHeaders(request: DesktopApiRequest): DesktopApiRequest {
  ensureRuntimeContext();
  return {
    ...request,
    headers: {
      ...request.headers,
      'x-dao-device-id': request.headers['x-dao-device-id'] || runtimeContext!.deviceId,
      'x-dao-organization-id':
        request.headers['x-dao-organization-id'] || runtimeContext!.organizationId,
      'x-dao-user-id': request.headers['x-dao-user-id'] || runtimeContext!.userId,
    },
  };
}

function registerProcessLevelDiagnostics() {
  process.on('uncaughtException', (error) => {
    appendStartupTrace('process.uncaughtException', {
      message: error.message,
    });
    void log('error', 'main.uncaughtException', {
      message: error.message,
      stack: error.stack,
    });
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack || null : null;
    appendStartupTrace('process.unhandledRejection', { message });
    void log('error', 'main.unhandledRejection', { message, stack });
  });
}

async function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  context?: Record<string, unknown>,
  processType: 'main' | 'renderer' = 'main'
) {
  if (!runtimeContext) {
    return;
  }

  await appendJsonLog({
    appVersion: runtimeContext.appVersion,
    channel: runtimeContext.channel,
    context,
    deviceId: runtimeContext.deviceId,
    event,
    filePath: path.join(
      getDiagnosticsPaths(runtimeContext.appDataRoot).logsPath,
      `${processType}.jsonl`
    ),
    level,
    processType,
  });
}

function ensureRuntimeContext() {
  if (!runtimeContext) {
    throw new Error('Desktop runtime context is not initialized.');
  }
}

function resolveAppChannel() {
  return process.env.DAO_CHANNEL?.trim() || (app.isPackaged ? 'beta' : 'development');
}

function resolveBackendEntryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build', 'backend.js');
  }

  return path.join(__dirname, 'backend.js');
}

function resolveBackendWorkingDirectory() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }

  return runtimeContext?.appPath || app.getAppPath();
}

function initializeStartupTracePath() {
  if (startupTracePath) {
    return startupTracePath;
  }

  const appDataRoot = process.env.DAO_APP_DATA_ROOT?.trim() || app.getPath('userData');
  startupTracePath = path.join(appDataRoot, 'startup-trace.log');
  appendStartupTrace('startup.traceInitialized', { appDataRoot });
  return startupTracePath;
}

function appendStartupTrace(stage: string, context?: Record<string, unknown>) {
  try {
    const tracePath = startupTracePath || initializeStartupTracePath();
    fsSync.mkdirSync(path.dirname(tracePath), { recursive: true });
    fsSync.appendFileSync(
      tracePath,
      `${JSON.stringify({
        context: context || {},
        stage,
        timestamp: new Date().toISOString(),
      })}\n`
    );
  } catch {
    // Startup tracing is best-effort and must never block launch.
  }
}

async function runStartupStage<T>(stage: string, task: () => Promise<T> | T) {
  appendStartupTrace(`${stage}.start`);
  try {
    const result = await task();
    appendStartupTrace(`${stage}.ok`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || null : null;
    appendStartupTrace(`${stage}.error`, { message, stack });
    throw error;
  }
}

async function zipDirectory(sourceDirectory: string, destinationZipPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/zip', ['-r', destinationZipPath, path.basename(sourceDirectory)], {
      cwd: path.dirname(sourceDirectory),
      stdio: 'ignore',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`zip failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

function focusMainWindow() {
  const [window] = BrowserWindow.getAllWindows();
  if (!window || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.focus();
}

async function loginOpenAICodexInSystemBrowser() {
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const authorizationUrl = new URL(OPENAI_CODEX_AUTHORIZE_URL);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID);
  authorizationUrl.searchParams.set('redirect_uri', OPENAI_CODEX_REDIRECT_URI);
  authorizationUrl.searchParams.set('scope', OPENAI_CODEX_SCOPE);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('id_token_add_organizations', 'true');
  authorizationUrl.searchParams.set('codex_cli_simplified_flow', 'true');
  authorizationUrl.searchParams.set('originator', 'chengxing');

  const code = await waitForOpenAICodexCallback(state, async () => {
    await shell.openExternal(authorizationUrl.toString());
  });
  const tokenPayload = await exchangeOpenAICodexAuthorizationCode(code, verifier);
  const accountId = extractOpenAICodexAccountId(tokenPayload.access);
  if (!accountId) {
    throw new Error('Failed to extract accountId from OpenAI Codex token.');
  }

  return {
    access: tokenPayload.access,
    refresh: tokenPayload.refresh,
    expires: tokenPayload.expires,
    accountId,
  };
}

function waitForOpenAICodexCallback(expectedState: string, onReady: () => Promise<void>) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      finish(
        null,
        new Error(
          'OpenAI Codex login timed out. Finish the browser flow and try again from Settings.'
        )
      );
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '', OPENAI_CODEX_REDIRECT_URI);
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        if (url.searchParams.get('state') !== expectedState) {
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        }

        const providerError = url.searchParams.get('error');
        if (providerError) {
          res.statusCode = 400;
          res.end('Authentication was not completed');
          finish(
            null,
            new Error(
              url.searchParams.get('error_description') ||
                `OpenAI Codex login was not completed (${providerError}).`
            )
          );
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end('Missing authorization code');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(OPENAI_CODEX_SUCCESS_HTML);
        focusMainWindow();
        finish(code);
      } catch (error) {
        res.statusCode = 500;
        res.end('Internal error');
        finish(
          null,
          error instanceof Error ? error : new Error('OAuth callback handling failed.')
        );
      }
    });

    const finish = (value: string | null, error?: Error | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      try {
        server.close(() => {});
      } catch {
        // Ignore close errors.
      }

      if (error) {
        reject(error);
      } else if (value) {
        resolve(value);
      }
    };

    server.on('error', (error) => {
      finish(
        null,
        new Error(
          `Could not start the OpenAI Codex callback server on localhost:1455 (${(error as NodeJS.ErrnoException).code || 'unknown error'}).`
        )
      );
    });

    server.listen(1455, async () => {
      try {
        await onReady();
      } catch (error) {
        finish(
          null,
          error instanceof Error
            ? error
            : new Error('Could not open the default browser for OpenAI Codex login.')
        );
      }
    });
  });
}

async function exchangeOpenAICodexAuthorizationCode(code: string, verifier: string) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `OpenAI Codex token exchange failed: ${response.status} ${response.statusText}${
        details ? ` - ${details}` : ''
      }`
    );
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('OpenAI Codex token response is missing required fields.');
  }

  return {
    access: json.access_token as string,
    refresh: json.refresh_token as string,
    expires: Date.now() + json.expires_in * 1000,
  };
}

function extractOpenAICodexAccountId(accessToken: string) {
  const claims = decodeJwtClaims(accessToken);
  const authClaims =
    claims && typeof claims[OPENAI_CODEX_JWT_CLAIM_PATH] === 'object'
      ? (claims[OPENAI_CODEX_JWT_CLAIM_PATH] as Record<string, unknown>)
      : null;
  const accountId =
    authClaims && typeof authClaims.chatgpt_account_id === 'string'
      ? authClaims.chatgpt_account_id
      : null;

  return accountId || null;
}

function decodeJwtClaims(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');

    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function persistOAuthCredentials(
  providerId: string,
  credentials: {
    access: string;
    accountId: string;
    expires: number;
    refresh: string;
  }
) {
  ensureRuntimeContext();
  const oauthDir = path.join(runtimeContext!.appDataRoot, '.oauth');
  const authStorePath = path.join(oauthDir, 'auth.json');
  const savedAt = new Date().toISOString();
  const payload = {
    type: 'oauth',
    ...credentials,
    savedAt,
  };

  await fs.mkdir(oauthDir, { recursive: true });

  let authStore: Record<string, unknown> = {};
  try {
    authStore = JSON.parse(await fs.readFile(authStorePath, 'utf8')) as Record<string, unknown>;
  } catch {
    authStore = {};
  }

  authStore[providerId] = payload;
  await fs.writeFile(authStorePath, JSON.stringify(authStore, null, 2));

  if (providerId === 'openai-codex') {
    await fs.writeFile(
      path.join(oauthDir, 'openai-codex.json'),
      JSON.stringify(payload, null, 2)
    );
  }

  return savedAt;
}

main().catch((error) => {
  appendStartupTrace('main.catch', {
    detail: error instanceof Error ? error.stack || error.message : String(error),
  });
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  void log('error', 'desktop.fatalStartupError', {
    detail,
  });
  dialog.showErrorBox('成形启动失败', detail);
  app.exit(1);
});
