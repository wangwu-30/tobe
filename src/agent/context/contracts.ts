import type {
  RoomActorRefV1,
  RoomMessageEnvelopeV1,
  RoomSessionRefV1,
} from '../room-runtime/contracts';

export const ROOM_CONTEXT_CONTRACT_VERSION_V1 = 1 as const;

export type RoomContextContractVersionV1 =
  typeof ROOM_CONTEXT_CONTRACT_VERSION_V1;

export type RoomContextCategoryV1 =
  | 'summary'
  | 'room-delta'
  | 'reply-chain'
  | 'document-slice'
  | 'retrieval-hit'
  | 'current-message';

export type RoomContextAclResourceV1 =
  | { type: 'room'; roomId: string }
  | { type: 'document'; documentId: string }
  | { type: 'knowledge'; sourceId: string };

/**
 * An ACL decision is evidence produced by the trusted control plane. Builders
 * recheck its principal and resource binding; an `allow` is never inferred
 * merely from organization membership.
 */
export type RoomContextAclDecisionV1 = {
  schemaVersion: RoomContextContractVersionV1;
  decision: 'allow' | 'deny';
  organizationId: string;
  principal: {
    type: 'room-agent-session';
    agentId: string;
    roomSessionId: string;
  };
  resource: RoomContextAclResourceV1;
  permission: 'context.read';
  policyVersion: string;
  authorizationRef?: string;
  reasonCode?: string;
};

export type RoomContextAllowedAclV1 = RoomContextAclDecisionV1 & {
  decision: 'allow';
};

/**
 * Trust and instruction use are separate. Participant, document, summary, and
 * retrieval text may be useful context while remaining unable to override
 * control-plane instructions.
 */
export type RoomContextTrustV1 = {
  schemaVersion: RoomContextContractVersionV1;
  level: 'trusted' | 'untrusted';
  origin:
    | 'control-plane'
    | 'room-participant'
    | 'derived-summary'
    | 'workspace-document'
    | 'retrieval';
  usage: 'control-instruction' | 'user-request' | 'data-only';
};

export type RoomContextSummarySourceV1 = {
  fromSequence: number;
  throughSequence: number;
  sourceHash: string;
  aclHash: string;
  configVersion: string;
};

export type RoomContextSummaryExpectationV1 = Omit<
  RoomContextSummarySourceV1,
  'configVersion'
>;

export type RoomContextSummaryV1 = {
  schemaVersion: RoomContextContractVersionV1;
  summaryId: string;
  organizationId: string;
  roomId: string;
  content: string;
  contentHash: string;
  source: RoomContextSummarySourceV1;
};

export type RoomContextMessageInputV1 = {
  message: RoomMessageEnvelopeV1;
  acl: RoomContextAclDecisionV1;
};

export type RoomContextSummaryInputV1 = {
  summary: RoomContextSummaryV1;
  expectedSource: RoomContextSummaryExpectationV1;
  acl: RoomContextAclDecisionV1;
};

export type RoomContextDocumentSliceInputV1 = {
  sliceId: string;
  documentId: string;
  revision: string;
  title?: string;
  start: number;
  end: number;
  content: string;
  relevanceScore: number;
  acl: RoomContextAclDecisionV1;
};

export type RoomContextRetrievalHitInputV1 = {
  hitId: string;
  rank: number;
  score: number;
  indexId: string;
  indexVersion: string;
  content: string;
  source:
    | {
        type: 'document';
        id: string;
        revision?: string;
        title?: string;
      }
    | {
        type: 'knowledge';
        id: string;
        revision?: string;
        title?: string;
      };
  acl: RoomContextAclDecisionV1;
};

export type RoomMessageContextProvenanceV1 = {
  schemaVersion: RoomContextContractVersionV1;
  sourceType: 'room-message';
  sourceId: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  createdAt: string;
  actor: RoomActorRefV1;
  replyToMessageId?: string;
  contentHash: string;
};

export type RoomSummaryContextProvenanceV1 = {
  schemaVersion: RoomContextContractVersionV1;
  sourceType: 'room-summary';
  sourceId: string;
  organizationId: string;
  roomId: string;
  fromSequence: number;
  throughSequence: number;
  sourceHash: string;
  aclHash: string;
  configVersion: string;
  contentHash: string;
};

export type DocumentSliceContextProvenanceV1 = {
  schemaVersion: RoomContextContractVersionV1;
  sourceType: 'document-slice';
  sourceId: string;
  documentId: string;
  revision: string;
  title?: string;
  start: number;
  end: number;
  relevanceScore: number;
  contentHash: string;
};

export type RetrievalHitContextProvenanceV1 = {
  schemaVersion: RoomContextContractVersionV1;
  sourceType: 'retrieval-hit';
  sourceId: string;
  rank: number;
  score: number;
  indexId: string;
  indexVersion: string;
  referencedSource: RoomContextRetrievalHitInputV1['source'];
  contentHash: string;
};

