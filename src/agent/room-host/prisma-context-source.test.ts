import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import {
  PrismaRoomHostContextSourceV1,
  ensureDefaultRoom,
  postRoomMessage,
  prisma,
} from "../../../.tmp/room-backend-test/room-backend.mjs";

const run = promisify(execFile);
const ACTOR = { organizationId: "context-org", userId: "context-user" };
const HOST_ID = "builtin-assistant:context-org";
const BASE_TIME = new Date("2026-08-21T12:00:00.000Z");
let root = "";
let projectId = "";
let roomId = "";
let sessionId = "";

test.describe.serial("production Room context source", () => {
  test.beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "tobe-room-context-"));
    const databasePath = path.join(root, "dev.db");
    process.env.DAO_APP_DATA_ROOT = root;
    process.env.DATABASE_URL = `file:${databasePath}`;
    await run(
      process.execPath,
      ["scripts/bootstrap-local-db.mjs", "--app-data-root", root],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: root,
          DATABASE_URL: `file:${databasePath}`,
        },
      },
    );
    await prisma.organization.create({
      data: {
        id: ACTOR.organizationId,
        name: "Context Org",
        slug: "context-org",
      },
    });
    await prisma.user.create({
      data: { id: ACTOR.userId, name: "Context User" },
    });
    await prisma.organizationMembership.create({
      data: { organizationId: ACTOR.organizationId, userId: ACTOR.userId },
    });
    const conversation = await prisma.session.create({
      data: {
        id: "context-conversation",
        organizationId: ACTOR.organizationId,
      },
    });
    const project = await prisma.document.create({
      data: {
        id: "context-project",
        organizationId: ACTOR.organizationId,
        sessionId: conversation.id,
        title: "Launch Plan",
      },
    });
    projectId = project.id;
    await prisma.document.create({
      data: {
        id: "context-document",
        organizationId: ACTOR.organizationId,
        sessionId: conversation.id,
        projectId,
        title: "Pricing Decision",
        content: JSON.stringify([
          { type: "h1", children: [{ text: "Launch pricing" }] },
          {
            type: "p",
            children: [{ text: "The approved pilot price is 42 credits." }],
          },
        ]),
      },
    });
    const room = await ensureDefaultRoom(ACTOR, { projectId });
    roomId = room.id;

    for (let index = 1; index <= 18; index += 1) {
      await postRoomMessage(ACTOR, roomId, {
        text:
          index === 18
            ? "Use the pricing decision and launch runbook."
            : `Historical decision ${index}`,
      });
    }
    const session = await prisma.roomAgentSession.findFirstOrThrow({
      where: { organizationId: ACTOR.organizationId, roomId, agentId: HOST_ID },
      orderBy: { createdAt: "asc" },
    });
    sessionId = session.id;
    const delivery = await prisma.roomInboxDelivery.findFirstOrThrow({
      where: { roomSessionId: sessionId },
      orderBy: { deliverySequence: "desc" },
    });
    await prisma.roomInboxDelivery.updateMany({
      where: { roomSessionId: sessionId, id: { not: delivery.id } },
      data: { status: "completed", completedAt: BASE_TIME },
    });
    await prisma.roomInboxDelivery.update({
      where: { id: delivery.id },
      data: { status: "claimed", claimedAt: BASE_TIME },
    });
    await prisma.roomAgentSession.update({
      where: { id: sessionId },
      data: {
        currentDeliveryId: delivery.id,
        generation: 1,
        leaseOwnerId: "context-host",
        leaseExpiresAt: new Date(BASE_TIME.getTime() + 60_000),
      },
    });
    await seedReadyKnowledge();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await rm(root, { force: true, recursive: true });
  });

  test("rebuilds bounded document, summary and ready-knowledge context deterministically", async () => {
    const first = await loadContext();

    expect(first.documentSlices).toHaveLength(1);
    expect(
      first.documentSlices?.some(({ content }: { content: string }) =>
        content.includes("42 credits"),
      ),
    ).toBe(true);
    expect(
      first.documentSlices?.every(
        ({ acl }: { acl: { decision: string } }) => acl.decision === "allow",
      ),
    ).toBe(true);
    expect(first.retrievalHits).toHaveLength(1);
    expect(first.retrievalHits?.[0]).toMatchObject({
      rank: 1,
      indexId: "snapshot-ready",
      source: { type: "knowledge", id: "space-team:launch.md" },
    });
    expect(first.retrievalHits?.[0]?.content).toContain("launch runbook");
    expect(first.summary?.summary.source.throughSequence).toBe(5);
    expect(first.relevantRoomDelta).toHaveLength(12);

    const persisted = await prisma.roomContextSummaryCache.findUniqueOrThrow({
      where: {
        roomSessionId_configVersion: {
          roomSessionId: sessionId,
          configVersion: "room-summary-v1",
        },
      },
    });
    const restarted = await loadContext();
    expect(restarted.summary).toEqual(first.summary);
    expect(restarted.documentSlices).toEqual(first.documentSlices);
    expect(restarted.retrievalHits).toEqual(first.retrievalHits);
    expect(persisted.contentHash).toBe(first.summary?.summary.contentHash);
  });

  test("rechecks live ACL and excludes revoked or tampered knowledge", async () => {
    await prisma.knowledgeBinding.update({
      where: { id: "binding-team" },
      data: { agentId: "different-agent" },
    });
    expect((await loadContext()).retrievalHits).toEqual([]);

    await prisma.knowledgeBinding.update({
      where: { id: "binding-team" },
      data: { agentId: null },
    });
    await writeFile(
      path.join(root, "indexes", "ready.json"),
      '{"tampered":true}',
    );
    expect((await loadContext()).retrievalHits).toEqual([]);

    await prisma.agentProfile.update({
      where: { id: HOST_ID },
      data: { enabled: false },
    });
    await expect(loadContext()).rejects.toThrow("access has been revoked");
  });
});

