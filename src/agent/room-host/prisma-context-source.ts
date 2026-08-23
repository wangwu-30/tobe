import { randomUUID } from "node:crypto";
import path from "node:path";
import { stat } from "node:fs/promises";

import {
  DEFAULT_ROOM_CONTEXT_BUDGET_V1,
  ROOM_CONTEXT_CONTRACT_VERSION_V1,
  createRoomContextSummaryV1,
  hashRoomContextAclSnapshotV1,
  hashRoomContextSummaryMessagesV1,
  hashRoomContextValueV1,
  sha256RoomContextV1,
} from "@/agent/context";
import type {
  BuildRoomContextInputV1,
  RoomContextAclDecisionV1,
  RoomContextDocumentSliceInputV1,
  RoomContextMessageInputV1,
  RoomContextRetrievalHitInputV1,
  RoomContextSummaryInputV1,
} from "@/agent/context";
import {
  readKnowledgeIndexArtifactV1,
  type KnowledgeIndexArtifactV1,
} from "@/agent/knowledge/index-builder";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { safeJsonParse } from "@/framework/resilience/safe-data";
import { plateToMarkdown } from "@/lib/ai/serializer";
import { getPrismaClient } from "@/lib/db/prisma";
import { mapRoomMessageV1 } from "@/objects/room/schema";

import type { RoomHostContextSourceV1 } from "./host";

export type RoomKnowledgeArtifactReaderV1 = (
  artifactPath: string,
  expectedSha256: string,
) => Promise<KnowledgeIndexArtifactV1>;

export type PrismaRoomHostContextSourceOptionsV1 = {
  organizationId: string;
  prisma?: PrismaClient;
  clock?: { now(): Date };
  roomDeltaLimit?: number;
  replyAncestorLimit?: number;
  documentCandidateLimit?: number;
  documentSliceLimit?: number;
  documentSliceCharacters?: number;
  summarySourceLimit?: number;
  summaryCharacters?: number;
  knowledgeBindingLimit?: number;
  knowledgeHitLimit?: number;
  knowledgeHitCharacters?: number;
  knowledgeArtifactMaxBytes?: number;
  readKnowledgeArtifact?: RoomKnowledgeArtifactReaderV1;
};

const DEFAULT_ROOM_DELTA_LIMIT = 12;
const DEFAULT_REPLY_ANCESTOR_LIMIT = 8;
const DEFAULT_DOCUMENT_CANDIDATE_LIMIT = 24;
const DEFAULT_DOCUMENT_SLICE_LIMIT = 6;
const DEFAULT_DOCUMENT_SLICE_CHARACTERS = 1_600;
const DEFAULT_SUMMARY_SOURCE_LIMIT = 24;
const DEFAULT_SUMMARY_CHARACTERS = 2_400;
const DEFAULT_KNOWLEDGE_BINDING_LIMIT = 8;
const DEFAULT_KNOWLEDGE_HIT_LIMIT = 6;
const DEFAULT_KNOWLEDGE_HIT_CHARACTERS = 1_200;
const DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES = 40 * 1024 * 1024;
const MAX_INDEX_DOCUMENTS_CONSIDERED = 512;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Authoritative production context source for a Room turn. Every load rechecks
 * the live lease, Agent, project membership, document visibility and knowledge
 * binding. Provider state is never treated as an authorization source.
 *
 * The source performs bounded reads and returns immutable V1 context inputs.
 * Room summaries are a rebuildable cache with source/ACL/config hashes; only
 * ready knowledge snapshots whose on-disk digest verifies are readable.
 */
export class PrismaRoomHostContextSourceV1 implements RoomHostContextSourceV1 {
  private readonly organizationId: string;
  private readonly prisma: PrismaClient;
  private readonly clock: { now(): Date };
  private readonly roomDeltaLimit: number;
  private readonly replyAncestorLimit: number;
  private readonly documentCandidateLimit: number;
  private readonly documentSliceLimit: number;
  private readonly documentSliceCharacters: number;
  private readonly summarySourceLimit: number;
  private readonly summaryCharacters: number;
  private readonly knowledgeBindingLimit: number;
  private readonly knowledgeHitLimit: number;
  private readonly knowledgeHitCharacters: number;
  private readonly knowledgeArtifactMaxBytes: number;
  private readonly readKnowledgeArtifact: RoomKnowledgeArtifactReaderV1;

