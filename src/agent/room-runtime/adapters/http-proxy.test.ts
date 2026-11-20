import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { describe } from 'node:test';

import {
  HttpProxyTransportError,
  type HttpProxyTransportV1,
} from '@/agent/runtime-proxy/http-transport';

import { ROOM_RUNTIME_CONTRACT_VERSION_V1 } from '../contracts';
import {
  collect,
  context,
  delivery,
  handleInput,
  message,
  openInput,
  policy,
  registerRoomSessionRuntimeComplianceSuiteV1,
  session,
  type RoomRuntimeComplianceBehaviorV1,
} from '../testing/compliance';
import {
  HttpProxyRoomRuntimeUnavailableError,
  HttpProxyRoomSessionRuntimeAdapterV1,
} from './http-proxy';

function createComplianceHarness(behavior: RoomRuntimeComplianceBehaviorV1) {
  let invocations = 0;
  let cancellations = 0;
  let idleWaits = 0;
  let sessionCounter = 0;

  const transport: HttpProxyTransportV1 = {
    async requestJson(req) {
      if (
        req.path === '/v1/room/sessions/open' ||
        req.path === '/v1/room/sessions/resume'
      ) {
        sessionCounter += 1;
        return {
          status: 200,
          body: { runtimeSessionId: `proxy-session-${sessionCounter}` },
        };
      }
      if (req.path === '/v1/room/sessions/checkpoint') {
        return {
          status: 200,
          body: { runtimeState: { mode: 'opaque-replay', version: 1 } },
        };
      }
      if (req.path === '/v1/room/sessions/cancel') {
        idleWaits += 1;
        return { status: 200, body: { settled: true } };
      }
      throw new HttpProxyTransportError(
        'proxy-http-error',
        `Unexpected path ${req.path}`,
        404
      );
    },
    async *streamNdjson(req) {
      invocations += 1;
      if (behavior === 'error') {
        throw new HttpProxyTransportError(
          'proxy-http-error',
          'Upstream runtime proxy unavailable.',
          503
        );
      }
      if (behavior === 'pending') {
        req.signal?.addEventListener(
          'abort',
          () => {
            cancellations += 1;
          },
          { once: true }
        );
        yield { type: 'response-started', responseId: 'resp-pending' };
        await new Promise<void>((resolve) => {
          req.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
        return;
      }

      yield { type: 'response-started', responseId: 'resp-1' };
      yield { type: 'text-delta', responseId: 'resp-1', text: 'Proxy ' };
      yield { type: 'text-delta', responseId: 'resp-1', text: 'answer.' };
      yield {
        type: 'message-ready',
        responseId: 'resp-1',
        message: {
          text: 'Proxy answer.',
          mentions: [],
          attachments: [],
        },
      };
      yield { type: 'delivery-completed', disposition: 'responded' };
    },
  };

  const runtime = new HttpProxyRoomSessionRuntimeAdapterV1({
    enabled: true,
    endpoint: 'http://127.0.0.1:4200',
    token: 'secret-api-key',
    runtimeId: 'http-proxy',
    runtimeVersion: '1.0.0',
    transport,
  });

  return {
    runtime,
    invocationCount: () => invocations,
    cancellationCount: () => cancellations,
    idleWaitCount: () => idleWaits,
  };
}

registerRoomSessionRuntimeComplianceSuiteV1('http-proxy', {
  create: createComplianceHarness,
  expectedResponseText: 'Proxy answer.',
  expectedRuntimeId: 'http-proxy',
});

describe('HttpProxyRoomSessionRuntimeAdapterV1 fail-closed invariants', () => {
  test('fails closed when disabled without calling transport or leaking token', async () => {
    let called = false;
    const adapter = new HttpProxyRoomSessionRuntimeAdapterV1({
      enabled: false,
      endpoint: 'http://127.0.0.1:4200',
      token: 'secret-room-token',
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

    assert.equal(adapter.getConfigurationState().state, 'disabled');
    await assert.rejects(
      () => adapter.open(openInput()),
      (err: unknown) =>
        err instanceof HttpProxyRoomRuntimeUnavailableError &&
        !err.message.includes('secret-room-token')
    );
    assert.equal(called, false);
  });

  test('fails closed on malformed remote Room events and refuses credential leakage in checkpoints', async () => {
    const adapter = new HttpProxyRoomSessionRuntimeAdapterV1({
      enabled: true,
      endpoint: 'http://127.0.0.1:4200',
      token: 'secret-api-key',
      transport: {
        async requestJson(req) {
          if (req.path === '/v1/room/sessions/open') {
            return { status: 200, body: { runtimeSessionId: 'rt-1' } };
          }
          if (req.path === '/v1/room/sessions/checkpoint') {
            return {
              status: 200,
              body: { runtimeState: { leaked: 'secret-api-key' } },
            };
          }
          return { status: 200, body: {} };
        },
        async *streamNdjson() {
          yield { type: 'response-started', responseId: 'r-1' };
          yield { type: 'message-ready', responseId: 'r-1', message: { text: 123 } };
        },
      },
    });

    const opened = await adapter.open(openInput());
    const events = await collect(adapter.handle(handleInput(opened.handle)));
    assert.equal(events.at(-1)?.event.type, 'error');
    assert.equal(
      events.some(({ event }) => event.type === 'message-ready'),
      false
    );

    await assert.rejects(
      () =>
        adapter.checkpoint({
          schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
          requestId: 'cp-leak',
          handle: opened.handle,
          cursor: { messageSequence: 1, deliverySequence: 1, eventSequence: 2 },
          reason: 'manual',
        }),
      /credentials/
    );
  });

  test('executes open, NDJSON handle, checkpoint, resume, and stale-handle fencing over real loopback HTTP', async () => {
    let counter = 0;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (
          req.url === '/v1/room/sessions/open' ||
          req.url === '/v1/room/sessions/resume'
        ) {
          counter += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ runtimeSessionId: `live-rt-${counter}` }));
          return;
        }
        if (req.url === '/v1/room/sessions/checkpoint') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ runtimeState: { cursor: 1 } }));
          return;
        }
        if (req.url === '/v1/room/sessions/handle') {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write(
            `${JSON.stringify({ type: 'response-started', responseId: 'live-r1' })}\n`
          );
          res.write(
            `${JSON.stringify({
              type: 'message-ready',
              responseId: 'live-r1',
              message: { text: 'Live loopback reply', mentions: [], attachments: [] },
            })}\n`
          );
          res.end(
            `${JSON.stringify({ type: 'delivery-completed', disposition: 'responded' })}\n`
          );
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;

    try {
      const adapter = new HttpProxyRoomSessionRuntimeAdapterV1({
        enabled: true,
        endpoint: `http://127.0.0.1:${address.port}`,
        token: 'loopback-room-token',
      });

      const opened = await adapter.open(openInput());
      const firstRun = await collect(adapter.handle(handleInput(opened.handle)));
      assert.equal(firstRun.at(-1)?.event.type, 'delivery-completed');

      const cp = await adapter.checkpoint({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: 'cp-live',
        handle: opened.handle,
        cursor: { messageSequence: 1, deliverySequence: 1, eventSequence: 3 },
        reason: 'handoff',
      });
      assert.equal(cp.status, 'created');
      if (cp.status !== 'created') throw new Error('Expected checkpoint.');

      const resumed = await adapter.resume({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: 'resume-live',
        session: session(),
        generation: 2,
        checkpoint: cp.checkpoint,
        context: context(),
        policy: policy(),
      });
      assert.equal(resumed.status, 'resumed');
      if (resumed.status !== 'resumed') throw new Error('Expected resumed.');

      const stale = await collect(
        adapter.handle(
          handleInput(opened.handle, {
            delivery: delivery({
              deliveryId: 'delivery-stale-live',
              deliverySequence: 2,
              message: message({ messageId: 'm2', sequence: 2 }),
            }),
          })
        )
      );
      assert.equal(stale.length, 1);
      assert.equal(stale[0]?.event.type, 'error');
      if (stale[0]?.event.type === 'error') {
        assert.equal(stale[0].event.code, 'stale-runtime-handle');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});
