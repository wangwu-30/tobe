export const ROOM_RUNTIME_CONTRACT_VERSION_V1 = 1 as const;

export type RoomRuntimeContractVersionV1 =
  typeof ROOM_RUNTIME_CONTRACT_VERSION_V1;

export type RoomJsonValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly RoomJsonValueV1[]
  | {
      readonly [key: string]: RoomJsonValueV1;
    };

export type RoomAgentRefV1 = {
  agentId: string;
  displayName?: string;
  handle: string;
};

export type RoomActorRefV1 =
  | {
      type: 'human';
      userId: string;
      displayName?: string;
    }
  | ({
      type: 'agent';
    } & RoomAgentRefV1)
  | {
      type: 'system';
      systemId: string;
    };

/**
 * Offsets use JavaScript UTF-16 string indexes and `end` is exclusive.
 */
export type RoomTextRangeV1 = {
  start: number;
  end: number;
};

/**
 * A mention is routing data, not text inferred by a runtime. The control plane
 * must validate the target and range before creating deliveries from it.
 */
export type RoomAgentMentionV1 = {
  type: 'agent';
  agentId: string;
  handle: string;
  range: RoomTextRangeV1;
};

export type RoomAttachmentRefV1 = {
  attachmentId: string;
  mediaType: string;
  name?: string;
  uri?: string;
};

export type RoomMessageEnvelopeV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  envelopeType: 'room.message';
  messageId: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  createdAt: string;
  actor: RoomActorRefV1;
  text: string;
  mentions: readonly RoomAgentMentionV1[];
  attachments: readonly RoomAttachmentRefV1[];
  replyToMessageId?: string;
  correlationId?: string;
  metadata?: RoomJsonValueV1;
};

export type RoomMentionableAgentV1 = RoomAgentRefV1 & {
  enabled: boolean;
};

export type RoomDelegationInvocationV1 = {
  invocationId: string;
  rootMessageId: string;
  fromAgentId: string;
  targetAgentId: string;
};

/**
 * `lineage` is the current delegation branch, starting with the first agent.
 * `invocations` is the root-message-wide ledger and must be serialized or
 * atomically merged by the control plane when branches delegate concurrently.
 */
export type RoomDelegationTraceV1 = {
  rootMessageId: string;
  lineage: readonly string[];
  invocations: readonly RoomDelegationInvocationV1[];
};

export type RoomDeliveryIntentV1 = 'observe' | 'respond';

export type RoomDeliveryCauseV1 =
  | {
      type: 'typed-mention';
      mentionIndexes: readonly number[];
    }
  | {
      type: 'delegation';
      invocation: RoomDelegationInvocationV1;
      trace: RoomDelegationTraceV1;
    }
  | {
      type: 'room-observation';
    }
  | {
      type: 'system';
      reason: string;
    };

/**
 * Delivery identity is the idempotency boundary. Retrying a delivery keeps
 * `deliveryId` and increments `attempt`.
 */
export type RoomDeliveryEnvelopeV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  envelopeType: 'room.delivery';
  deliveryId: string;
  roomSessionId: string;
  deliverySequence: number;
  attempt: number;
  createdAt: string;
  target: RoomAgentRefV1;
  intent: RoomDeliveryIntentV1;
  cause: RoomDeliveryCauseV1;
  message: RoomMessageEnvelopeV1;
};

export type RoomSessionCursorV1 = {
  messageSequence: number;
  deliverySequence: number;
  eventSequence: number;
};

export type RoomSessionRefV1 = {
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  /** Immutable AgentProfile config snapshot selected for this session generation. */
  agentConfigVersion: string;
  agent: RoomAgentRefV1;
};

export type RoomSessionRuntimeHandleV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  session: RoomSessionRefV1;
  runtimeId: string;
  runtimeSessionId: string;
  generation: number;
  openedAt: string;
};

/**
 * Runtime checkpoint state is deliberately opaque but JSON-compatible. A
 * checkpoint can be persisted without importing a provider SDK or executable
 * runtime type into the control plane.
 */
export type RoomSessionCheckpointEnvelopeV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  envelopeType: 'room.checkpoint';
  checkpointId: string;
  createdAt: string;
  session: RoomSessionRefV1;
  runtimeId: string;
  runtimeVersion: string;
  runtimeSessionId: string;
  generation: number;
  cursor: RoomSessionCursorV1;
  runtimeState: RoomJsonValueV1;
};

export type RoomQuietHostPolicyV1 = {
  mode: 'quiet-host';
  hostAgentId: string;
  unmentionedHostAction: 'observe';
};

export type RoomDelegationPolicyV1 = {
  enabled: boolean;
  maxHops: number;
  maxInvocations: number;
};

export type RoomPolicyV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  participation: RoomQuietHostPolicyV1;
  delegation: RoomDelegationPolicyV1;
};

export type RoomContextReferenceV1 = {
  type: string;
  id: string;
  revision?: string;
  title?: string;
};

export type RoomContextSnapshotV1 = {
  throughMessageSequence: number;
  messages: readonly RoomMessageEnvelopeV1[];
  summary?: string;
  references?: readonly RoomContextReferenceV1[];
};