  constructor(options: PrismaRoomHostContextSourceOptionsV1) {
    this.organizationId = requireText(options.organizationId, "organizationId");
    this.prisma = options.prisma ?? getPrismaClient();
    this.clock = options.clock ?? { now: () => new Date() };
    this.roomDeltaLimit = boundedLimit(
      options.roomDeltaLimit ?? DEFAULT_ROOM_DELTA_LIMIT,
      "roomDeltaLimit",
      64,
    );
    this.replyAncestorLimit = boundedLimit(
      options.replyAncestorLimit ?? DEFAULT_REPLY_ANCESTOR_LIMIT,
      "replyAncestorLimit",
      32,
    );
    this.documentCandidateLimit = boundedLimit(
      options.documentCandidateLimit ?? DEFAULT_DOCUMENT_CANDIDATE_LIMIT,
      "documentCandidateLimit",
      64,
    );
    this.documentSliceLimit = boundedLimit(
      options.documentSliceLimit ?? DEFAULT_DOCUMENT_SLICE_LIMIT,
      "documentSliceLimit",
      16,
    );
    this.documentSliceCharacters = boundedLimit(
      options.documentSliceCharacters ?? DEFAULT_DOCUMENT_SLICE_CHARACTERS,
      "documentSliceCharacters",
      8_000,
    );
    this.summarySourceLimit = boundedLimit(
      options.summarySourceLimit ?? DEFAULT_SUMMARY_SOURCE_LIMIT,
      "summarySourceLimit",
      64,
    );
    this.summaryCharacters = boundedLimit(
      options.summaryCharacters ?? DEFAULT_SUMMARY_CHARACTERS,
      "summaryCharacters",
      8_000,
    );
    this.knowledgeBindingLimit = boundedLimit(
      options.knowledgeBindingLimit ?? DEFAULT_KNOWLEDGE_BINDING_LIMIT,
      "knowledgeBindingLimit",
      32,
    );
    this.knowledgeHitLimit = boundedLimit(
      options.knowledgeHitLimit ?? DEFAULT_KNOWLEDGE_HIT_LIMIT,
      "knowledgeHitLimit",
      16,
    );
    this.knowledgeHitCharacters = boundedLimit(
      options.knowledgeHitCharacters ?? DEFAULT_KNOWLEDGE_HIT_CHARACTERS,
      "knowledgeHitCharacters",
      8_000,
    );
    this.knowledgeArtifactMaxBytes = boundedLimit(
      options.knowledgeArtifactMaxBytes ?? DEFAULT_KNOWLEDGE_ARTIFACT_MAX_BYTES,
      "knowledgeArtifactMaxBytes",
      128 * 1024 * 1024,
    );
    this.readKnowledgeArtifact =
      options.readKnowledgeArtifact ?? readKnowledgeIndexArtifactV1;
  }

