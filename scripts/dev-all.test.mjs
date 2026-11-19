import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDefaultExecutionDaemonConfig,
  buildDefaultRoomSessionHostConfig,
  formatHealthSummary,
  parseDaemonStatusLine,
  parseDevAllArgs,
  prepareDevAllPlan,
  runDevAllServices,
} from './dev-all.mjs';

test('parseDevAllArgs parses defaults, flags, and rejects unknown options', () => {
  const defaults = parseDevAllArgs([]);
  assert.equal(defaults.includeWeb, true);
  assert.equal(defaults.port, 3000);
  assert.equal(defaults.hostname, '127.0.0.1');
  assert.equal(defaults.organizationId, 'local-org');
  assert.equal(defaults.dryRun, false);

  const custom = parseDevAllArgs([
    '--no-web',
    '--skip-build',
    '--skip-bootstrap',
    '--dry-run',
    '--port',
    '4123',
    '--hostname',
    '0.0.0.0',
    '--organization-id',
    'org-custom',
  ]);
  assert.equal(custom.includeWeb, false);
  assert.equal(custom.skipBuild, true);
  assert.equal(custom.skipBootstrap, true);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.port, 4123);
  assert.equal(custom.hostname, '0.0.0.0');
  assert.equal(custom.organizationId, 'org-custom');

  assert.throws(() => parseDevAllArgs(['--port', '0']), /Invalid --port/);
  assert.throws(() => parseDevAllArgs(['--bogus']), /Unknown dev:all option/);
});

test('default daemon configs satisfy schemaVersion 1 heartbeat/lease invariants', () => {
  const room = buildDefaultRoomSessionHostConfig({ organizationId: 'org-a' });
  assert.equal(room.schemaVersion, 1);
  assert.equal(room.organizationId, 'org-a');
  assert.ok(room.heartbeatIntervalMs * 3 <= room.leaseDurationMs);
  assert.ok(room.retryBaseDelayMs <= room.retryMaxDelayMs);
  assert.equal(room.runtimes.length, 1);
  assert.equal(room.runtimes[0].driver, 'stub');

  const exec = buildDefaultExecutionDaemonConfig({ organizationId: 'org-a' });
  assert.equal(exec.schemaVersion, 1);
  assert.equal(exec.organizationId, 'org-a');
  assert.ok(exec.heartbeatIntervalMs * 3 <= exec.leaseDurationMs);
  assert.equal(exec.runtimes.length, 1);
  assert.equal(exec.runtimes[0].driver, 'generic-cli');
  assert.ok(path.isAbsolute(exec.runtimes[0].cwd));
});

test('parseDaemonStatusLine recognizes structured ready, error, and stopped events', () => {
  assert.deepEqual(
    parseDaemonStatusLine(
      JSON.stringify({
        schemaVersion: 1,
        type: 'ready',
        workerId: 'w-1',
        pid: 42,
      })
    ),
    { pid: 42, state: 'ready', workerId: 'w-1' }
  );
  assert.deepEqual(
    parseDaemonStatusLine(
      JSON.stringify({
        schemaVersion: 1,
        type: 'error',
        code: 'invalid-config',
        message: 'bad',
      })
    ),
    { code: 'invalid-config', message: 'bad', state: 'error' }
  );
  assert.deepEqual(
    parseDaemonStatusLine(
      JSON.stringify({
        schemaVersion: 1,
        type: 'stopped',
        reason: 'SIGTERM',
      })
    ),
    { reason: 'SIGTERM', state: 'stopped' }
  );
  assert.equal(parseDaemonStatusLine('plain log line'), null);
  assert.equal(parseDaemonStatusLine('{not-json}'), null);
});

test('prepareDevAllPlan builds all 4 processes and respects custom environment overrides', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-dev-all-plan-'));
  try {
    const plan = await prepareDevAllPlan(
      parseDevAllArgs(['--runtime-dir', tmpDir, '--port', '3100']),
      {},
      tmpDir
    );
    assert.deepEqual(
      plan.services.map((service) => service.name),
      ['web', 'room-session-host', 'execution-daemon', 'knowledge-merge-worker']
    );
    assert.equal(
      plan.services[0].healthUrl,
      'http://127.0.0.1:3100/api/platform/status'
    );
    const roomConfigRaw = await fs.readFile(plan.configs.roomConfigPath, 'utf8');
    assert.equal(JSON.parse(roomConfigRaw).schemaVersion, 1);
    const execConfigRaw = await fs.readFile(plan.configs.executionConfigPath, 'utf8');
    assert.equal(JSON.parse(execConfigRaw).schemaVersion, 1);

    const customRoomPath = path.join(tmpDir, 'custom-room.json');
    const customPlan = await prepareDevAllPlan(
      parseDevAllArgs(['--no-web', '--dry-run']),
      { DAO_ROOM_SESSION_HOST_CONFIG_PATH: customRoomPath },
      tmpDir
    );
    assert.equal(customPlan.configs.roomConfigPath, customRoomPath);
    assert.deepEqual(
      customPlan.services.map((service) => service.name),
      ['room-session-host', 'execution-daemon', 'knowledge-merge-worker']
    );
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true });
  }
});

test('runDevAllServices tracks readiness, formats health summaries, and shuts down cleanly on abort', async () => {
  const readyWorkerScript = `
    process.stdout.write(JSON.stringify({ schemaVersion: 1, type: 'ready', workerId: 'mock', pid: process.pid }) + '\\n');
    const timer = setInterval(() => {}, 10000);
    process.once('SIGTERM', () => {
      clearInterval(timer);
      process.stdout.write(JSON.stringify({ schemaVersion: 1, type: 'stopped', reason: 'SIGTERM', pid: process.pid }) + '\\n');
      process.exit(0);
    });
  `;
  const abortController = new AbortController();
  const logs = [];
  let sawAllReady = false;

  const result = await runDevAllServices({
    onHealthChange(map) {
      const states = [...map.values()];
      if (states.every((state) => state === 'ready') && !sawAllReady) {
        sawAllReady = true;
        abortController.abort();
      }
    },
    services: [
      {
        command: [process.execPath, '-e', readyWorkerScript],
        env: process.env,
        name: 'room-session-host',
        readinessMode: 'json-stdout',
      },
      {
        command: [process.execPath, '-e', readyWorkerScript],
        env: process.env,
        name: 'execution-daemon',
        readinessMode: 'json-stdout',
      },
    ],
    signal: abortController.signal,
    write: (text) => logs.push(text),
  });

  assert.equal(sawAllReady, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.health.get('room-session-host'), 'stopped');
  assert.equal(result.health.get('execution-daemon'), 'stopped');
  assert.match(
    formatHealthSummary(
      new Map([
        ['web', 'ready'],
        ['room-session-host', 'ready'],
      ])
    ),
    /health \(2\/2 ready\)/
  );
  assert.ok(logs.some((line) => line.includes('[dev:all] health (2/2 ready)')));
});
