import type { RoomMessageEnvelopeV1 } from '../room-runtime/contracts';
import { ROOM_CONTEXT_CONTRACT_VERSION_V1 } from './contracts';
import type {
  RoomContextAclDecisionV1,
  RoomContextSummaryExpectationV1,
  RoomContextSummaryInvalidReasonV1,
  RoomContextSummaryV1,
} from './contracts';
import {
  hashRoomContextValueV1,
  sha256RoomContextV1,
  stableRoomContextJsonV1,
} from './hash';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
export type RoomContextSummaryValidationV1 =
  | { valid: true }
  | { valid: false; reason: RoomContextSummaryInvalidReasonV1 };

export class RoomContextSummarySourceErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomContextSummarySourceErrorV1';
  }
}

export function hashRoomContextSummaryMessagesV1(
  messages: readonly RoomMessageEnvelopeV1[]
): string {
  const sources = [...messages]
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        compareText(left.messageId, right.messageId)
    )
    .map((message) => message);

  return hashRoomContextValueV1(sources);
}

export function hashRoomContextAclSnapshotV1(
  decisions: readonly RoomContextAclDecisionV1[]
): string {
  return hashRoomContextValueV1(
    [...decisions]
      .map((decision) => stableRoomContextJsonV1(decision))
      .sort()
  );
}

export function createRoomContextSummaryExpectationV1(params: {
  messages: readonly RoomMessageEnvelopeV1[];
  aclDecisions: readonly RoomContextAclDecisionV1[];
}): RoomContextSummaryExpectationV1 {
  if (params.messages.length === 0) {
    throw new RoomContextSummarySourceErrorV1(
      'A Room context summary must cover at least one source message.'
    );
  }
  const sequences = params.messages.map((message) => message.sequence);
  if (
    sequences.some(
      (sequence) => !Number.isSafeInteger(sequence) || sequence < 0
    )
  ) {
    throw new RoomContextSummarySourceErrorV1(
      'Room context summary sequences must be non-negative safe integers.'
    );
  }
  return {
    fromSequence: Math.min(...sequences),
    throughSequence: Math.max(...sequences),
    sourceHash: hashRoomContextSummaryMessagesV1(params.messages),
    aclHash: hashRoomContextAclSnapshotV1(params.aclDecisions),
  };
}

export function createRoomContextSummaryV1(
  input: Omit<RoomContextSummaryV1, 'contentHash' | 'schemaVersion'>
): RoomContextSummaryV1 {
  return {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    ...input,
    source: { ...input.source },
    contentHash: sha256RoomContextV1(input.content),
  };
}

export function validateRoomContextSummaryV1(params: {
  summary: RoomContextSummaryV1;
  organizationId: string;
  roomId: string;
  currentSequence: number;
  configVersion: string;
  expectedSource: RoomContextSummaryExpectationV1;
}): RoomContextSummaryValidationV1 {
  const { summary, expectedSource } = params;

  if (summary.schemaVersion !== ROOM_CONTEXT_CONTRACT_VERSION_V1) {
    return { valid: false, reason: 'invalid-summary-version' };
  }

  if (
    summary.organizationId !== params.organizationId ||
    summary.roomId !== params.roomId
  ) {
    return { valid: false, reason: 'invalid-summary-room' };
  }

  if (!summary.summaryId.trim() || !summary.content.trim()) {
    return { valid: false, reason: 'invalid-summary-content' };
  }

  if (
    !SHA256_PATTERN.test(summary.contentHash) ||
    summary.contentHash !== sha256RoomContextV1(summary.content)
  ) {
    return { valid: false, reason: 'invalid-summary-content-hash' };
  }

  if (
    !Number.isSafeInteger(summary.source.fromSequence) ||
    !Number.isSafeInteger(summary.source.throughSequence) ||
    summary.source.fromSequence < 0 ||
    summary.source.throughSequence < summary.source.fromSequence ||
    summary.source.fromSequence !== expectedSource.fromSequence ||
    summary.source.throughSequence !== expectedSource.throughSequence
  ) {
    return { valid: false, reason: 'invalid-summary-sequence' };
  }

  if (summary.source.throughSequence >= params.currentSequence) {
    return { valid: false, reason: 'summary-not-before-current' };
  }

  if (
    !SHA256_PATTERN.test(summary.source.sourceHash) ||
    summary.source.sourceHash !== expectedSource.sourceHash
  ) {
    return { valid: false, reason: 'invalid-summary-source-hash' };
  }

  if (
    !SHA256_PATTERN.test(summary.source.aclHash) ||
    summary.source.aclHash !== expectedSource.aclHash
  ) {
    return { valid: false, reason: 'invalid-summary-acl-hash' };
  }

  if (summary.source.configVersion !== params.configVersion) {
    return { valid: false, reason: 'invalid-summary-config-version' };
  }

  return { valid: true };
}