  async load(
    input: Parameters<RoomHostContextSourceV1["load"]>[0],
  ): Promise<BuildRoomContextInputV1> {
    if (input.session.organizationId !== this.organizationId) {
      throw new Error(
        "Room context session is outside the configured organization.",
      );
    }
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.roomAgentSession.findFirst({
        where: {
          id: input.session.roomSessionId,
          organizationId: this.organizationId,
          roomId: input.session.roomId,
          agentId: input.session.agent.agentId,
          generation: input.lease.generation,
          leaseOwnerId: input.lease.workerId,
          leaseExpiresAt: { gt: now },
          currentDeliveryId: input.lease.deliveryId,
          status: "active",
        },
        include: { room: true },
      });
      if (!session) {
        throw new Error(
          "Room context load was fenced or the session is no longer active.",
        );
      }
      const activeAgent = await tx.agentProfile.findFirst({
        where: {
          enabled: true,
          id: session.agentId,
          organizationId: this.organizationId,
        },
        select: { id: true, updatedAt: true },
      });
      if (!activeAgent) {
        throw new Error("Room context Agent access has been revoked.");
      }

      const delivery = await tx.roomInboxDelivery.findFirst({
        where: {
          id: input.lease.deliveryId,
          organizationId: this.organizationId,
          roomId: input.session.roomId,
          roomSessionId: input.session.roomSessionId,
          status: "claimed",
        },
        include: { message: { include: { mentions: true } } },
      });
      if (!delivery) {
        throw new Error("Claimed Room delivery is unavailable for context.");
      }

      const delta = await tx.roomMessage.findMany({
        where: {
          organizationId: this.organizationId,
          roomId: input.session.roomId,
          sequence: { lt: delivery.message.sequence },
        },
        include: { mentions: true },
        orderBy: [{ sequence: "desc" }, { id: "asc" }],
        take: this.roomDeltaLimit,
      });
      const replies = await loadReplyAncestors(
        tx,
        {
          organizationId: this.organizationId,
          roomId: input.session.roomId,
          replyToMessageId: delivery.message.replyToMessageId,
        },
        this.replyAncestorLimit,
      );
      const roomPolicyVersion = [
        DEFAULT_ROOM_CONTEXT_BUDGET_V1.summaryConfigVersion,
        session.agentConfigVersion,
        hashRoomContextValueV1({
          hostAgentId: session.room.hostAgentId,
          policyJson: session.room.policyJson,
        }),
        activeAgent.updatedAt.toISOString(),
      ].join(":");
      const roomAccess = roomAcl({
        organizationId: this.organizationId,
        roomId: input.session.roomId,
        roomSessionId: input.session.roomSessionId,
        agentId: input.session.agent.agentId,
        policyVersion: roomPolicyVersion,
      });
      const summaryPlan = await loadSummaryPlan(tx, {
        aclHash: hashRoomContextAclSnapshotV1([roomAccess]),
        configVersion: DEFAULT_ROOM_CONTEXT_BUDGET_V1.summaryConfigVersion,
        currentSequence: delivery.message.sequence,
        delta,
        limit: this.summarySourceLimit,
        organizationId: this.organizationId,
        roomId: input.session.roomId,
        roomSessionId: input.session.roomSessionId,
      });
      const rawMessages = [
        delivery.message,
        ...delta,
        ...replies,
        ...summaryPlan.messages,
      ];
      const handles = await loadAgentHandles(
        tx,
        this.organizationId,
        rawMessages,
      );
      const mappedById = new Map(
        rawMessages.map((message) => [
          message.id,
          mapRoomMessageV1({
            ...message,
            actorHandle: handles.get(message.actorId),
          }),
        ]),
      );
      const current = requireMapped(mappedById, delivery.message.id);
      const wrap = (messageId: string): RoomContextMessageInputV1 => ({
        message: requireMapped(mappedById, messageId),
        acl: roomAccess,
      });
      const summary = await materializeSummary(tx, {
        acl: roomAccess,
        aclHash: summaryPlan.aclHash,
        configVersion: summaryPlan.configVersion,
        currentSequence: delivery.message.sequence,
        mappedMessages: summaryPlan.messages.map(({ id }) =>
          requireMapped(mappedById, id),
        ),
        maximumCharacters: this.summaryCharacters,
        organizationId: this.organizationId,
        previous: summaryPlan.previous,
        roomId: input.session.roomId,
        roomSessionId: input.session.roomSessionId,
      });
      const searchTerms = contextSearchTerms(current.text);
      const documents = session.room.projectId
        ? await loadDocumentSlices(tx, {
            agentId: session.agentId,
            candidateLimit: this.documentCandidateLimit,
            maximumCharacters: this.documentSliceCharacters,
            organizationId: this.organizationId,
            projectId: session.room.projectId,
            roomId: session.room.id,
            roomSessionId: session.id,
            searchTerms,
            sliceLimit: this.documentSliceLimit,
          })
        : [];
      const retrievalHits = session.room.projectId
        ? await loadKnowledgeHits(tx, {
            agentId: session.agentId,
            artifactMaxBytes: this.knowledgeArtifactMaxBytes,
            bindingLimit: this.knowledgeBindingLimit,
            hitLimit: this.knowledgeHitLimit,
            maximumCharacters: this.knowledgeHitCharacters,
            now,
            organizationId: this.organizationId,
            projectId: session.room.projectId,
            readArtifact: this.readKnowledgeArtifact,
            roomSessionId: session.id,
            searchTerms,
          })
        : [];

      return {
        session: input.session,
        currentMessage: { message: current, acl: roomAccess },
        relevantRoomDelta: delta.map(({ id }) => wrap(id)),
        replyChain: replies.map(({ id }) => wrap(id)),
        documentSlices: documents,
        ...(summary ? { summary } : {}),
        retrievalHits,
      };
    });
  }
}

