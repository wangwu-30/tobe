import { expect, test } from '@playwright/test';
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

    expect(parseExecutionRoomEvent(event)).toEqual({
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
      expect(parsed === null).toBe(candidate !== jobStatus);
    }

    for (const field of ['requestId', 'inputRevision'] as const) {
      const payload = inputPayload(jobStatus);
      delete payload[field];
      expect(parseExecutionRoomEvent(roomEvent(type, payload))).toBeNull();
    }
  });
}

test('strictly parses terminal execution.completed variants', () => {
  for (const jobStatus of ['cancelled', 'failed', 'succeeded'] as const) {
    const payload = completedPayload(jobStatus);
    expect(parseExecutionRoomEvent(roomEvent('execution.completed', payload))).toEqual({
      data: payload,
      eventId: 'event-7',
      roomId: 'room-1',
      sequence: 7,
      type: 'execution.completed',
    });
  }

  for (const jobStatus of JOB_STATUSES.filter(
    (status) => !['cancelled', 'failed', 'succeeded'].includes(status)
  )) {
    expect(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', completedPayload(jobStatus))
      )
    ).toBeNull();
  }
});

test('accepts only a non-empty optional teamTaskId', () => {
  const payload = { ...completedPayload('succeeded'), teamTaskId: 'task-1' };
  expect(
    parseExecutionRoomEvent(roomEvent('execution.completed', payload))?.data
      .teamTaskId
  ).toBe('task-1');

  for (const teamTaskId of [null, '', '   ', 1]) {
    expect(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', {
          ...completedPayload('succeeded'),
          teamTaskId,
        })
      )
    ).toBeNull();
  }
});

test('rejects unrelated types, unknown fields, and cross-variant fields', () => {
  expect(
    parseExecutionRoomEvent(
      roomEvent('execution.started', completedPayload('succeeded'))
    )
  ).toBeNull();
  expect(
    parseExecutionRoomEvent(
      roomEvent('execution.completed', {
        ...completedPayload('succeeded'),
        extra: true,
      })
    )
  ).toBeNull();
  expect(
    parseExecutionRoomEvent(
      roomEvent('execution.completed', {
        ...completedPayload('succeeded'),
        inputRevision: 2,
        requestId: 'request-1',
      })
    )
  ).toBeNull();
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
    expect(
      parseExecutionRoomEvent(
        roomEvent('execution.completed', {
          ...completedPayload('succeeded'),
          [field]: value,
        })
      ),
      `${field}=${String(value)}`
    ).toBeNull();
  }
});

test('requires positive inputRevision and a non-empty requestId', () => {
  for (const inputRevision of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(
      parseExecutionRoomEvent(
        roomEvent('execution.input_requested', {
          ...inputPayload('waiting_input'),
          inputRevision,
        })
      )
    ).toBeNull();
  }
  for (const requestId of ['', '   ', null, 1]) {
    expect(
      parseExecutionRoomEvent(
        roomEvent('execution.input_requested', {
          ...inputPayload('waiting_input'),
          requestId,
        })
      )
    ).toBeNull();
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