export type RoomContextSourceProvenanceV1 =
  | RoomMessageContextProvenanceV1
  | RoomSummaryContextProvenanceV1
  | DocumentSliceContextProvenanceV1
  | RetrievalHitContextProvenanceV1;

export type RoomContextBlockV1 = {
  schemaVersion: RoomContextContractVersionV1;
  blockId: string;
  category: RoomContextCategoryV1;
  contentType: 'text/plain';
  content: string;
  contentHash: string;
  source: RoomContextSourceProvenanceV1;
  acl: RoomContextAllowedAclV1;
  aclHash: string;
  trust: RoomContextTrustV1;
  truncation: {
    unit: 'utf16-code-unit';
    originalCharacters: number;
    includedCharacters: number;
    truncated: boolean;
  };
};

export type RoomContextCategoryBudgetV1 = {
  maxCharacters: number;
  maxBlocks: number;
};

export type RoomContextBudgetConfigV1 = {
  schemaVersion: RoomContextContractVersionV1;
  configVersion: string;
  summaryConfigVersion: string;
  maxTotalCharacters: number;
  maxTotalBlocks: number;
  categories: Readonly<
    Record<RoomContextCategoryV1, RoomContextCategoryBudgetV1>
  >;
};

export type RoomContextCategoryBudgetUsageV1 = RoomContextCategoryBudgetV1 & {
  consideredBlocks: number;
  includedBlocks: number;
  excludedBlocks: number;
  truncatedBlocks: number;
  usedCharacters: number;
};

export type RoomContextBudgetUsageV1 = {
  schemaVersion: RoomContextContractVersionV1;
  unit: 'utf16-code-unit';
  maxTotalCharacters: number;
  maxTotalBlocks: number;
  usedCharacters: number;
  includedBlocks: number;
  categories: Readonly<
    Record<RoomContextCategoryV1, RoomContextCategoryBudgetUsageV1>
  >;
};

export type RoomContextSummaryInvalidReasonV1 =
  | 'invalid-summary-version'
  | 'invalid-summary-room'
  | 'invalid-summary-content'
  | 'invalid-summary-content-hash'
  | 'invalid-summary-sequence'
  | 'invalid-summary-source-hash'
  | 'invalid-summary-acl-hash'
  | 'invalid-summary-config-version'
  | 'summary-not-before-current';

export type RoomContextExclusionReasonV1 =
  | RoomContextSummaryInvalidReasonV1
  | 'acl-denied'
  | 'acl-binding-mismatch'
  | 'invalid-source'
  | 'duplicate-source'
  | 'not-reply-ancestor'
  | 'invalid-reply-chain'
  | 'message-not-before-current'
  | 'covered-by-summary'
  | 'category-block-budget'
  | 'category-character-budget'
  | 'total-block-budget'
  | 'total-character-budget';

export type RoomContextTraceSelectionV1 = {
  category: RoomContextCategoryV1;
  blockId: string;
  sourceId: string;
  sourceHash: string;
  blockHash: string;
  originalCharacters: number;
  includedCharacters: number;
  truncated: boolean;
};

/** Exclusions are aggregated so diagnostic output is itself bounded. */
export type RoomContextTraceExclusionV1 = {
  category: RoomContextCategoryV1;
  reason: RoomContextExclusionReasonV1;
  count: number;
};

export type RoomContextTraceV1 = {
  schemaVersion: RoomContextContractVersionV1;
  traceType: 'room.context-build';
  builderConfigVersion: string;
  summaryConfigVersion: string;
  throughMessageSequence: number;
  selections: readonly RoomContextTraceSelectionV1[];
  exclusions: readonly RoomContextTraceExclusionV1[];
  budget: RoomContextBudgetUsageV1;
  contextHash: string;
  traceHash: string;
};

export type BuildRoomContextInputV1 = {
  session: RoomSessionRefV1;
  currentMessage: RoomContextMessageInputV1;
  /** Relevant delta only. There is deliberately no full-history input. */
  relevantRoomDelta?: readonly RoomContextMessageInputV1[];
  /** Candidate ancestors; the builder follows reply ids rather than input order. */
  replyChain?: readonly RoomContextMessageInputV1[];
  documentSlices?: readonly RoomContextDocumentSliceInputV1[];
  summary?: RoomContextSummaryInputV1;
  retrievalHits?: readonly RoomContextRetrievalHitInputV1[];
  budget?: RoomContextBudgetConfigV1;
};

export type RoomContextBuildResultV1 = {
  schemaVersion: RoomContextContractVersionV1;
  contextType: 'room.context';
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  agentId: string;
  throughMessageSequence: number;
  blocks: readonly RoomContextBlockV1[];
  trace: RoomContextTraceV1;
};

export interface RoomContextPortV1 {
  build(input: BuildRoomContextInputV1): RoomContextBuildResultV1;
}
export type RoomContextBuilderPortV1 = RoomContextPortV1;