export function createPrismaRoomHostContextSourceV1(
  options: PrismaRoomHostContextSourceOptionsV1,
): PrismaRoomHostContextSourceV1 {
  return new PrismaRoomHostContextSourceV1(options);
}

type MessageWithMentions = Prisma.RoomMessageGetPayload<{
  include: { mentions: true };
}>;

type StoredSummaryRow = {
  id: string;
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  fromSequence: number;
  throughSequence: number;
  sourceHash: string;
  aclHash: string;
  configVersion: string;
  content: string;
  contentHash: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SummaryPlan = {
  aclHash: string;
  configVersion: string;
  messages: MessageWithMentions[];
  previous: StoredSummaryRow | null;
};

type ContextDocumentRow = {
  id: string;
  title: string;
  content: string;
  currentVersion: number;
  draftRevision: number;
  revision: number;
  updatedAt: Date;
  files: Array<{
    id: string;
    content: string;
    revision: number;
    updatedAt: Date;
  }>;
};

type KnowledgeBindingRow = {
  bindingId: string;
  bindingUpdatedAt: Date | string;
  spaceId: string;
  spaceUpdatedAt: Date | string;
  snapshotId: string;
  commitSha: string;
  indexVersion: string;
  artifactPath: string;
  artifactSha256: string;
  readyAt: Date | string;
};

async function loadReplyAncestors(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    roomId: string;
    replyToMessageId: string | null;
  },
  limit: number,
): Promise<MessageWithMentions[]> {
  const ancestors: MessageWithMentions[] = [];
  const visited = new Set<string>();
  let messageId = input.replyToMessageId;
  while (messageId && ancestors.length < limit) {
    if (visited.has(messageId)) break;
    visited.add(messageId);
    const message: MessageWithMentions | null = await tx.roomMessage.findFirst({
      where: {
        id: messageId,
        organizationId: input.organizationId,
        roomId: input.roomId,
      },
      include: { mentions: true },
    });
    if (!message) break;
    ancestors.push(message);
    messageId = message.replyToMessageId;
  }
  return ancestors;
}

async function loadSummaryPlan(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    roomId: string;
    roomSessionId: string;
    currentSequence: number;
    delta: readonly MessageWithMentions[];
    limit: number;
    aclHash: string;
    configVersion: string;
  },
): Promise<SummaryPlan> {
  const stored = await tx.$queryRaw<StoredSummaryRow[]>`
    SELECT
      "id", "organizationId", "roomId", "roomSessionId",
      "fromSequence", "throughSequence", "sourceHash", "aclHash",
      "configVersion", "content", "contentHash", "createdAt", "updatedAt"
    FROM "RoomContextSummaryCache"
    WHERE "organizationId" = ${input.organizationId}
      AND "roomId" = ${input.roomId}
      AND "roomSessionId" = ${input.roomSessionId}
      AND "configVersion" = ${input.configVersion}
    LIMIT 1
  `;
  const previous = isReusableSummary(stored[0], input) ? stored[0] : null;
  const oldestDeltaSequence = input.delta.reduce(
    (minimum, message) => Math.min(minimum, message.sequence),
    input.currentSequence,
  );
  const throughSequence = oldestDeltaSequence - 1;
  if (throughSequence < 0) {
    return {
      aclHash: input.aclHash,
      configVersion: input.configVersion,
      messages: [],
      previous: null,
    };
  }

  const lowerBound = previous?.throughSequence ?? -1;
  let messages = await tx.roomMessage.findMany({
    where: {
      organizationId: input.organizationId,
      roomId: input.roomId,
      sequence: { gt: lowerBound, lte: throughSequence },
    },
    include: { mentions: true },
    orderBy: [{ sequence: previous ? "asc" : "desc" }, { id: "asc" }],
    take: input.limit,
  });
  if (!previous) messages = messages.reverse();
  return {
    aclHash: input.aclHash,
    configVersion: input.configVersion,
    messages,
    previous,
  };
}

