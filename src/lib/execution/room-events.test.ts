import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomEventDtoV1 } from '@/objects/room';

import { parseExecutionRoomEvent } from './room-events';

const OCCURRED_AT = '2026-08-21T12:34:56.000Z';
const JOB_STATUSES = [
  'queued',
  'blocked',
  'running',
  'waiting_input',
  'cancel_requested',
  'cancelled',
  'succeeded',
  'failed',
] as const;

const inputCases = [
  ['execution.input_requested', 'waiting_input'],
  ['execution.input_answered', 'queued'],
  ['execution.input_cancelled', 'cancelled'],
] as const;

for (const [type, jobStatus] of inputCases) {
  test(`strictly parses ${type}`, () => {
    const event = roomEvent(type, inputPayload(jobStatus));

    assert.deepEqual(parseExecutionRoomEvent(event), {
      data: inputPayload(jobStatus),
      eventId: 'event-7',
      roomId: 'room-1',
      sequence: 7,
      type,
    });
  });

  test(`${type} requires its exact status and request fields`, () => {
    for (const candidate of JOB_STATUSES) {
      const parsed = parseExecutionRoomEvent(
        roomEvent(type, inputPayload(candidate))
      );
      assert.equal(parsed === null, candidate !== jobStatus);
    }

    for (const field of ['requestId', 'inputRevision'] as const) {
      const payload = inputPayload(jobStatus);
      delete payload[field];
      assert.equal(parseExecutionRoomEvent(roomEvent(type, payload)), null);
    }
  });
}

test('strictly parses terminal execution.completed variants', () => {
  for (const jobStatus of ['cancelled', 'failed', 'succeeded'] as const) {
    const payload = completedPayload(jobStatus);
    assert.deepEqual(
      parseExecutionRoomEvent(roomEvent('execution.completed', payload)),
      {
        data: payload,
        eventId: 'event-7',
        roomId: 'room-1',
        sequence: 7,
        type: 'execution.completed',
      }
    );
  }

  for (const jobStatus of JOB_STATUSES.filter(
    (status) => !['cancelled', 'failed', 'succeeded'].includes(status)
  )) {
    assert.equal(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', completedPayload(jobStatus))
      ),
      null
    );
  }
});

test('accepts only a non-empty optional teamTaskId', () => {
  const payload = { ...completedPayload('succeeded'), teamTaskId: 'task-1' };
  assert.equal(
    parseExecutionRoomEvent(roomEvent('execution.completed', payload))?.data
      .teamTaskId,
    'task-1'
  );

  for (const teamTaskId of [null, '', '   ', 1]) {
    assert.equal(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', {
          ...completedPayload('succeeded'),
          teamTaskId,
        })
      ),
      null
    );
  }
});

test('rejects unrelated types, unknown fields, and cross-variant fields', () => {
  assert.equal(
    parseExecutionRoomEvent(
      roomEvent('execution.started', completedPayload('succeeded'))
    ),
    null
  );
  assert.equal(
    parseExecutionRoomEvent(
      roomEvent('execution.completed', {
        ...completedPayload('succeeded'),
        extra: true,
      })
    ),
    null
  );
  assert.equal(
    parseExecutionRoomEvent(
      roomEvent('execution.completed', {
        ...completedPayload('succeeded'),
        inputRevision: 2,
        requestId: 'request-1',
      })
    ),
    null
  );
});

test('rejects malformed common payload fields', () => {
  const invalidValues: Array<[string, unknown]> = [
    ['schemaVersion', 2],
    ['schemaVersion', '1'],
    ['jobId', ''],
    ['jobId', '   '],
    ['jobId', null],
    ['jobRevision', 0],
    ['jobRevision', -1],
    ['jobRevision', 1.5],
    ['jobRevision', Number.MAX_SAFE_INTEGER + 1],
    ['occurredAt', '2026-08-21'],
    ['occurredAt', '2026-08-21T12:34:56Z'],
    ['occurredAt', '2026-08-21T14:34:56.000+02:00'],
    ['occurredAt', 'not-a-date'],
  ];

  for (const [field, value] of invalidValues) {
    assert.equal(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', {
          ...completedPayload('succeeded'),
          [field]: value,
        })
      ),
      null,
      `${field}=${String(value)}`
    );
  }
});

test('requires positive inputRevision and a non-empty requestId', () => {
  for (const inputRevision of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    assert.equal(
      parseExecutionRoomEvent(
        roomEvent('execution.input_requested', {
          ...inputPayload('waiting_input'),
          inputRevision,
        })
      ),
      null
    );
  }
  for (const requestId of ['', '   ', null, 1]) {
    assert.equal(
      parseExecutionRoomEvent(
        roomEvent('execution.input_requested', {
          ...inputPayload('waiting_input'),
          requestId,
        })
      ),
      null
    );
  }
});

function roomEvent(type: string, data: unknown): RoomEventDtoV1 {
  return {
    createdAt: OCCURRED_AT,
    data: data as RoomEventDtoV1['data'],
    eventId: 'event-7',
    organizationId: 'org-1',
    roomId: 'room-1',
    schemaVersion: 1,
    sequence: 7,
    type,
  };
}

function commonPayload(jobStatus: string) {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    jobStatus,
    jobRevision: 4,
    occurredAt: OCCURRED_AT,
  };
}

function inputPayload(jobStatus: string) {
  return {
    ...commonPayload(jobStatus),
    requestId: 'request-1',
    inputRevision: 2,
  };
}

function completedPayload(jobStatus: string) {
  return commonPayload(jobStatus);
}
