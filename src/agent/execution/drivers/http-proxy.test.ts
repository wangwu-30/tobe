import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { describe } from 'node:test';

import { RUNTIME_CONTRACT_VERSION_V1 } from '../contracts';
import type { RuntimeEventV1, RuntimeStartAttemptV1 } from '../driver';
import {
  HttpProxyExecutionRuntimeDriverV1,
  HttpProxyProtocolError,
  HttpProxyRuntimeUnavailableError,
} from './http-proxy';

const BASE_CAPABILITIES = {
  kinds: ['coding'] as const,
  nativeResume: true,
  checkpoint: true,
  streaming: 'typed-events' as const,
  interrupt: 'graceful' as const,
  workspace: 'directory' as const,
  sandbox: 'host' as const,
  structuredArtifacts: true,
  waitingForHuman: false,
  supportedModels: ['*'] as const,
};

function sampleStartInput(
  overrides: Partial<RuntimeStartAttemptV1> = {}
): RuntimeStartAttemptV1 {
  return {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    generation: 1,
    executionSpec: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      goal: 'Run repository check',
      kind: 'coding',
      requirements: {},
    },
    contextManifest: { files: [] },
    workspace: { uri: 'file:///tmp/tobe-worktree-1', revision: 'abc123' },
    ...overrides,
  };
}

async function startProxyServer(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rawBody: string
  ) => void | Promise<void>
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void Promise.resolve(
        handler(req, res, Buffer.concat(chunks).toString('utf8'))
      ).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('{"error":"internal"}');
        }
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