function isReusableSummary(
  summary: StoredSummaryRow | undefined,
  input: {
    organizationId: string;
    roomId: string;
    roomSessionId: string;
    currentSequence: number;
    aclHash: string;
    configVersion: string;
  },
): summary is StoredSummaryRow {
  return Boolean(
    summary &&
    summary.organizationId === input.organizationId &&
    summary.roomId === input.roomId &&
    summary.roomSessionId === input.roomSessionId &&
    summary.configVersion === input.configVersion &&
    summary.aclHash === input.aclHash &&
    SHA256.test(summary.sourceHash) &&
    SHA256.test(summary.aclHash) &&
    SHA256.test(summary.contentHash) &&
    summary.contentHash === sha256RoomContextV1(summary.content) &&
    summary.content.trim().length > 0 &&
    Number.isSafeInteger(summary.fromSequence) &&
    Number.isSafeInteger(summary.throughSequence) &&
    summary.fromSequence >= 0 &&
    summary.throughSequence >= summary.fromSequence &&
    summary.throughSequence < input.currentSequence,
  );
}

async function materializeSummary(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    roomId: string;
    roomSessionId: string;
    currentSequence: number;
    configVersion: string;
    acl: RoomContextAclDecisionV1;
    aclHash: string;
    previous: StoredSummaryRow | null;
    mappedMessages: Parameters<typeof hashRoomContextSummaryMessagesV1>[0];
    maximumCharacters: number;
  },
): Promise<RoomContextSummaryInputV1 | undefined> {
  if (input.mappedMessages.length === 0 && !input.previous) return undefined;

  if (input.mappedMessages.length === 0 && input.previous) {
    return storedSummaryInput(input.previous, input.acl);
  }
  const first = input.mappedMessages[0];
  const last = input.mappedMessages.at(-1);
  if (!first || !last) return undefined;
  const fromSequence = input.previous?.fromSequence ?? first.sequence;
  const throughSequence = last.sequence;
  if (throughSequence >= input.currentSequence) return undefined;
  const appendedHash = hashRoomContextSummaryMessagesV1(input.mappedMessages);
  const sourceHash = input.previous
    ? hashRoomContextValueV1({
        previous: {
          fromSequence: input.previous.fromSequence,
          throughSequence: input.previous.throughSequence,
          sourceHash: input.previous.sourceHash,
        },
        appendedHash,
      })
    : appendedHash;
  const content = buildSummaryContent(
    input.previous?.content ?? "",
    input.mappedMessages,
    input.maximumCharacters,
  );
  const summaryId = input.previous?.id ?? randomUUID();
  const summary = createRoomContextSummaryV1({
    summaryId,
    organizationId: input.organizationId,
    roomId: input.roomId,
    content,
    source: {
      fromSequence,
      throughSequence,
      sourceHash,
      aclHash: input.aclHash,
      configVersion: input.configVersion,
    },
  });
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "RoomContextSummaryCache" (
      "id", "organizationId", "roomId", "roomSessionId",
      "fromSequence", "throughSequence", "sourceHash", "aclHash",
      "configVersion", "content", "contentHash", "createdAt", "updatedAt"
    ) VALUES (
      ${summaryId}, ${input.organizationId}, ${input.roomId}, ${input.roomSessionId},
      ${fromSequence}, ${throughSequence}, ${sourceHash}, ${input.aclHash},
      ${input.configVersion}, ${content}, ${summary.contentHash}, ${now}, ${now}
    )
    ON CONFLICT ("roomSessionId", "configVersion") DO UPDATE SET
      "fromSequence" = excluded."fromSequence",
      "throughSequence" = excluded."throughSequence",
      "sourceHash" = excluded."sourceHash",
      "aclHash" = excluded."aclHash",
      "content" = excluded."content",
      "contentHash" = excluded."contentHash",
      "updatedAt" = excluded."updatedAt"
  `;
  return {
    summary,
    expectedSource: {
      fromSequence,
      throughSequence,
      sourceHash,
      aclHash: input.aclHash,
    },
    acl: input.acl,
  };
}

function storedSummaryInput(
  stored: StoredSummaryRow,
  acl: RoomContextAclDecisionV1,
): RoomContextSummaryInputV1 {
  const expectedSource = {
    fromSequence: stored.fromSequence,
    throughSequence: stored.throughSequence,
    sourceHash: stored.sourceHash,
    aclHash: stored.aclHash,
  };
  return {
    summary: {
      schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
      summaryId: stored.id,
      organizationId: stored.organizationId,
      roomId: stored.roomId,
      content: stored.content,
      contentHash: stored.contentHash,
      source: { ...expectedSource, configVersion: stored.configVersion },
    },
    expectedSource,
    acl,
  };
}

function buildSummaryContent(
  previous: string,
  messages: Parameters<typeof hashRoomContextSummaryMessagesV1>[0],
  maximumCharacters: number,
): string {
  const header = "Durable Room digest (untrusted context):";
  const existing = previous
    .split("\n")
    .filter((line) => line && line !== header);
  const appended = messages.map((message) => {
    const actor =
      message.actor.type === "human"
        ? (message.actor.displayName ?? message.actor.userId)
        : message.actor.type === "agent"
          ? (message.actor.displayName ?? message.actor.handle)
          : message.actor.systemId;
    const text = redactSummaryText(message.text)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 280);
    return `[${message.sequence}] ${actor}: ${text || "(empty message)"}`;
  });
  const lines = [...existing, ...appended];
  while (
    lines.length > 1 &&
    `${header}\n${lines.join("\n")}`.length > maximumCharacters
  ) {
    lines.shift();
  }
  return `${header}\n${lines.join("\n")}`.slice(0, maximumCharacters);
}

function redactSummaryText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, "Bearer [REDACTED]")
    .replace(
      /\b(password|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/giu,
      "$1=[REDACTED]",
    );
}

async function loadDocumentSlices(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    roomId: string;
    roomSessionId: string;
    agentId: string;
    candidateLimit: number;
    sliceLimit: number;
    maximumCharacters: number;
    searchTerms: readonly string[];
  },
): Promise<RoomContextDocumentSliceInputV1[]> {
  const rows = (await tx.document.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      OR: [{ id: input.projectId }, { projectId: input.projectId }],
    },
    select: {
      id: true,
      title: true,
      content: true,
      currentVersion: true,
      draftRevision: true,
      revision: true,
      updatedAt: true,
      files: {
        where: { deletedAt: null, role: "deliverable", type: "file" },
        select: { id: true, content: true, revision: true, updatedAt: true },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: input.candidateLimit,
  })) as ContextDocumentRow[];

  return rows
    .flatMap((document) => {
      const file = document.files[0];
      const sourceContent = file?.content ?? document.content;
      const content = safeSerializeDocument(sourceContent);
      if (!content) return [];
      const score = relevanceScore(
        `${document.title}\n${content}`,
        input.searchTerms,
      );
      const slice = boundedSnippet(
        content,
        input.searchTerms,
        input.maximumCharacters,
      );
      const revision = [
        `document-${document.revision}`,
        `draft-${document.draftRevision}`,
        `version-${document.currentVersion}`,
        file ? `file-${file.id}-${file.revision}` : "document-content",
      ].join(":");
      const acl = resourceAcl({
        agentId: input.agentId,
        authorizationRef: `room:${input.roomId}:project:${input.projectId}`,
        organizationId: input.organizationId,
        policyVersion: [
          "project-document-v1",
          document.updatedAt.toISOString(),
          file?.updatedAt.toISOString() ?? "no-file",
        ].join(":"),
        resource: { type: "document", documentId: document.id },
        roomSessionId: input.roomSessionId,
      });
      return [
        {
          sliceId: `doc_${hashRoomContextValueV1({
            documentId: document.id,
            revision,
            start: slice.start,
            end: slice.end,
          }).slice(0, 24)}`,
          documentId: document.id,
          revision,
          title: document.title,
          start: slice.start,
          end: slice.end,
          content: slice.content,
          relevanceScore: score,
          acl,
        } satisfies RoomContextDocumentSliceInputV1,
      ];
    })
    .sort(
      (left, right) =>
        right.relevanceScore - left.relevanceScore ||
        compareText(left.documentId, right.documentId),
    )
    .slice(0, input.sliceLimit);
}

async function loadKnowledgeHits(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    roomSessionId: string;
    agentId: string;
    bindingLimit: number;
    hitLimit: number;
    maximumCharacters: number;
    artifactMaxBytes: number;
    searchTerms: readonly string[];
    now: Date;
    readArtifact: RoomKnowledgeArtifactReaderV1;
  },
): Promise<RoomContextRetrievalHitInputV1[]> {
  const rows = await tx.$queryRaw<KnowledgeBindingRow[]>`
    SELECT
      binding."id" AS "bindingId",
      binding."updatedAt" AS "bindingUpdatedAt",
      space."id" AS "spaceId",
      space."updatedAt" AS "spaceUpdatedAt",
      snapshot."id" AS "snapshotId",
      snapshot."commitSha" AS "commitSha",
      snapshot."indexVersion" AS "indexVersion",
      snapshot."artifactPath" AS "artifactPath",
      snapshot."artifactSha256" AS "artifactSha256",
      snapshot."readyAt" AS "readyAt"
    FROM "KnowledgeBinding" AS binding
    INNER JOIN "Document" AS workspace
      ON workspace."id" = binding."workspaceId"
      AND workspace."organizationId" = binding."organizationId"
      AND workspace."deletedAt" IS NULL
    INNER JOIN "KnowledgeSpace" AS space
      ON space."id" = binding."spaceId"
      AND space."organizationId" = binding."organizationId"
    INNER JOIN "KnowledgeSnapshot" AS snapshot
      ON snapshot."id" = space."activeSnapshotId"
      AND snapshot."spaceId" = space."id"
      AND snapshot."organizationId" = space."organizationId"
    WHERE binding."organizationId" = ${input.organizationId}
      AND (workspace."id" = ${input.projectId} OR workspace."projectId" = ${input.projectId})
      AND binding."access" IN ('read', 'propose')
      AND snapshot."readyAt" <= ${input.now}
      AND (
        (
          space."scope" = 'team'
          AND space."ownerAgentId" IS NULL
          AND space."readPolicy" = 'team'
          AND binding."agentId" IS NULL
        )
        OR
        (
          space."scope" = 'agent'
          AND space."ownerAgentId" = ${input.agentId}
          AND space."readPolicy" = 'owner'
          AND binding."agentId" = ${input.agentId}
        )
      )
    ORDER BY
      CASE WHEN binding."agentId" IS NULL THEN 1 ELSE 0 END ASC,
      binding."id" ASC
    LIMIT ${input.bindingLimit}
  `;

  const candidates: Array<
    Omit<RoomContextRetrievalHitInputV1, "rank"> & { score: number }
  > = [];
  const seenSpaces = new Set<string>();
  for (const row of rows) {
    if (seenSpaces.has(row.spaceId)) continue;
    seenSpaces.add(row.spaceId);
    if (
      !path.isAbsolute(row.artifactPath) ||
      !SHA256.test(row.artifactSha256)
    ) {
      continue;
    }
    let artifact: KnowledgeIndexArtifactV1;
    try {
      const metadata = await stat(row.artifactPath);
      if (!metadata.isFile() || metadata.size > input.artifactMaxBytes)
        continue;
      artifact = await input.readArtifact(row.artifactPath, row.artifactSha256);
    } catch {
      continue;
    }
    if (
      artifact.commitSha !== row.commitSha ||
      artifact.indexVersion !== row.indexVersion
    ) {
      continue;
    }
    const policyVersion = [
      "ready-knowledge-v1",
      toIso(row.bindingUpdatedAt),
      toIso(row.spaceUpdatedAt),
      toIso(row.readyAt),
      row.artifactSha256,
    ].join(":");
    for (const document of artifact.documents.slice(
      0,
      MAX_INDEX_DOCUMENTS_CONSIDERED,
    )) {
      if (!validIndexDocument(document)) continue;
      const score = relevanceScore(
        `${document.path}\n${document.content}`,
        input.searchTerms,
      );
      const snippet = boundedSnippet(
        document.content,
        input.searchTerms,
        input.maximumCharacters,
      );
      const sourceId = `${row.spaceId}:${document.path}`;
      candidates.push({
        hitId: `hit_${hashRoomContextValueV1({
          snapshotId: row.snapshotId,
          path: document.path,
          contentSha256: document.contentSha256,
          start: snippet.start,
        }).slice(0, 24)}`,
        score,
        indexId: row.snapshotId,
        indexVersion: row.indexVersion,
        content: snippet.content,
        source: {
          type: "knowledge",
          id: sourceId,
          revision: row.commitSha,
          title: document.path,
        },
        acl: resourceAcl({
          agentId: input.agentId,
          authorizationRef: row.bindingId,
          organizationId: input.organizationId,
          policyVersion,
          resource: { type: "knowledge", sourceId },
          roomSessionId: input.roomSessionId,
        }),
      });
    }
  }

  return candidates
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.source.id, right.source.id) ||
        compareText(left.hitId, right.hitId),
    )
    .slice(0, input.hitLimit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function validIndexDocument(
  document: KnowledgeIndexArtifactV1["documents"][number],
): boolean {
  return (
    document.path.trim().length > 0 &&
    document.path.length <= 4_096 &&
    /^[a-f0-9]{40,64}$/.test(document.blobSha) &&
    SHA256.test(document.contentSha256) &&
    document.contentSha256 === sha256RoomContextV1(document.content) &&
    document.byteLength === Buffer.byteLength(document.content, "utf8")
  );
}

function resourceAcl(input: {
  organizationId: string;
  roomSessionId: string;
  agentId: string;
  resource: RoomContextAclDecisionV1["resource"];
  policyVersion: string;
  authorizationRef: string;
}): RoomContextAclDecisionV1 {
  return {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    decision: "allow",
    organizationId: input.organizationId,
    principal: {
      type: "room-agent-session",
      agentId: input.agentId,
      roomSessionId: input.roomSessionId,
    },
    resource: input.resource,
    permission: "context.read",
    policyVersion: input.policyVersion,
    authorizationRef: input.authorizationRef,
  };
}

function roomAcl(input: {
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  agentId: string;
  policyVersion: string;
}): RoomContextAclDecisionV1 {
  return resourceAcl({
    ...input,
    authorizationRef: `room:${input.roomId}`,
    resource: { type: "room", roomId: input.roomId },
  });
}

async function loadAgentHandles(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messages: readonly MessageWithMentions[],
): Promise<Map<string, string>> {
  const agentIds = [
    ...new Set(
      messages
        .filter(({ actorType }) => actorType === "agent")
        .map(({ actorId }) => actorId),
    ),
  ];
  if (agentIds.length === 0) return new Map();
  const agents = await tx.agentProfile.findMany({
    where: { organizationId, id: { in: agentIds } },
    select: { id: true, handle: true },
  });
  return new Map(agents.map(({ id, handle }) => [id, handle]));
}

function contextSearchTerms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const terms: string[] = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  const ideographs = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  for (const run of ideographs) {
    for (let index = 0; index + 1 < run.length; index += 1) {
      terms.push(run.slice(index, index + 2));
    }
  }
  return [...new Set(terms)]
    .sort(
      (left, right) => right.length - left.length || compareText(left, right),
    )
    .slice(0, 16);
}

function relevanceScore(value: string, terms: readonly string[]): number {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    const index = normalized.indexOf(term);
    if (index >= 0) score += 1 + Math.min(term.length, 16) / 16;
  }
  return score;
}

function boundedSnippet(
  value: string,
  terms: readonly string[],
  maximumCharacters: number,
): { start: number; end: number; content: string } {
  if (value.length <= maximumCharacters) {
    return { start: 0, end: value.length, content: value };
  }
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const matches = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0);
  const anchor = matches.length > 0 ? Math.min(...matches) : 0;
  const start = Math.max(
    0,
    Math.min(
      value.length - maximumCharacters,
      anchor - Math.floor(maximumCharacters / 4),
    ),
  );
  const content = value.slice(start, start + maximumCharacters);
  return { start, end: start + content.length, content };
}

function safeSerializeDocument(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = safeJsonParse<unknown>(trimmed, null);
  if (!Array.isArray(parsed)) return trimmed;
  try {
    return plateToMarkdown(parsed as never).trim();
  } catch {
    return trimmed;
  }
}

function requireMapped<T>(values: Map<string, T>, id: string): T {
  const value = values.get(id);
  if (!value) throw new Error(`Room context message ${id} was not mapped.`);
  return value;
}

function boundedLimit(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} must be non-empty.`);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Stored context date is invalid.");
  return date.toISOString();
}