async function loadContext() {
  const delivery = await prisma.roomInboxDelivery.findFirstOrThrow({
    where: { roomSessionId: sessionId, status: "claimed" },
    include: { message: { include: { mentions: true } } },
  });
  const session = await prisma.roomAgentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const source = new PrismaRoomHostContextSourceV1({
    organizationId: ACTOR.organizationId,
    prisma,
    clock: { now: () => BASE_TIME },
  });
  return source.load({
    schemaVersion: 1,
    session: {
      organizationId: ACTOR.organizationId,
      roomId,
      roomSessionId: sessionId,
      agent: {
        agentId: HOST_ID,
        handle: "@assistant",
        displayName: "AI Assistant",
      },
    },
    delivery: {
      schemaVersion: 1,
      envelopeType: "room.delivery",
      deliveryId: delivery.id,
      roomSessionId: sessionId,
      deliverySequence: delivery.deliverySequence,
      attempt: delivery.attempt,
      createdAt: delivery.createdAt.toISOString(),
      target: {
        agentId: HOST_ID,
        handle: "@assistant",
        displayName: "AI Assistant",
      },
      intent: delivery.intent === "observe" ? "observe" : "respond",
      cause: { type: "room-observation" },
      message: {
        schemaVersion: 1,
        envelopeType: "room.message",
        messageId: delivery.message.id,
        organizationId: ACTOR.organizationId,
        roomId,
        sequence: delivery.message.sequence,
        createdAt: delivery.message.createdAt.toISOString(),
        actor: { type: "human", userId: ACTOR.userId },
        text: delivery.message.text,
        mentions: [],
        attachments: [],
      },
    },
    cursor: {
      messageSequence: session.lastRoomSequence,
      deliverySequence: delivery.deliverySequence - 1,
      eventSequence: session.lastEventSequence,
    },
    lease: {
      roomSessionId: sessionId,
      deliveryId: delivery.id,
      workerId: "context-host",
      generation: 1,
    },
  });
}

async function seedReadyKnowledge() {
  const indexDirectory = path.join(root, "indexes");
  await mkdir(indexDirectory, { recursive: true });
  const content =
    "The launch runbook requires a human review before publishing.";
  const artifact = {
    commitSha: "a".repeat(40),
    documents: [
      {
        blobSha: "b".repeat(40),
        byteLength: Buffer.byteLength(content),
        content,
        contentSha256: sha256(content),
        path: "launch.md",
      },
    ],
    indexVersion: "knowledge-index-v1",
    schemaVersion: 1,
  };
  const artifactPath = path.join(indexDirectory, "ready.json");
  const bytes = `${stableJson(artifact)}\n`;
  await writeFile(artifactPath, bytes, { mode: 0o600 });
  const now = new Date("2026-08-21T11:00:00.000Z");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeSpace"
      ("id", "organizationId", "scope", "ownerAgentId", "repoPath", "repoUrl", "defaultBranch", "credentialRef", "activeSnapshotId", "readPolicy", "writePolicy", "createdAt", "updatedAt")
     VALUES (?, ?, 'team', NULL, ?, NULL, 'main', NULL, 'snapshot-ready', 'team', 'review-only', ?, ?)`,
    "space-team",
    ACTOR.organizationId,
    root,
    now,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChangeRequest"
      ("id", "organizationId", "jobId", "attemptId", "spaceId", "baseCommit", "headCommit", "branchName", "status", "diffSummary", "diffMetadataJson", "mergedCommit", "mergedAt", "revision", "createdAt", "updatedAt")
     VALUES (?, ?, 'context-job', 'context-attempt', 'space-team', ?, ?, 'knowledge/context', 'merged', '', '{}', ?, ?, 2, ?, ?)`,
    "change-ready",
    ACTOR.organizationId,
    "0".repeat(40),
    "a".repeat(40),
    "a".repeat(40),
    now,
    now,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeSnapshot"
      ("id", "organizationId", "spaceId", "changeRequestId", "commitSha", "indexVersion", "artifactPath", "artifactSha256", "readyAt", "createdAt")
     VALUES ('snapshot-ready', ?, 'space-team', 'change-ready', ?, 'knowledge-index-v1', ?, ?, ?, ?)`,
    ACTOR.organizationId,
    "a".repeat(40),
    artifactPath,
    sha256(bytes),
    now,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeBinding"
      ("id", "organizationId", "workspaceId", "agentId", "spaceId", "mountPath", "access", "createdAt", "updatedAt")
     VALUES ('binding-team', ?, ?, NULL, 'space-team', '/', 'read', ?, ?)`,
    ACTOR.organizationId,
    projectId,
    now,
    now,
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