describe('HttpProxyExecutionRuntimeDriverV1', () => {
  test('fails closed when disabled without sending any request or leaking token', async () => {
    let called = false;
    const driver = new HttpProxyExecutionRuntimeDriverV1({
      enabled: false,
      endpoint: 'http://127.0.0.1:4100',
      token: 'super-secret-proxy-token',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
      transport: {
        async requestJson() {
          called = true;
          return { status: 200, body: {} };
        },
        async *streamNdjson() {
          called = true;
          yield {};
        },
      },
    });

    assert.equal(driver.getConfigurationState().state, 'disabled');
    assert.equal(driver.getConfigurationState().executable, false);

    assert.throws(
      () => driver.start(sampleStartInput()),
      (err: unknown) =>
        err instanceof HttpProxyRuntimeUnavailableError &&
        !err.message.includes('super-secret-proxy-token')
    );
    await assert.rejects(
      () =>
        driver.reconcile({
          jobId: 'job-1',
          attemptId: 'attempt-1',
          generation: 1,
          runtimeAttemptId: 'run-1',
        }),
      HttpProxyRuntimeUnavailableError
    );
    assert.equal(called, false);
  });

  test('enforces loopback-only default endpoint policy and HTTPS+token for remote opt-in', () => {
    const blockedRemote = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'https://proxy.example.com',
      token: 'secret-token',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
    });
    assert.equal(blockedRemote.getConfigurationState().state, 'unavailable');
    assert.equal(
      blockedRemote.getConfigurationState().issues[0]?.code,
      'remote-endpoint-disallowed'
    );

    const insecureRemote = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'http://proxy.example.com',
      allowRemoteEndpoint: true,
      token: 'secret-token',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
    });
    assert.equal(
      insecureRemote.getConfigurationState().issues[0]?.code,
      'remote-endpoint-requires-https'
    );

    const tokenlessRemote = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'https://proxy.example.com',
      allowRemoteEndpoint: true,
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
    });
    assert.equal(
      tokenlessRemote.getConfigurationState().issues[0]?.code,
      'remote-endpoint-requires-token'
    );

    const validRemote = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'https://proxy.example.com/runtime',
      allowRemoteEndpoint: true,
      token: 'secret-token',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
    });
    assert.equal(validRemote.getConfigurationState().state, 'ready');
    assert.equal(validRemote.getConfigurationState().executable, true);
  });

  test('rejects non-file or remote-host workspace URIs before sending HTTP requests', () => {
    let called = false;
    const driver = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'http://127.0.0.1:4100',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
      transport: {
        async requestJson() {
          called = true;
          return { status: 200, body: {} };
        },
        async *streamNdjson() {
          called = true;
          yield {};
        },
      },
    });

    assert.throws(
      () =>
        driver.start(
          sampleStartInput({ workspace: { uri: 'https://evil.example/repo' } })
        ),
      HttpProxyProtocolError
    );
    assert.throws(
      () =>
        driver.start(
          sampleStartInput({ workspace: { uri: 'file://remote-host/repo' } })
        ),
      HttpProxyProtocolError
    );
    assert.equal(called, false);
  });

  test('streams NDJSON events and completes start/resume/interrupt/reconcile/archive over real loopback HTTP', async () => {
    const seenPaths: string[] = [];
    let authHeader: string | undefined;
    const server = await startProxyServer((req, res) => {
      seenPaths.push(req.url ?? '');
      authHeader = req.headers.authorization;

      if (req.url === '/v1/execution/attempts/start') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(
          `${JSON.stringify({ type: 'attempt-started', runtimeAttemptId: 'run-42' })}\n`
        );
        res.write(`${JSON.stringify({ type: 'text-delta', text: 'hello ' })}\n`);
        res.write(
          `${JSON.stringify({ type: 'progress', message: 'working', percent: 50 })}\n`
        );
        res.write(
          `${JSON.stringify({ type: 'checkpoint', checkpointRef: 'cp-1' })}\n`
        );
        res.end(
          `${JSON.stringify({ type: 'attempt-completed', status: 'succeeded', message: 'done' })}\n`
        );
        return;
      }

      if (req.url === '/v1/execution/attempts/resume') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(
          `${JSON.stringify({ type: 'attempt-completed', status: 'succeeded' })}\n`
        );
        return;
      }

      if (req.url === '/v1/execution/attempts/interrupt') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ interrupted: true }));
        return;
      }

      if (req.url === '/v1/execution/attempts/reconcile') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            runtimeAttemptId: 'run-42',
            status: 'succeeded',
            checkpointRef: 'cp-1',
          })
        );
        return;
      }

      if (req.url === '/v1/execution/attempts/archive') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            artifacts: [
              {
                artifactId: 'art-1',
                kind: 'patch',
                uri: 'file:///tmp/art-1.diff',
              },
            ],
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end('{}');
    });

    try {
      const driver = new HttpProxyExecutionRuntimeDriverV1({
        enabled: true,
        endpoint: server.url,
        token: 'loopback-token',
        runtimeId: 'xar-proxy',
        displayName: 'XAR Loopback Proxy',
        runtimeVersion: '1.0.0',
        capabilities: BASE_CAPABILITIES,
      });

      const descriptor = await driver.describe();
      assert.equal(descriptor.runtimeId, 'xar-proxy');
      assert.equal(descriptor.schemaVersion, RUNTIME_CONTRACT_VERSION_V1);

      const events: RuntimeEventV1[] = [];
      for await (const event of driver.start(sampleStartInput())) {
        events.push(event);
      }
      assert.deepEqual(
        events.map((e) => e.type),
        [
          'attempt-started',
          'text-delta',
          'progress',
          'checkpoint',
          'attempt-completed',
        ]
      );
      assert.equal(authHeader, 'Bearer loopback-token');

      const resumed: RuntimeEventV1[] = [];
      for await (const event of driver.resume({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        generation: 2,
        runtimeAttemptId: 'run-42',
        checkpointRef: 'cp-1',
      })) {
        resumed.push(event);
      }
      assert.equal(resumed[0]?.type, 'attempt-completed');

      await driver.interrupt({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        generation: 2,
        runtimeAttemptId: 'run-42',
        reason: 'cancelled',
      });

      const snapshot = await driver.reconcile({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        generation: 2,
        runtimeAttemptId: 'run-42',
      });
      assert.equal(snapshot.status, 'succeeded');
      assert.equal(snapshot.checkpointRef, 'cp-1');

      const artifacts = await driver.archive({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        generation: 2,
        runtimeAttemptId: 'run-42',
      });
      assert.equal(artifacts.length, 1);
      assert.equal(artifacts[0]?.artifactId, 'art-1');

      assert.deepEqual(seenPaths, [
        '/v1/execution/attempts/start',
        '/v1/execution/attempts/resume',
        '/v1/execution/attempts/interrupt',
        '/v1/execution/attempts/reconcile',
        '/v1/execution/attempts/archive',
      ]);
    } finally {
      await server.close();
    }
  });

  test('fails closed on malformed events or duplicate terminal frames and aborts on early iterator return', async () => {
    let aborted = false;
    const driver = new HttpProxyExecutionRuntimeDriverV1({
      enabled: true,
      endpoint: 'http://127.0.0.1:4100',
      runtimeId: 'xar-proxy',
      runtimeVersion: '1.0.0',
      capabilities: BASE_CAPABILITIES,
      transport: {
        async requestJson() {
          return { status: 200, body: { runtimeAttemptId: 'run-1', status: 'bogus' } };
        },
        async *streamNdjson(req) {
          req.signal?.addEventListener('abort', () => {
            aborted = true;
          });
          if (req.path === '/v1/execution/attempts/start') {
            yield { type: 'attempt-started', runtimeAttemptId: 'run-1' };
            yield { type: 'attempt-completed', status: 'succeeded' };
            yield { type: 'text-delta', text: 'illegal trailing event' };
          } else {
            yield { type: 'attempt-started', runtimeAttemptId: 'run-2' };
            await new Promise<void>((resolve) => {
              req.signal?.addEventListener('abort', () => resolve(), {
                once: true,
              });
            });
          }
        },
      },
    });

    await assert.rejects(async () => {
      for await (const event of driver.start(sampleStartInput())) {
        void event;
      }
    }, HttpProxyProtocolError);

    await assert.rejects(
      () =>
        driver.reconcile({
          jobId: 'job-1',
          attemptId: 'attempt-1',
          generation: 1,
          runtimeAttemptId: 'run-1',
        }),
      HttpProxyProtocolError
    );

    const iterator = driver
      .resume({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        generation: 1,
        runtimeAttemptId: 'run-2',
      })
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.value?.type, 'attempt-started');
    await iterator.return?.();
    assert.equal(aborted, true);
  });
});
