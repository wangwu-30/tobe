import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DesktopStructuredLogEntry } from './bridge';

export type DesktopRuntimeContext = {
  appDataRoot: string;
  appPath: string;
  appVersion: string;
  channel: string;
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function ensureDesktopRuntimeContext(params: {
  appDataRoot: string;
  appName: string;
  appPath: string;
  appVersion: string;
  channel: string;
  organizationId?: string | null;
  userId?: string | null;
}) {
  await fs.mkdir(params.appDataRoot, { recursive: true });
  const deviceStorePath = path.join(params.appDataRoot, 'device.json');
  const devicePayload = await readOrCreateJson(deviceStorePath, () => ({
    deviceId: crypto.randomUUID(),
    label: `${params.appName} desktop`,
  }));

  const logsPath = path.join(params.appDataRoot, 'logs');
  const exportsPath = path.join(params.appDataRoot, 'exports');
  await fs.mkdir(logsPath, { recursive: true });
  await fs.mkdir(exportsPath, { recursive: true });

  return {
    appDataRoot: params.appDataRoot,
    appPath: params.appPath,
    appVersion: params.appVersion,
    channel: params.channel,
    deviceId: devicePayload.deviceId,
    organizationId: params.organizationId?.trim() || 'local-org',
    userId: params.userId?.trim() || 'local-user',
  } satisfies DesktopRuntimeContext;
}

export async function appendJsonLog(params: {
  context?: Record<string, unknown>;
  deviceId: string;
  filePath: string;
  level: DesktopStructuredLogEntry['level'];
  processType: 'main' | 'backend' | 'renderer';
  appVersion: string;
  channel: string;
  event: string;
}) {
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  const record = {
    appVersion: params.appVersion,
    channel: params.channel,
    context: params.context || {},
    deviceId: params.deviceId,
    event: params.event,
    level: params.level,
    processType: params.processType,
    timestamp: new Date().toISOString(),
  };
  await fs.appendFile(params.filePath, `${JSON.stringify(record)}\n`);
}

export function getDiagnosticsPaths(appDataRoot: string) {
  return {
    crashDumpsPath: path.join(appDataRoot, 'crashes'),
    exportsPath: path.join(appDataRoot, 'exports'),
    logsPath: path.join(appDataRoot, 'logs'),
  };
}

async function readOrCreateJson<T>(filePath: string, factory: () => T) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    const value = factory();
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    return value;
  }
}