export type RoomRuntimeStreamingV1 =
  | 'final-only'
  | 'text-delta'
  | 'typed-events';

export type RoomRuntimeResumeV1 = 'none' | 'checkpoint' | 'native';
export type RoomRuntimeCheckpointV1 = 'none' | 'opaque-json';

export type RoomSessionRuntimeCapabilitiesV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  streaming: RoomRuntimeStreamingV1;
  resume: RoomRuntimeResumeV1;
  checkpoint: RoomRuntimeCheckpointV1;
  typedMentionOutput: boolean;
  delegationRequests: boolean;
};

export type RoomSessionRuntimeDescriptorV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  runtimeId: string;
  displayName: string;
  runtimeVersion: string;
  capabilities: RoomSessionRuntimeCapabilitiesV1;
};

export type OpenRoomSessionInputV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  requestId: string;
  session: RoomSessionRefV1;
  generation: number;
  context: RoomContextSnapshotV1;
  policy: RoomPolicyV1;
};

export type OpenRoomSessionResultV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  handle: RoomSessionRuntimeHandleV1;
};

export type ResumeRoomSessionInputV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  requestId: string;
  session: RoomSessionRefV1;
  generation: number;
  checkpoint: RoomSessionCheckpointEnvelopeV1;
  context: RoomContextSnapshotV1;
  policy: RoomPolicyV1;
};

export type ResumeRoomSessionResultV1 =
  | {
      schemaVersion: RoomRuntimeContractVersionV1;
      status: 'resumed';
      handle: RoomSessionRuntimeHandleV1;
    }
  | {
      schemaVersion: RoomRuntimeContractVersionV1;
      status: 'unsupported';
      reason: string;
    };

export type HandleRoomDeliveryInputV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  handle: RoomSessionRuntimeHandleV1;
  delivery: RoomDeliveryEnvelopeV1;
  policy: RoomPolicyV1;
};

export type CheckpointRoomSessionInputV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  requestId: string;
  handle: RoomSessionRuntimeHandleV1;
  cursor: RoomSessionCursorV1;
  reason: 'idle' | 'handoff' | 'shutdown' | 'manual';
};

export type CheckpointRoomSessionResultV1 =
  | {
      schemaVersion: RoomRuntimeContractVersionV1;
      status: 'created';
      checkpoint: RoomSessionCheckpointEnvelopeV1;
    }
  | {
      schemaVersion: RoomRuntimeContractVersionV1;
      status: 'unsupported';
      reason: string;
    };

export type RoomRuntimeOutputDraftV1 = {
  text: string;
  mentions: readonly RoomAgentMentionV1[];
  attachments?: readonly RoomAttachmentRefV1[];
};

export type RoomToolConfirmationRequestV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  requestType: 'room.tool-confirmation';
  requestId: string;
  expiresAt: string;
  toolCallId: string;
  toolName: string;
  parameters: RoomJsonValueV1;
  safetyLevel: 'safe' | 'confirm' | 'privileged';
  writePolicy:
    | 'read-only'
    | 'organization-scoped-append'
    | 'workspace-write'
    | 'privileged-write';
};

export type RoomRuntimeEventPayloadV1 =
  | {
      type: 'session-ready';
    }
  | {
      type: 'response-started';
      responseId: string;
    }
  | {
      type: 'text-delta';
      responseId: string;
      text: string;
    }
  | {
      type: 'message-ready';
      responseId: string;
      message: RoomRuntimeOutputDraftV1;
    }
  | {
      type: 'delegation-requested';
      invocation: RoomDelegationInvocationV1;
      instruction?: string;
    }
  | {
      type: 'room.tool_confirmation.requested';
      request: RoomToolConfirmationRequestV1;
    }
  | {
      type: 'checkpoint-ready';
      checkpoint: RoomSessionCheckpointEnvelopeV1;
    }
  | {
      type: 'delivery-completed';
      disposition: 'responded' | 'observed' | 'ignored';
    }
  | {
      type: 'error';
      code: string;
      message: string;
      retryable: boolean;
    };

export type RoomRuntimeEventEnvelopeV1 = {
  schemaVersion: RoomRuntimeContractVersionV1;
  envelopeType: 'room.runtime-event';
  eventId: string;
  eventSequence: number;
  occurredAt: string;
  roomSessionId: string;
  runtimeSessionId: string;
  deliveryId?: string;
  event: RoomRuntimeEventPayloadV1;
};

/**
 * Runtime-neutral boundary implemented by conversational session adapters.
 * Calls for one room session are serialized by the control plane.
 */
export interface RoomSessionRuntimePortV1 {
  describe(): Promise<RoomSessionRuntimeDescriptorV1>;

  open(input: OpenRoomSessionInputV1): Promise<OpenRoomSessionResultV1>;

  resume(
    input: ResumeRoomSessionInputV1
  ): Promise<ResumeRoomSessionResultV1>;

  handle(
    input: HandleRoomDeliveryInputV1
  ): AsyncIterable<RoomRuntimeEventEnvelopeV1>;

  checkpoint(
    input: CheckpointRoomSessionInputV1
  ): Promise<CheckpointRoomSessionResultV1>;
}
