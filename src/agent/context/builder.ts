import {
  DEFAULT_ROOM_CONTEXT_BUDGET_V1,
  ROOM_CONTEXT_CATEGORIES_V1,
  createRoomContextBudgetUsageV1,
  validateRoomContextBudgetV1,
} from './budget';
import {
  ROOM_CONTEXT_CONTRACT_VERSION_V1,
  type BuildRoomContextInputV1,
  type DocumentSliceContextProvenanceV1,
  type RetrievalHitContextProvenanceV1,
  type RoomContextAclDecisionV1,
  type RoomContextAllowedAclV1,
  type RoomContextBlockV1,
  type RoomContextBuildResultV1,
  type RoomContextCategoryV1,
  type RoomContextExclusionReasonV1,
  type RoomContextSourceProvenanceV1,
  type RoomContextTraceExclusionV1,
  type RoomContextTraceSelectionV1,
  type RoomContextTrustV1,
  type RoomMessageContextProvenanceV1,
  type RoomSummaryContextProvenanceV1,
} from './contracts';
import { hashRoomContextValueV1, sha256RoomContextV1 } from './hash';
import { validateRoomContextSummaryV1 } from './summary';
import { ROOM_RUNTIME_CONTRACT_VERSION_V1 } from '../room-runtime/contracts';
import type { RoomActorRefV1 } from '../room-runtime/contracts';
import type {
  RoomContextAclResourceV1,
  RoomContextBudgetConfigV1,
  RoomContextBudgetUsageV1,
  RoomContextDocumentSliceInputV1,
  RoomContextMessageInputV1,
  RoomContextRetrievalHitInputV1,
} from './contracts';

type Candidate = {
  category: RoomContextCategoryV1;
  dedupeKey: string;
  sourceId: string;
  content: string;
  source: RoomContextSourceProvenanceV1;
  acl: RoomContextAllowedAclV1;
  trust: RoomContextTrustV1;
  displayOrder: readonly (number | string)[];
};

const ALLOCATION_ORDER = [
  'current-message',
  'summary',
  'reply-chain',
  'room-delta',
  'document-slice',
  'retrieval-hit',
] as const satisfies readonly RoomContextCategoryV1[];

const DISPLAY_CATEGORY_ORDER = new Map(
  ROOM_CONTEXT_CATEGORIES_V1.map((category, index) => [category, index])
);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function cloneActor(actor: RoomActorRefV1): RoomActorRefV1 {
  return { ...actor };
}

function cloneAllowedAcl(
  acl: RoomContextAllowedAclV1
): RoomContextAllowedAclV1 {
  return {
    ...acl,
    principal: { ...acl.principal },
    resource: { ...acl.resource },
  };
}

export class RoomContextBuildErrorV1 extends Error {
  readonly code:
    | 'invalid-current-message'
    | 'current-message-access-denied'
    | 'current-message-acl-mismatch';

  constructor(code: RoomContextBuildErrorV1['code'], message: string) {
    super(message);
    this.name = 'RoomContextBuildErrorV1';
    this.code = code;
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidMessageInput(
  input: RoomContextMessageInputV1,
  session: BuildRoomContextInputV1['session'],
  beforeSequence?: number
): boolean {
  const message = input.message;
  return (
    message.schemaVersion === ROOM_RUNTIME_CONTRACT_VERSION_V1 &&
    message.envelopeType === 'room.message' &&
    nonEmpty(message.messageId) &&
    message.organizationId === session.organizationId &&
    message.roomId === session.roomId &&
    Number.isSafeInteger(message.sequence) &&
    message.sequence >= 0 &&
    (beforeSequence === undefined || message.sequence < beforeSequence) &&
    typeof message.text === 'string'
  );
}

function resourceMatches(
  actual: RoomContextAclResourceV1,
  expected: RoomContextAclResourceV1
): boolean {
  if (actual.type !== expected.type) return false;
  if (actual.type === 'room' && expected.type === 'room') {
    return actual.roomId === expected.roomId;
  }
  if (actual.type === 'document' && expected.type === 'document') {
    return actual.documentId === expected.documentId;
  }
  return (
    actual.type === 'knowledge' &&
    expected.type === 'knowledge' &&
    actual.sourceId === expected.sourceId
  );
}

function aclResult(
  acl: RoomContextAclDecisionV1,
  input: BuildRoomContextInputV1,
  resource: RoomContextAclResourceV1
): 'allowed' | 'denied' | 'mismatch' {
  if (acl.decision === 'deny') return 'denied';
  return acl.schemaVersion === ROOM_CONTEXT_CONTRACT_VERSION_V1 &&
    acl.organizationId === input.session.organizationId &&
    acl.permission === 'context.read' &&
    acl.principal.type === 'room-agent-session' &&
    acl.principal.agentId === input.session.agent.agentId &&
    acl.principal.roomSessionId === input.session.roomSessionId &&
    nonEmpty(acl.policyVersion) &&
    resourceMatches(acl.resource, resource)
    ? 'allowed'
    : 'mismatch';
}

function messageTrust(
  input: RoomContextMessageInputV1,
  current: boolean
): RoomContextTrustV1 {
  if (input.message.actor.type === 'system') {
    return {
      schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
      level: 'trusted',
      origin: 'control-plane',
      usage: 'control-instruction',
    };
  }
  return {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    level: 'untrusted',
    origin: 'room-participant',
    usage: current ? 'user-request' : 'data-only',
  };
}

function messageCandidate(
  input: RoomContextMessageInputV1,
  category: 'current-message' | 'reply-chain' | 'room-delta'
): Candidate {
  const { message } = input;
  const contentHash = sha256RoomContextV1(message.text);
  const source: RoomMessageContextProvenanceV1 = {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    sourceType: 'room-message',
    sourceId: message.messageId,
    organizationId: message.organizationId,
    roomId: message.roomId,
    sequence: message.sequence,
    createdAt: message.createdAt,
    actor: cloneActor(message.actor),
    ...(message.replyToMessageId
      ? { replyToMessageId: message.replyToMessageId }
      : {}),
    contentHash,
  };
  return {
    category,
    dedupeKey: `room-message:${message.messageId}`,
    sourceId: message.messageId,
    content: message.text,
    source,
    acl: cloneAllowedAcl(input.acl as RoomContextAllowedAclV1),
    trust: messageTrust(input, category === 'current-message'),
    displayOrder: [message.sequence, message.messageId],
  };
}

function documentCandidate(input: RoomContextDocumentSliceInputV1): Candidate {
  const contentHash = sha256RoomContextV1(input.content);
  const source: DocumentSliceContextProvenanceV1 = {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    sourceType: 'document-slice',
    sourceId: input.sliceId,
    documentId: input.documentId,
    revision: input.revision,
    ...(input.title ? { title: input.title } : {}),
    start: input.start,
    end: input.end,
    relevanceScore: input.relevanceScore,
    contentHash,
  };
  return {
    category: 'document-slice',
    dedupeKey: `document:${input.documentId}:${input.revision}:${input.start}:${input.end}`,
    sourceId: input.sliceId,
    content: input.content,
    source,
    acl: cloneAllowedAcl(input.acl as RoomContextAllowedAclV1),
    trust: {
      schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
      level: 'untrusted',
      origin: 'workspace-document',
      usage: 'data-only',
    },
    displayOrder: [input.documentId, input.start, input.end, input.sliceId],
  };
}

function retrievalCandidate(input: RoomContextRetrievalHitInputV1): Candidate {
  const contentHash = sha256RoomContextV1(input.content);
  const source: RetrievalHitContextProvenanceV1 = {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    sourceType: 'retrieval-hit',
    sourceId: input.hitId,
    rank: input.rank,
    score: input.score,
    indexId: input.indexId,
    indexVersion: input.indexVersion,
    referencedSource: { ...input.source },
    contentHash,
  };
  return {
    category: 'retrieval-hit',
    dedupeKey: `retrieval:${input.hitId}`,
    sourceId: input.hitId,
    content: input.content,
    source,
    acl: cloneAllowedAcl(input.acl as RoomContextAllowedAclV1),
    trust: {
      schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
      level: 'untrusted',
      origin: 'retrieval',
      usage: 'data-only',
    },
    displayOrder: [input.rank, input.hitId],
  };
}

function compareTuple(
  left: readonly (number | string)[],
  right: readonly (number | string)[]
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return compareText(String(a), String(b));
  }
  return 0;
}

function validDocumentSlice(input: RoomContextDocumentSliceInputV1): boolean {
  return (
    nonEmpty(input.sliceId) &&
    nonEmpty(input.documentId) &&
    nonEmpty(input.revision) &&
    Number.isSafeInteger(input.start) &&
    Number.isSafeInteger(input.end) &&
    input.start >= 0 &&
    input.end >= input.start &&
    input.end - input.start === input.content.length &&
    Number.isFinite(input.relevanceScore)
  );
}

function validRetrievalHit(input: RoomContextRetrievalHitInputV1): boolean {
  return (
    nonEmpty(input.hitId) &&
    Number.isSafeInteger(input.rank) &&
    input.rank >= 0 &&
    Number.isFinite(input.score) &&
    nonEmpty(input.indexId) &&
    nonEmpty(input.indexVersion) &&
    nonEmpty(input.source.type) &&
    nonEmpty(input.source.id) &&
    typeof input.content === 'string'
  );
}

function retrievalResource(
  input: RoomContextRetrievalHitInputV1
): RoomContextAclResourceV1 {
  return input.source.type === 'document'
    ? { type: 'document', documentId: input.source.id }
    : { type: 'knowledge', sourceId: input.source.id };
}

export function buildRoomContextV1(
  input: BuildRoomContextInputV1
): RoomContextBuildResultV1 {
  const budget = validateRoomContextBudgetV1(
    input.budget ?? DEFAULT_ROOM_CONTEXT_BUDGET_V1
  );
  const usage = createRoomContextBudgetUsageV1(budget);
  const exclusionCounts = new Map<string, number>();
  const candidates = new Map<RoomContextCategoryV1, Candidate[]>(
    ROOM_CONTEXT_CATEGORIES_V1.map((category) => [category, []])
  );

  const exclude = (
    category: RoomContextCategoryV1,
    reason: RoomContextExclusionReasonV1,
    count = 1
  ) => {
    const key = `${category}\u0000${reason}`;
    exclusionCounts.set(key, (exclusionCounts.get(key) ?? 0) + count);
    usage.categories[category].excludedBlocks += count;
  };
  const consider = (category: RoomContextCategoryV1, count = 1) => {
    usage.categories[category].consideredBlocks += count;
  };
  const add = (candidate: Candidate) => candidates.get(candidate.category)?.push(candidate);

  if (!isValidMessageInput(input.currentMessage, input.session)) {
    throw new RoomContextBuildErrorV1(
      'invalid-current-message',
      'The current message must be a valid message in the target Room.'
    );
  }
  const roomResource = { type: 'room', roomId: input.session.roomId } as const;
  const currentAcl = aclResult(input.currentMessage.acl, input, roomResource);
  if (currentAcl === 'denied') {
    throw new RoomContextBuildErrorV1(
      'current-message-access-denied',
      'The Room session may not read the current message.'
    );
  }
  if (currentAcl === 'mismatch') {
    throw new RoomContextBuildErrorV1(
      'current-message-acl-mismatch',
      'The current-message ACL is not bound to this Room session.'
    );
  }
  consider('current-message');
  add(messageCandidate(input.currentMessage, 'current-message'));

  if (input.summary) {
    consider('summary');
    const summaryAcl = aclResult(input.summary.acl, input, roomResource);
    if (summaryAcl !== 'allowed') {
      exclude(
        'summary',
        summaryAcl === 'denied' ? 'acl-denied' : 'acl-binding-mismatch'
      );
    } else {
      const validation = validateRoomContextSummaryV1({
        summary: input.summary.summary,
        organizationId: input.session.organizationId,
        roomId: input.session.roomId,
        currentSequence: input.currentMessage.message.sequence,
        configVersion: budget.summaryConfigVersion,
        expectedSource: input.summary.expectedSource,
      });
      if (!validation.valid) {
        exclude('summary', validation.reason);
      } else {
        const { summary } = input.summary;
        const source: RoomSummaryContextProvenanceV1 = {
          schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
          sourceType: 'room-summary',
          sourceId: summary.summaryId,
          organizationId: summary.organizationId,
          roomId: summary.roomId,
          fromSequence: summary.source.fromSequence,
          throughSequence: summary.source.throughSequence,
          sourceHash: summary.source.sourceHash,
          aclHash: summary.source.aclHash,
          configVersion: summary.source.configVersion,
          contentHash: summary.contentHash,
        };
        add({
          category: 'summary',
          dedupeKey: `summary:${summary.summaryId}`,
          sourceId: summary.summaryId,
          content: summary.content,
          source,
          acl: cloneAllowedAcl(
            input.summary.acl as RoomContextAllowedAclV1
          ),
          trust: {
            schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
            level: 'untrusted',
            origin: 'derived-summary',
            usage: 'data-only',
          },
          displayOrder: [summary.source.fromSequence, summary.summaryId],
        });
      }
    }
  }

  const replyInputs = [...(input.replyChain ?? [])];
  consider('reply-chain', replyInputs.length);
  const replyById = new Map<string, RoomContextMessageInputV1[]>();
  for (const reply of replyInputs) {
    const list = replyById.get(reply.message.messageId) ?? [];
    list.push(reply);
    replyById.set(reply.message.messageId, list);
  }
  const consumedReplyInputs = new Set<RoomContextMessageInputV1>();
  const visitedReplyIds = new Set<string>();
  let replyId = input.currentMessage.message.replyToMessageId;
  let replyBeforeSequence = input.currentMessage.message.sequence;
  while (replyId) {
    if (visitedReplyIds.has(replyId)) {
      exclude('reply-chain', 'invalid-reply-chain');
      break;
    }
    visitedReplyIds.add(replyId);
    const matches = replyById.get(replyId);
    if (!matches) break;
    matches.forEach((match) => consumedReplyInputs.add(match));
    if (matches.length !== 1) {
      exclude('reply-chain', 'duplicate-source', matches.length);
      break;
    }
    const reply = matches[0];
    if (
      !isValidMessageInput(
        reply,
        input.session,
        replyBeforeSequence
      )
    ) {
      exclude('reply-chain', 'invalid-source');
      break;
    }
    const result = aclResult(reply.acl, input, roomResource);
    if (result !== 'allowed') {
      exclude(
        'reply-chain',
        result === 'denied' ? 'acl-denied' : 'acl-binding-mismatch'
      );
      break;
    }
    add(messageCandidate(reply, 'reply-chain'));
    replyBeforeSequence = reply.message.sequence;
    replyId = reply.message.replyToMessageId;
  }
  const unusedReplies = replyInputs.length - consumedReplyInputs.size;
  if (unusedReplies > 0) {
    exclude('reply-chain', 'not-reply-ancestor', unusedReplies);
  }
  const deltaInputs = [...(input.relevantRoomDelta ?? [])];
  consider('room-delta', deltaInputs.length);
  const validDelta: RoomContextMessageInputV1[] = [];
  for (const entry of deltaInputs) {
    if (
      !isValidMessageInput(
        entry,
        input.session,
        input.currentMessage.message.sequence
      )
    ) {
      exclude(
        'room-delta',
        Number.isSafeInteger(entry.message.sequence) &&
          entry.message.sequence >= input.currentMessage.message.sequence
          ? 'message-not-before-current'
          : 'invalid-source'
      );
    } else {
      validDelta.push(entry);
    }
  }
  const delta = validDelta.sort(
    (left, right) =>
      right.message.sequence - left.message.sequence ||
      compareText(left.message.messageId, right.message.messageId)
  );
  const deltaIdCounts = new Map<string, number>();
  for (const entry of delta) {
    deltaIdCounts.set(
      entry.message.messageId,
      (deltaIdCounts.get(entry.message.messageId) ?? 0) + 1
    );
  }
  for (const entry of delta) {
    if ((deltaIdCounts.get(entry.message.messageId) ?? 0) > 1) {
      exclude('room-delta', 'duplicate-source');
      continue;
    }
    const result = aclResult(entry.acl, input, roomResource);
    if (result !== 'allowed') {
      exclude(
        'room-delta',
        result === 'denied' ? 'acl-denied' : 'acl-binding-mismatch'
      );
      continue;
    }
    add(messageCandidate(entry, 'room-delta'));
  }

  const sliceInputs = [...(input.documentSlices ?? [])];
  consider('document-slice', sliceInputs.length);
  const validSlices: RoomContextDocumentSliceInputV1[] = [];
  for (const slice of sliceInputs) {
    if (!validDocumentSlice(slice)) {
      exclude('document-slice', 'invalid-source');
    } else {
      validSlices.push(slice);
    }
  }
  const slices = validSlices.sort(
    (left, right) =>
      right.relevanceScore - left.relevanceScore ||
      compareText(left.documentId, right.documentId) ||
      left.start - right.start ||
      compareText(left.sliceId, right.sliceId)
  );
  const sliceKey = (slice: RoomContextDocumentSliceInputV1) =>
    `${slice.documentId}\u0000${slice.revision}\u0000${slice.start}\u0000${slice.end}`;
  const sliceKeyCounts = new Map<string, number>();
  for (const slice of slices) {
    const key = sliceKey(slice);
    sliceKeyCounts.set(key, (sliceKeyCounts.get(key) ?? 0) + 1);
  }
  for (const slice of slices) {
    if ((sliceKeyCounts.get(sliceKey(slice)) ?? 0) > 1) {
      exclude('document-slice', 'duplicate-source');
      continue;
    }
    const result = aclResult(slice.acl, input, {
      type: 'document',
      documentId: slice.documentId,
    });
    if (result !== 'allowed') {
      exclude(
        'document-slice',
        result === 'denied' ? 'acl-denied' : 'acl-binding-mismatch'
      );
      continue;
    }
    add(documentCandidate(slice));
  }

  const hitInputs = [...(input.retrievalHits ?? [])];
  consider('retrieval-hit', hitInputs.length);
  const validHits: RoomContextRetrievalHitInputV1[] = [];
  for (const hit of hitInputs) {
    if (!validRetrievalHit(hit)) {
      exclude('retrieval-hit', 'invalid-source');
    } else {
      validHits.push(hit);
    }
  }
  const hits = validHits.sort(
    (left, right) =>
      left.rank - right.rank ||
      right.score - left.score ||
      compareText(left.hitId, right.hitId)
  );
  const hitIdCounts = new Map<string, number>();
  for (const hit of hits) {
    hitIdCounts.set(hit.hitId, (hitIdCounts.get(hit.hitId) ?? 0) + 1);
  }
  for (const hit of hits) {
    if ((hitIdCounts.get(hit.hitId) ?? 0) > 1) {
      exclude('retrieval-hit', 'duplicate-source');
      continue;
    }
    const result = aclResult(hit.acl, input, retrievalResource(hit));
    if (result !== 'allowed') {
      exclude(
        'retrieval-hit',
        result === 'denied' ? 'acl-denied' : 'acl-binding-mismatch'
      );
      continue;
    }
    add(retrievalCandidate(hit));
  }

  const selectedRows: { block: RoomContextBlockV1; candidate: Candidate }[] = [];
  const selectedKeys = new Set<string>();
  let selectedSummaryThrough: number | undefined;
  for (const category of ALLOCATION_ORDER) {
    for (const candidate of candidates.get(category) ?? []) {
      const categoryUsage = usage.categories[category];
      if (
        category === 'room-delta' &&
        selectedSummaryThrough !== undefined &&
        candidate.source.sourceType === 'room-message' &&
        candidate.source.sequence <= selectedSummaryThrough
      ) {
        exclude(category, 'covered-by-summary');
        continue;
      }
      if (selectedKeys.has(candidate.dedupeKey)) {
        exclude(category, 'duplicate-source');
        continue;
      }
      if (categoryUsage.includedBlocks >= categoryUsage.maxBlocks) {
        exclude(category, 'category-block-budget');
        continue;
      }
      if (usage.includedBlocks >= usage.maxTotalBlocks) {
        exclude(category, 'total-block-budget');
        continue;
      }
      const categoryRemaining =
        categoryUsage.maxCharacters - categoryUsage.usedCharacters;
      const totalRemaining = usage.maxTotalCharacters - usage.usedCharacters;
      const available = Math.min(categoryRemaining, totalRemaining);
      if (available <= 0) {
        exclude(
          category,
          totalRemaining <= 0
            ? 'total-character-budget'
            : 'category-character-budget'
        );
        continue;
      }
      const content = candidate.content.slice(0, available);
      const block: RoomContextBlockV1 = {
        schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
        blockId: `ctx_${hashRoomContextValueV1({
          category,
          source: candidate.dedupeKey,
        }).slice(0, 24)}`,
        category,
        contentType: 'text/plain',
        content,
        contentHash: sha256RoomContextV1(content),
        source: candidate.source,
        acl: candidate.acl,
        aclHash: hashRoomContextValueV1(candidate.acl),
        trust: candidate.trust,
        truncation: {
          unit: 'utf16-code-unit',
          originalCharacters: candidate.content.length,
          includedCharacters: content.length,
          truncated: content.length < candidate.content.length,
        },
      };
      selectedRows.push({ block, candidate });
      selectedKeys.add(candidate.dedupeKey);
      categoryUsage.includedBlocks += 1;
      categoryUsage.usedCharacters += content.length;
      usage.includedBlocks += 1;
      usage.usedCharacters += content.length;
      if (block.truncation.truncated) categoryUsage.truncatedBlocks += 1;
      if (
        category === 'summary' &&
        !block.truncation.truncated &&
        candidate.source.sourceType === 'room-summary'
      ) {
        selectedSummaryThrough = candidate.source.throughSequence;
      }
    }
  }

  selectedRows.sort((left, right) => {
    const categoryDifference =
      (DISPLAY_CATEGORY_ORDER.get(left.block.category) ?? 0) -
      (DISPLAY_CATEGORY_ORDER.get(right.block.category) ?? 0);
    if (categoryDifference !== 0) return categoryDifference;
    return compareTuple(
      left.candidate.displayOrder,
      right.candidate.displayOrder
    );
  });
  const selected = selectedRows.map(({ block }) => block);

  const exclusions: RoomContextTraceExclusionV1[] = [...exclusionCounts]
    .map(([key, count]) => {
      const [category, reason] = key.split('\u0000') as [
        RoomContextCategoryV1,
        RoomContextExclusionReasonV1,
      ];
      return { category, reason, count };
    })
    .sort(
      (left, right) =>
        (DISPLAY_CATEGORY_ORDER.get(left.category) ?? 0) -
          (DISPLAY_CATEGORY_ORDER.get(right.category) ?? 0) ||
        compareText(left.reason, right.reason)
    );
  const selections: RoomContextTraceSelectionV1[] = selected.map((block) => ({
    category: block.category,
    blockId: block.blockId,
    sourceId: block.source.sourceId,
    sourceHash: block.source.contentHash,
    blockHash: block.contentHash,
    originalCharacters: block.truncation.originalCharacters,
    includedCharacters: block.truncation.includedCharacters,
    truncated: block.truncation.truncated,
  }));
  const throughMessageSequence = input.currentMessage.message.sequence;
  const contextHash = hashRoomContextValueV1({
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    organizationId: input.session.organizationId,
    roomId: input.session.roomId,
    roomSessionId: input.session.roomSessionId,
    agentId: input.session.agent.agentId,
    throughMessageSequence,
    blocks: selected,
  });
  const traceWithoutHash = {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    traceType: 'room.context-build' as const,
    builderConfigVersion: budget.configVersion,
    summaryConfigVersion: budget.summaryConfigVersion,
    throughMessageSequence,
    selections,
    exclusions,
    budget: usage as RoomContextBudgetUsageV1,
    contextHash,
  };

  return {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    contextType: 'room.context',
    organizationId: input.session.organizationId,
    roomId: input.session.roomId,
    roomSessionId: input.session.roomSessionId,
    agentId: input.session.agent.agentId,
    throughMessageSequence,
    blocks: selected,
    trace: {
      ...traceWithoutHash,
      traceHash: hashRoomContextValueV1(traceWithoutHash),
    },
  };
}

export class DeterministicRoomContextBuilderV1 {
  constructor(private readonly budget?: RoomContextBudgetConfigV1) {}

  build(input: BuildRoomContextInputV1): RoomContextBuildResultV1 {
    return buildRoomContextV1({
      ...input,
      budget: input.budget ?? this.budget,
    });
  }
}
