import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const migrationsRoot = path.join(repoRoot, "prisma", "migrations");

const AGENT_PROFILE_MANAGEMENT_MIGRATION =
  "20260821130000_add_agent_profile_management";
const ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION =
  "20260821140000_add_room_tool_confirmation_requests";
const DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION =
  "20260821160000_add_durable_room_delegation_ledger";
const DOCUMENT_PROPOSAL_CAS_MIGRATION =
  "20260821170000_document_proposal_cas";
const CANVAS_TABLES_MIGRATION = "20260822010000_add_canvas_tables";
const TEAM_SCOPED_CONVERSATIONS_MIGRATION =
  "20260823010000_add_team_scoped_conversations";
const TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN = {
  name: "scopeKind",
  type: "TEXT",
  notNull: true,
  defaultValue: "'wiki'",
  primaryKeyPosition: 0,
};
const TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN = {
  name: "documentId",
  type: "TEXT",
  notNull: true,
  defaultValue: null,
  primaryKeyPosition: 0,
};
const TEAM_SCOPED_CONVERSATION_CURRENT_DOCUMENT_COLUMN = {
  name: "documentId",
  type: "TEXT",
  notNull: false,
  defaultValue: null,
  primaryKeyPosition: 0,
};
const TEAM_SCOPED_CONVERSATION_SESSION_INDEX = {
  table: "Session",
  name: "Session_organizationId_scopeKind_updatedAt_idx",
  columns: ["organizationId", "scopeKind", "updatedAt"],
  unique: false,
};
const TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES = [
  {
    table: "AssistantRun",
    name: "AssistantRun_organizationId_startedAt_idx",
    columns: ["organizationId", "startedAt"],
    unique: false,
  },
  {
    table: "AssistantRun",
    name: "AssistantRun_organizationId_scopeKind_startedAt_idx",
    columns: ["organizationId", "scopeKind", "startedAt"],
    unique: false,
  },
  {
    table: "AssistantRun",
    name: "AssistantRun_sessionId_startedAt_idx",
    columns: ["sessionId", "startedAt"],
    unique: false,
  },
  {
    table: "AssistantRun",
    name: "AssistantRun_documentId_startedAt_idx",
    columns: ["documentId", "startedAt"],
    unique: false,
  },
  {
    table: "AssistantRun",
    name: "AssistantRun_status_startedAt_idx",
    columns: ["status", "startedAt"],
    unique: false,
  },
];
const TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS = [
  {
    column: "organizationId",
    referencedColumn: "id",
    referencedTable: "Organization",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  {
    column: "sessionId",
    referencedColumn: "id",
    referencedTable: "Session",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  {
    column: "documentId",
    referencedColumn: "id",
    referencedTable: "Document",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  {
    column: "requestMessageId",
    referencedColumn: "id",
    referencedTable: "ChatMessage",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  },
];
const TEAM_SCOPED_CONVERSATION_STAGING_TABLE = {
  name: "new_AssistantRun",
  columns: [
    {
      name: "id",
      type: "TEXT",
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 1,
    },
    {
      name: "organizationId",
      type: "TEXT",
      notNull: true,
      defaultValue: "'local-org'",
      primaryKeyPosition: 0,
    },
    {
      name: "sessionId",
      type: "TEXT",
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "documentId",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "scopeKind",
      type: "TEXT",
      notNull: true,
      defaultValue: "'wiki'",
      primaryKeyPosition: 0,
    },
    {
      name: "requestMessageId",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "mode",
      type: "TEXT",
      notNull: true,
      defaultValue: "'revision'",
      primaryKeyPosition: 0,
    },
    {
      name: "title",
      type: "TEXT",
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "status",
      type: "TEXT",
      notNull: true,
      defaultValue: "'queued'",
      primaryKeyPosition: 0,
    },
    {
      name: "summary",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "payloadJson",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "createdByUserId",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "originDeviceId",
      type: "TEXT",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "revision",
      type: "INTEGER",
      notNull: true,
      defaultValue: "1",
      primaryKeyPosition: 0,
    },
    {
      name: "deletedAt",
      type: "DATETIME",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "startedAt",
      type: "DATETIME",
      notNull: true,
      defaultValue: "CURRENT_TIMESTAMP",
      primaryKeyPosition: 0,
    },
    {
      name: "finishedAt",
      type: "DATETIME",
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
    {
      name: "createdAt",
      type: "DATETIME",
      notNull: true,
      defaultValue: "CURRENT_TIMESTAMP",
      primaryKeyPosition: 0,
    },
    {
      name: "updatedAt",
      type: "DATETIME",
      notNull: true,
      defaultValue: null,
      primaryKeyPosition: 0,
    },
  ],
  indexes: [],
  foreignKeys: TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS,
  checks: [],
};
const TEAM_SCOPED_CONVERSATION_RESUME_SQL = `
  DROP TABLE "AssistantRun";
  ALTER TABLE "new_AssistantRun" RENAME TO "AssistantRun";
  CREATE INDEX "AssistantRun_organizationId_startedAt_idx" ON "AssistantRun"("organizationId", "startedAt");
  CREATE INDEX "AssistantRun_organizationId_scopeKind_startedAt_idx" ON "AssistantRun"("organizationId", "scopeKind", "startedAt");
  CREATE INDEX "AssistantRun_sessionId_startedAt_idx" ON "AssistantRun"("sessionId", "startedAt");
  CREATE INDEX "AssistantRun_documentId_startedAt_idx" ON "AssistantRun"("documentId", "startedAt");
  CREATE INDEX "AssistantRun_status_startedAt_idx" ON "AssistantRun"("status", "startedAt");
`;
const CANVAS_TABLES = [
  {
    name: "NodeRelation",
    columns: [
      {
        name: "id",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 1,
      },
      {
        name: "organizationId",
        type: "TEXT",
        notNull: true,
        defaultValue: "'local-org'",
        primaryKeyPosition: 0,
      },
      {
        name: "sourceNodeId",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 0,
      },
      {
        name: "targetNodeId",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 0,
      },
      {
        name: "kind",
        type: "TEXT",
        notNull: true,
        defaultValue: "'dependency'",
        primaryKeyPosition: 0,
      },
      {
        name: "createdAt",
        type: "DATETIME",
        notNull: true,
        defaultValue: "CURRENT_TIMESTAMP",
        primaryKeyPosition: 0,
      },
    ],
    indexes: [
      {
        name: "NodeRelation_organizationId_sourceNodeId_idx",
        columns: ["organizationId", "sourceNodeId"],
        unique: false,
      },
      {
        name: "NodeRelation_organizationId_targetNodeId_idx",
        columns: ["organizationId", "targetNodeId"],
        unique: false,
      },
      {
        name: "NodeRelation_sourceNodeId_targetNodeId_kind_key",
        columns: ["sourceNodeId", "targetNodeId", "kind"],
        unique: true,
      },
    ],
    foreignKeys: [
      {
        column: "organizationId",
        referencedColumn: "id",
        referencedTable: "Organization",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      {
        column: "sourceNodeId",
        referencedColumn: "id",
        referencedTable: "Document",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      {
        column: "targetNodeId",
        referencedColumn: "id",
        referencedTable: "Document",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    ],
    checks: [],
  },
  {
    name: "ProjectCanvasLayout",
    columns: [
      {
        name: "id",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 1,
      },
      {
        name: "organizationId",
        type: "TEXT",
        notNull: true,
        defaultValue: "'local-org'",
        primaryKeyPosition: 0,
      },
      {
        name: "projectId",
        type: "TEXT",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 0,
      },
      {
        name: "x",
        type: "REAL",
        notNull: true,
        defaultValue: "0",
        primaryKeyPosition: 0,
      },
      {
        name: "y",
        type: "REAL",
        notNull: true,
        defaultValue: "0",
        primaryKeyPosition: 0,
      },
      {
        name: "updatedAt",
        type: "DATETIME",
        notNull: true,
        defaultValue: null,
        primaryKeyPosition: 0,
      },
    ],
    indexes: [
      {
        name: "ProjectCanvasLayout_organizationId_projectId_key",
        columns: ["organizationId", "projectId"],
        unique: true,
      },
    ],
    foreignKeys: [
      {
        column: "organizationId",
        referencedColumn: "id",
        referencedTable: "Organization",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      {
        column: "projectId",
        referencedColumn: "id",
        referencedTable: "Document",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    ],
    checks: [],
  },
];
const DOCUMENT_PROPOSAL_CAS_COLUMNS = [
  "baseVersionSha256",
  "baseDraftRevision",
  "patchSchemaVersion",
  "patchSha256",
  "reviewedByUserId",
  "reviewedAt",
];
const DOCUMENT_PROPOSAL_CAS_INDEXES = [
  { columns: ["baseVersionId"], unique: false },
  { columns: ["appliedCheckpointVersionId"], unique: false },
  { columns: ["reviewedByUserId"], unique: false },
];
const DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS = [
  {
    column: "baseVersionId",
    referencedColumn: "id",
    referencedTable: "Version",
    onDelete: "SET NULL",
  },
  {
    column: "appliedCheckpointVersionId",
    referencedColumn: "id",
    referencedTable: "Version",
    onDelete: "SET NULL",
  },
  {
    column: "reviewedByUserId",
    referencedColumn: "id",
    referencedTable: "User",
    onDelete: "SET NULL",
  },
];
const VERSION_IMMUTABLE_TRIGGER = "Version_immutable_snapshot_update";
const AGENT_PROFILE_MANAGEMENT_COLUMNS = [
  "capabilitiesJson",
  "configJson",
  "revision",
];
const ROOM_TOOL_CONFIRMATION_REQUEST_COLUMNS = [
  "id",
  "organizationId",
  "requestedByUserId",
  "approvedByUserId",
  "rejectedByUserId",
  "roomId",
  "roomMessageId",
  "roomSessionId",
  "deliveryId",
  "toolCallId",
  "toolName",
  "parametersJson",
  "parametersHash",
  "safetyLevel",
  "writePolicy",
  "status",
  "revision",
  "workspaceId",
  "projectId",
  "originDeviceId",
  "expiresAt",
  "capabilityHash",
  "approvedAt",
  "executedAt",
  "rejectedAt",
  "executionJobId",
  "executionJobReceiptJson",
  "createdAt",
  "updatedAt",
];
const ROOM_TOOL_CONFIRMATION_REQUEST_INDEXES = [
  { columns: ["capabilityHash"], unique: true },
  { columns: ["executionJobId"], unique: true },
  {
    columns: [
      "organizationId",
      "roomSessionId",
      "deliveryId",
      "toolCallId",
    ],
    unique: true,
  },
  {
    columns: ["organizationId", "roomId", "status", "createdAt"],
    unique: false,
  },
  {
    columns: [
      "organizationId",
      "requestedByUserId",
      "status",
      "expiresAt",
    ],
    unique: false,
  },
  { columns: ["roomMessageId"], unique: false },
  { columns: ["roomSessionId"], unique: false },
  { columns: ["deliveryId"], unique: false },
];
const LEGACY_ROOM_DELEGATION_GRANT_COLUMNS = [
  "id",
  "organizationId",
  "roomId",
  "issuedByUserId",
  "fromAgentId",
  "targetAgentId",
  "scope",
  "status",
  "rootMessageId",
  "consumedByInvocationId",
  "consumedAt",
  "revokedAt",
  "createdAt",
  "updatedAt",
];
const DURABLE_ROOM_DELEGATION_GRANT_COLUMNS = [
  ...LEGACY_ROOM_DELEGATION_GRANT_COLUMNS.slice(0, 12),
  "expiresAt",
  "hopLimit",
  "invocationLimit",
  "invocationCount",
  ...LEGACY_ROOM_DELEGATION_GRANT_COLUMNS.slice(12),
];
const DURABLE_ROOM_DELEGATION_GRANT_ADDED_COLUMNS = [
  "expiresAt",
  "hopLimit",
  "invocationLimit",
  "invocationCount",
];
const ROOM_DELEGATION_GRANT_INDEXES = [
  {
    columns: ["organizationId", "roomId", "consumedByInvocationId"],
    unique: true,
  },
  {
    columns: [
      "organizationId",
      "roomId",
      "status",
      "fromAgentId",
      "targetAgentId",
    ],
    unique: false,
  },
];
const LEGACY_ROOM_DELEGATION_GRANT_CHECKS = [
  {
    name: "RoomDelegationGrant_scope_check",
    expression: `"scope" IN ('once', 'room')`,
  },
  {
    name: "RoomDelegationGrant_status_check",
    expression: `"status" IN ('active', 'consumed', 'revoked')`,
  },
];
const DURABLE_ROOM_DELEGATION_TABLES = [
  {
    name: "RoomDelegationGrant",
    columns: DURABLE_ROOM_DELEGATION_GRANT_COLUMNS,
    indexes: ROOM_DELEGATION_GRANT_INDEXES,
    checks: [
      ...LEGACY_ROOM_DELEGATION_GRANT_CHECKS,
      {
        name: "RoomDelegationGrant_agents_check",
        expression: `"fromAgentId" <> "targetAgentId"`,
      },
      {
        name: "RoomDelegationGrant_limits_check",
        expression: `"hopLimit" > 0 AND "invocationLimit" > 0`,
      },
      {
        name: "RoomDelegationGrant_count_check",
        expression: `"invocationCount" >= 0 AND "invocationCount" <= "invocationLimit"`,
      },
    ],
  },
  {
    name: "RoomDelegationRootBudget",
    columns: [
      "id",
      "organizationId",
      "roomId",
      "rootMessageId",
      "invocationLimit",
      "invocationCount",
      "createdAt",
      "updatedAt",
    ],
    indexes: [
      {
        columns: ["organizationId", "roomId", "rootMessageId"],
        unique: true,
      },
      {
        columns: ["organizationId", "roomId", "updatedAt"],
        unique: false,
      },
    ],
    checks: [
      {
        name: "RoomDelegationRootBudget_limit_check",
        expression: `"invocationLimit" > 0`,
      },
      {
        name: "RoomDelegationRootBudget_count_check",
        expression: `"invocationCount" >= 0 AND "invocationCount" <= "invocationLimit"`,
      },
    ],
  },
  {
    name: "RoomDelegationInvocation",
    columns: [
      "id",
      "organizationId",
      "roomId",
      "invocationId",
      "requestHash",
      "grantId",
      "rootMessageId",
      "fromAgentId",
      "targetAgentId",
      "sourceRoomSessionId",
      "sourceDeliveryId",
      "sourceGeneration",
      "parentInvocationId",
      "hop",
      "instructionMessageId",
      "targetDeliveryId",
      "acceptedEventId",
      "blockedEventId",
      "failureCode",
      "status",
      "completedAt",
      "createdAt",
      "updatedAt",
    ],
    indexes: [
      { columns: ["targetDeliveryId"], unique: true },
      {
        columns: ["organizationId", "roomId", "invocationId"],
        unique: true,
      },
      {
        columns: ["organizationId", "roomId", "rootMessageId", "status"],
        unique: false,
      },
      { columns: ["grantId", "status", "createdAt"], unique: false },
      { columns: ["parentInvocationId"], unique: false },
      {
        columns: ["sourceRoomSessionId", "sourceDeliveryId"],
        unique: false,
      },
    ],
    checks: [
      {
        name: "RoomDelegationInvocation_agents_check",
        expression: `"status" <> 'accepted' OR "fromAgentId" <> "targetAgentId"`,
      },
      {
        name: "RoomDelegationInvocation_generation_check",
        expression: `"sourceGeneration" >= 0`,
      },
      {
        name: "RoomDelegationInvocation_hop_check",
        expression: `"hop" > 0`,
      },
      {
        name: "RoomDelegationInvocation_status_check",
        expression: `"status" IN ('accepted', 'blocked')`,
      },
      {
        name: "RoomDelegationInvocation_accepted_receipt_check",
        expression: `"status" <> 'accepted' OR ("grantId" IS NOT NULL AND "instructionMessageId" IS NOT NULL AND "targetDeliveryId" IS NOT NULL AND "acceptedEventId" IS NOT NULL AND "blockedEventId" IS NULL AND "failureCode" IS NULL)`,
      },
      {
        name: "RoomDelegationInvocation_blocked_receipt_check",
        expression: `"status" <> 'blocked' OR ("blockedEventId" IS NOT NULL AND "failureCode" IS NOT NULL AND "targetDeliveryId" IS NULL AND "acceptedEventId" IS NULL)`,
      },
    ],
  },
];
const DURABLE_ROOM_DELEGATION_DATA_VALIDATION_QUERIES = [
  `
    SELECT 1
    FROM "RoomDelegationGrant"
    WHERE "scope" NOT IN ('once', 'room')
      OR "status" NOT IN ('active', 'consumed', 'revoked')
      OR "fromAgentId" = "targetAgentId"
      OR "hopLimit" <= 0
      OR "invocationLimit" <= 0
      OR "invocationCount" < 0
      OR "invocationCount" > "invocationLimit"
    LIMIT 1
  `,
  `
    SELECT 1
    FROM "RoomDelegationRootBudget"
    WHERE "invocationLimit" <= 0
      OR "invocationCount" < 0
      OR "invocationCount" > "invocationLimit"
    LIMIT 1
  `,
  `
    SELECT 1
    FROM "RoomDelegationInvocation"
    WHERE ("status" = 'accepted' AND "fromAgentId" = "targetAgentId")
      OR "sourceGeneration" < 0
      OR "hop" <= 0
      OR "status" NOT IN ('accepted', 'blocked')
      OR (
        "status" = 'accepted'
        AND NOT (
          "grantId" IS NOT NULL
          AND "instructionMessageId" IS NOT NULL
          AND "targetDeliveryId" IS NOT NULL
          AND "acceptedEventId" IS NOT NULL
          AND "blockedEventId" IS NULL
          AND "failureCode" IS NULL
        )
      )
      OR (
        "status" = 'blocked'
        AND NOT (
          "blockedEventId" IS NOT NULL
          AND "failureCode" IS NOT NULL
          AND "targetDeliveryId" IS NULL
          AND "acceptedEventId" IS NULL
        )
      )
    LIMIT 1
  `,
];
const DURABLE_ROOM_DELEGATION_REPAIR_SQL = `
  PRAGMA foreign_keys=OFF;

  ALTER TABLE "RoomDelegationInvocation" RENAME TO "old_RoomDelegationInvocation";
  ALTER TABLE "RoomDelegationRootBudget" RENAME TO "old_RoomDelegationRootBudget";
  ALTER TABLE "RoomDelegationGrant" RENAME TO "old_RoomDelegationGrant";
  DROP INDEX "RoomDelegationGrant_organizationId_roomId_consumedByInvocationId_key";
  DROP INDEX "RoomDelegationGrant_organizationId_roomId_status_fromAgentId_targetAgentId_idx";
  DROP INDEX "RoomDelegationRootBudget_organizationId_roomId_rootMessageId_key";
  DROP INDEX "RoomDelegationRootBudget_organizationId_roomId_updatedAt_idx";
  DROP INDEX "RoomDelegationInvocation_targetDeliveryId_key";
  DROP INDEX "RoomDelegationInvocation_organizationId_roomId_invocationId_key";
  DROP INDEX "RoomDelegationInvocation_organizationId_roomId_rootMessageId_status_idx";
  DROP INDEX "RoomDelegationInvocation_grantId_status_createdAt_idx";
  DROP INDEX "RoomDelegationInvocation_parentInvocationId_idx";
  DROP INDEX "RoomDelegationInvocation_sourceRoomSessionId_sourceDeliveryId_idx";

  CREATE TABLE "RoomDelegationGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "roomId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rootMessageId" TEXT,
    "consumedByInvocationId" TEXT,
    "consumedAt" DATETIME,
    "revokedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL DEFAULT (datetime('now', '+30 days')),
    "hopLimit" INTEGER NOT NULL DEFAULT 3,
    "invocationLimit" INTEGER NOT NULL DEFAULT 8,
    "invocationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoomDelegationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationGrant_scope_check" CHECK ("scope" IN ('once', 'room')),
    CONSTRAINT "RoomDelegationGrant_status_check" CHECK ("status" IN ('active', 'consumed', 'revoked')),
    CONSTRAINT "RoomDelegationGrant_agents_check" CHECK ("fromAgentId" <> "targetAgentId"),
    CONSTRAINT "RoomDelegationGrant_limits_check" CHECK ("hopLimit" > 0 AND "invocationLimit" > 0),
    CONSTRAINT "RoomDelegationGrant_count_check" CHECK ("invocationCount" >= 0 AND "invocationCount" <= "invocationLimit")
  );
  INSERT INTO "RoomDelegationGrant" SELECT * FROM "old_RoomDelegationGrant";
  CREATE UNIQUE INDEX "RoomDelegationGrant_organizationId_roomId_consumedByInvocationId_key" ON "RoomDelegationGrant"("organizationId", "roomId", "consumedByInvocationId");
  CREATE INDEX "RoomDelegationGrant_organizationId_roomId_status_fromAgentId_targetAgentId_idx" ON "RoomDelegationGrant"("organizationId", "roomId", "status", "fromAgentId", "targetAgentId");

  CREATE TABLE "RoomDelegationRootBudget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "roomId" TEXT NOT NULL,
    "rootMessageId" TEXT NOT NULL,
    "invocationLimit" INTEGER NOT NULL,
    "invocationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoomDelegationRootBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationRootBudget_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationRootBudget_limit_check" CHECK ("invocationLimit" > 0),
    CONSTRAINT "RoomDelegationRootBudget_count_check" CHECK ("invocationCount" >= 0 AND "invocationCount" <= "invocationLimit")
  );
  INSERT INTO "RoomDelegationRootBudget" SELECT * FROM "old_RoomDelegationRootBudget";
  CREATE UNIQUE INDEX "RoomDelegationRootBudget_organizationId_roomId_rootMessageId_key" ON "RoomDelegationRootBudget"("organizationId", "roomId", "rootMessageId");
  CREATE INDEX "RoomDelegationRootBudget_organizationId_roomId_updatedAt_idx" ON "RoomDelegationRootBudget"("organizationId", "roomId", "updatedAt");

  CREATE TABLE "RoomDelegationInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "roomId" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "grantId" TEXT,
    "rootMessageId" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "sourceRoomSessionId" TEXT NOT NULL,
    "sourceDeliveryId" TEXT NOT NULL,
    "sourceGeneration" INTEGER NOT NULL,
    "parentInvocationId" TEXT,
    "hop" INTEGER NOT NULL,
    "instructionMessageId" TEXT,
    "targetDeliveryId" TEXT,
    "acceptedEventId" TEXT,
    "blockedEventId" TEXT,
    "failureCode" TEXT,
    "status" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoomDelegationInvocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "RoomDelegationGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_sourceRoomSessionId_fkey" FOREIGN KEY ("sourceRoomSessionId") REFERENCES "RoomAgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_sourceDeliveryId_fkey" FOREIGN KEY ("sourceDeliveryId") REFERENCES "RoomInboxDelivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_parentInvocationId_fkey" FOREIGN KEY ("parentInvocationId") REFERENCES "RoomDelegationInvocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_instructionMessageId_fkey" FOREIGN KEY ("instructionMessageId") REFERENCES "RoomMessage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_targetDeliveryId_fkey" FOREIGN KEY ("targetDeliveryId") REFERENCES "RoomInboxDelivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_acceptedEventId_fkey" FOREIGN KEY ("acceptedEventId") REFERENCES "RoomEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_blockedEventId_fkey" FOREIGN KEY ("blockedEventId") REFERENCES "RoomEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomDelegationInvocation_agents_check" CHECK ("status" <> 'accepted' OR "fromAgentId" <> "targetAgentId"),
    CONSTRAINT "RoomDelegationInvocation_generation_check" CHECK ("sourceGeneration" >= 0),
    CONSTRAINT "RoomDelegationInvocation_hop_check" CHECK ("hop" > 0),
    CONSTRAINT "RoomDelegationInvocation_status_check" CHECK ("status" IN ('accepted', 'blocked')),
    CONSTRAINT "RoomDelegationInvocation_accepted_receipt_check" CHECK ("status" <> 'accepted' OR ("grantId" IS NOT NULL AND "instructionMessageId" IS NOT NULL AND "targetDeliveryId" IS NOT NULL AND "acceptedEventId" IS NOT NULL AND "blockedEventId" IS NULL AND "failureCode" IS NULL)),
    CONSTRAINT "RoomDelegationInvocation_blocked_receipt_check" CHECK ("status" <> 'blocked' OR ("blockedEventId" IS NOT NULL AND "failureCode" IS NOT NULL AND "targetDeliveryId" IS NULL AND "acceptedEventId" IS NULL))
  );
  INSERT INTO "RoomDelegationInvocation" SELECT * FROM "old_RoomDelegationInvocation";
  DROP TABLE "old_RoomDelegationInvocation";
  DROP TABLE "old_RoomDelegationRootBudget";
  DROP TABLE "old_RoomDelegationGrant";
  CREATE UNIQUE INDEX "RoomDelegationInvocation_targetDeliveryId_key" ON "RoomDelegationInvocation"("targetDeliveryId");
  CREATE UNIQUE INDEX "RoomDelegationInvocation_organizationId_roomId_invocationId_key" ON "RoomDelegationInvocation"("organizationId", "roomId", "invocationId");
  CREATE INDEX "RoomDelegationInvocation_organizationId_roomId_rootMessageId_status_idx" ON "RoomDelegationInvocation"("organizationId", "roomId", "rootMessageId", "status");
  CREATE INDEX "RoomDelegationInvocation_grantId_status_createdAt_idx" ON "RoomDelegationInvocation"("grantId", "status", "createdAt");
  CREATE INDEX "RoomDelegationInvocation_parentInvocationId_idx" ON "RoomDelegationInvocation"("parentInvocationId");
  CREATE INDEX "RoomDelegationInvocation_sourceRoomSessionId_sourceDeliveryId_idx" ON "RoomDelegationInvocation"("sourceRoomSessionId", "sourceDeliveryId");

  PRAGMA foreign_key_check;
  PRAGMA foreign_keys=ON;
`;
const EMPTY_AGENT_CAPABILITIES = '{"schemaVersion":1,"skills":[]}';
const AGENT_PROFILE_MANAGEMENT_REPAIR_SQL = `
  UPDATE "AgentProfile"
  SET "capabilitiesJson" = json_object(
    'schemaVersion', 1,
    'skills', json("skillsJson")
  )
  WHERE CASE
    WHEN json_valid("skillsJson")
      AND json_type("skillsJson") = 'array'
      AND json_valid("capabilitiesJson")
    THEN json("capabilitiesJson") = json('${EMPTY_AGENT_CAPABILITIES}')
      AND json("capabilitiesJson") <> json(json_object(
        'schemaVersion', 1,
        'skills', json("skillsJson")
      ))
    ELSE 0
  END;

  UPDATE "RoomAgentSession"
  SET "agentConfigVersion" = '1'
  WHERE "agentConfigVersion" = 'v1';
`;
const DOCUMENT_PROPOSAL_CAS_REPAIR_SQL = `
  UPDATE "StagedChangeSet"
  SET "status" = 'discarded',
      "discardedAt" = COALESCE("discardedAt", CURRENT_TIMESTAMP),
      "reviewedAt" = COALESCE("reviewedAt", CURRENT_TIMESTAMP),
      "revision" = "revision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "status" = 'pending'
    AND (
      "baseDraftRevision" IS NULL
      OR "patchSchemaVersion" IS NULL
      OR "patchSha256" IS NULL
      OR ("baseVersionId" IS NOT NULL AND "baseVersionSha256" IS NULL)
    );

  DROP TRIGGER IF EXISTS "Version_immutable_snapshot_update";

  CREATE TRIGGER "Version_immutable_snapshot_update"
  BEFORE UPDATE OF
    "id", "organizationId", "documentId", "versionNum", "content",
    "title", "parentVersionId", "sourceSessionId", "sourceMessageId",
    "versionType", "lockedAt", "createdByUserId", "originDeviceId"
  ON "Version"
  FOR EACH ROW
  WHEN
    NEW."id" IS NOT OLD."id" OR
    NEW."organizationId" IS NOT OLD."organizationId" OR
    NEW."documentId" IS NOT OLD."documentId" OR
    NEW."versionNum" IS NOT OLD."versionNum" OR
    NEW."content" IS NOT OLD."content" OR
    NEW."title" IS NOT OLD."title" OR
    NEW."parentVersionId" IS NOT OLD."parentVersionId" OR
    NEW."sourceSessionId" IS NOT OLD."sourceSessionId" OR
    NEW."sourceMessageId" IS NOT OLD."sourceMessageId" OR
    NEW."versionType" IS NOT OLD."versionType" OR
    NEW."lockedAt" IS NOT OLD."lockedAt" OR
    NEW."createdByUserId" IS NOT OLD."createdByUserId" OR
    NEW."originDeviceId" IS NOT OLD."originDeviceId"
  BEGIN
    SELECT RAISE(ABORT, 'Version snapshot fields are immutable');
  END;
`;
const MIGRATION_ACTION_MARK = "mark";
const MIGRATION_ACTION_APPLY = "apply";
const MIGRATION_ACTION_REPAIR = "repair";

export const MIGRATION_PROBES = {
  "20260312090000_current_schema_baseline": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Organization"),
        inspector.hasTable("User"),
        inspector.hasTable("Session"),
        inspector.hasTable("Document"),
        inspector.hasTable("Version"),
        inspector.hasTable("WorkspacePlan"),
      ])
    ).every(Boolean),
  "20260313100000_add_project_root_path": async (inspector) =>
    inspector.hasColumn("Document", "projectRootPath"),
  "20260314093000_add_workspace_project_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "projectId"),
        inspector.hasColumn("Document", "projectTitle"),
        inspector.hasColumn("Document", "parentDocumentId"),
      ])
    ).every(Boolean),
  "20260314112000_add_project_folders": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "projectFolderId"),
        inspector.hasTable("ProjectFolder"),
      ])
    ).every(Boolean),
  "20260314143000_add_project_tree_sort_order": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "treeSortOrder"),
        inspector.hasColumn("ProjectFolder", "treeSortOrder"),
      ])
    ).every(Boolean),
  "20260314160000_rename_version_snapshot_type": async (inspector) =>
    inspector.hasColumn("Version", "versionType"),
  "20260314190000_add_workflow_playbooks": async (inspector) =>
    inspector.hasTable("WorkflowPlaybook"),
  "20260314193000_add_active_workflow_playbook_to_workspace_plan": async (
    inspector,
  ) => inspector.hasColumn("WorkspacePlan", "activeWorkflowPlaybookId"),
  "20260314203000_add_workflow_playbook_structure_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("WorkflowPlaybook", "steps"),
        inspector.hasColumn("WorkflowPlaybook", "constraints"),
        inspector.hasColumn("WorkflowPlaybook", "checklist"),
      ])
    ).every(Boolean),
  "20260314210000_add_workflow_playbook_archiving": async (inspector) =>
    inspector.hasColumn("WorkflowPlaybook", "archivedAt"),
  "20260314220000_finalize_workspace_status_and_playbook_lifecycle": async (
    inspector,
  ) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "draftRevision"),
        inspector.hasColumn("WorkflowPlaybook", "status"),
      ])
    ).every(Boolean),
  "20260316120000_add_comment_agents": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("CommentThread", "agentBindingsJson"),
        inspector.hasColumn("CommentMessage", "mentionedAgentsJson"),
        inspector.hasColumn("CommentMessage", "agentId"),
        inspector.hasColumn("CommentMessage", "agentLabel"),
      ])
    ).every(Boolean),
  "20260316153000_add_comment_research_state": async (inspector) =>
    inspector.hasColumn("CommentThread", "researchStateJson"),
  "20260317193000_add_workspace_draft_base_version": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "draftBaseVersionId"),
        inspector.hasIndex("Document_draftBaseVersionId_idx"),
      ])
    ).every(Boolean),
  "20260318170000_add_workflow_playbook_extension_hints": async (inspector) =>
    inspector.hasColumn("WorkflowPlaybook", "extensionHints"),
  "20260321120000_add_state_labels": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Label"),
        inspector.hasColumn("Label", "organizationId"),
        inspector.hasColumn("Label", "versionId"),
        inspector.hasColumn("Label", "kind"),
        inspector.hasColumn("Label", "name"),
        inspector.hasIndex("Label_organizationId_createdAt_idx"),
        inspector.hasIndex("Label_versionId_createdAt_idx"),
      ])
    ).every(Boolean),
  "20260321143000_backfill_milestone_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND "Version"."versionType" = 'manual'
        AND NOT EXISTS (
          SELECT 1
          FROM "Label"
          WHERE "Label"."deletedAt" IS NULL
            AND "Label"."kind" = 'milestone'
            AND "Label"."versionId" = "Version"."id"
        )
      LIMIT 1
    `),
  "20260321150000_backfill_head_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND "Version"."versionType" = 'manual'
        AND NOT EXISTS (
          SELECT 1
          FROM "Version" AS "ChildVersion"
          WHERE "ChildVersion"."deletedAt" IS NULL
            AND "ChildVersion"."organizationId" = "Version"."organizationId"
            AND "ChildVersion"."parentVersionId" = "Version"."id"
            AND "ChildVersion"."versionType" NOT IN ('checkpoint', 'checkpoint_pinned')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "Label"
          WHERE "Label"."deletedAt" IS NULL
            AND "Label"."kind" = 'head'
            AND "Label"."versionId" = "Version"."id"
        )
      LIMIT 1
    `),
  "20260321170000_backfill_recovery_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND (
          (
            "Version"."versionType" IN ('checkpoint', 'checkpoint_pinned')
            AND NOT EXISTS (
              SELECT 1
              FROM "Label"
              WHERE "Label"."deletedAt" IS NULL
                AND "Label"."kind" = 'recovery'
                AND "Label"."versionId" = "Version"."id"
            )
          )
          OR (
            "Version"."versionType" = 'checkpoint_pinned'
            AND NOT EXISTS (
              SELECT 1
              FROM "Label"
              WHERE "Label"."deletedAt" IS NULL
                AND "Label"."kind" = 'pinned'
                AND "Label"."versionId" = "Version"."id"
            )
          )
        )
      LIMIT 1
    `),
  "20260321190000_unify_notes": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Note"),
        inspector.hasColumn("Note", "scope"),
        inspector.hasColumn("Note", "scopeId"),
        inspector.hasColumn("Note", "kind"),
        inspector.hasColumn("Note", "source"),
        inspector.hasIndex("Note_organizationId_createdAt_idx"),
        inspector.hasIndex("Note_organizationId_scope_scopeId_createdAt_idx"),
        inspector.lacksTable("KnowledgeItem"),
        inspector.lacksTable("Memory"),
      ])
    ).every(Boolean),
  "20260323015000_add_project_scoped_conversation_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Session", "projectId"),
        inspector.hasColumn("ChatMessage", "focusNodeId"),
      ])
    ).every(Boolean),
  "20260323043000_add_project_mounts": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ProjectMount"),
        inspector.hasColumn("ProjectMount", "sourceProjectId"),
        inspector.hasColumn("ProjectMount", "targetProjectId"),
      ])
    ).every(Boolean),
  "20260324040000_add_canvas_meta": async (inspector) =>
    inspector.hasColumn("Document", "canvasMetaJson"),
  "20260820120000_add_team_tasks": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("AgentProfile"),
        inspector.hasTable("TeamTask"),
        inspector.hasTable("TaskActivity"),
        inspector.hasColumn("TeamTask", "workspaceId"),
        inspector.hasColumn("TaskActivity", "metadataJson"),
      ])
    ).every(Boolean),
  "20260820123000_add_team_task_revision": async (inspector) =>
    inspector.hasColumn("TeamTask", "revision"),
  "20260821020000_add_execution_engine": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionRuntime"),
        inspector.hasTable("ExecutionJob"),
        inspector.hasTable("ExecutionAttempt"),
        inspector.hasTable("ExecutionEvent"),
        inspector.hasTable("ExecutionArtifact"),
        inspector.hasColumn("ExecutionAttempt", "generation"),
        inspector.hasColumn("ExecutionJob", "contextManifestJson"),
      ])
    ).every(Boolean),
  "20260821030000_add_git_knowledge_control_plane": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("KnowledgeSpace"),
        inspector.hasTable("KnowledgeBinding"),
        inspector.hasTable("KnowledgeSnapshot"),
        inspector.hasTable("KnowledgeChangeRequest"),
        inspector.hasColumn("KnowledgeSpace", "readPolicy"),
        inspector.hasColumn("KnowledgeSnapshot", "changeRequestId"),
        inspector.hasColumn("KnowledgeChangeRequest", "revision"),
      ])
    ).every(Boolean),
  "20260821040000_add_attempt_workspace_lifecycle": async (inspector) =>
    inspector.hasColumn("ExecutionAttempt", "workspaceLifecycleJson"),
  "20260821050000_add_knowledge_merge_operations": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("KnowledgeMergeOperation"),
        inspector.hasColumn("KnowledgeSpace", "activeSnapshotId"),
        inspector.hasColumn("KnowledgeSnapshot", "artifactPath"),
        inspector.hasColumn("KnowledgeSnapshot", "artifactSha256"),
        inspector.hasColumn("KnowledgeSnapshot", "readyAt"),
      ])
    ).every(Boolean),
  "20260821060000_add_project_rooms": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Room"),
        inspector.hasTable("RoomMessage"),
        inspector.hasTable("RoomMention"),
        inspector.hasTable("RoomAgentSession"),
        inspector.hasTable("RoomInboxDelivery"),
        inspector.hasTable("RoomEvent"),
        inspector.hasTable("RoomOutbox"),
        inspector.hasTable("RoomDelegationGrant"),
        inspector.hasColumn("RoomAgentSession", "generation"),
        inspector.hasColumn("RoomAgentSession", "checkpointJson"),
      ])
    ).every(Boolean),
  "20260821070000_add_execution_input_requests": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionInputRequest"),
        inspector.hasColumn("ExecutionInputRequest", "requestKey"),
        inspector.hasColumn("ExecutionInputRequest", "responseJson"),
        inspector.hasColumn("ExecutionInputRequest", "revision"),
      ])
    ).every(Boolean),
  "20260821080000_harden_execution_waiting_input": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("ExecutionAttempt", "capacityReserved"),
        inspector.hasColumn("ExecutionInputRequest", "responseId"),
      ])
    ).every(Boolean),
  "20260821090000_add_execution_room_projection": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionOutbox"),
        inspector.hasColumn("ExecutionJob", "originRoomId"),
        inspector.hasColumn("ExecutionJob", "originRoomMessageId"),
      ])
    ).every(Boolean),
  "20260821100000_add_room_tool_confirmation_grants": async (inspector) =>
    (await inspector.hasTable("RoomToolConfirmationGrant")) ||
    (await inspector.hasTable("RoomToolConfirmationRequest")),
  "20260821110000_add_execution_recovery_incidents": async (inspector) =>
    inspector.hasTable("ExecutionRecoveryIncident"),
  "20260821120000_add_room_context_summary_cache": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("RoomContextSummaryCache"),
        inspector.hasColumn("RoomContextSummaryCache", "sourceHash"),
        inspector.hasColumn("RoomContextSummaryCache", "aclHash"),
        inspector.hasColumn("RoomContextSummaryCache", "configVersion"),
      ])
    ).every(Boolean),
  "20260821150000_add_aligned_label_atomicity": async (inspector) =>
    (await inspector.hasPartialUniqueIndex(
      "Label",
      ["versionId"],
      `WHERE "kind" = 'aligned' AND "deletedAt" IS NULL`,
    )) &&
    (await inspector.hasNoRows(`
      SELECT 1
      FROM "Label"
      WHERE "kind" = 'aligned'
        AND "deletedAt" IS NULL
      GROUP BY "versionId"
      HAVING COUNT(*) > 1
      LIMIT 1
    `)),
  [AGENT_PROFILE_MANAGEMENT_MIGRATION]: async (inspector) =>
    hasCompleteAgentProfileManagementSchema(inspector),
  [ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION]: async (inspector) =>
    (await hasCompleteRoomToolConfirmationRequestSchema(inspector)) &&
    (await inspector.lacksTable("RoomToolConfirmationGrant")),
  [DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION]: async (inspector) =>
    hasCompleteDurableRoomDelegationLedgerSchema(inspector),
  [DOCUMENT_PROPOSAL_CAS_MIGRATION]: async (inspector) =>
    hasCompleteDocumentProposalCasSchema(inspector),
  [CANVAS_TABLES_MIGRATION]: async (inspector) =>
    (
      await Promise.all(
        CANVAS_TABLES.map((table) =>
          hasCompleteTableSchema(inspector, table),
        ),
      )
    ).every(Boolean),
  [TEAM_SCOPED_CONVERSATIONS_MIGRATION]: async (inspector) =>
    hasCompleteTeamScopedConversationSchema(inspector),
};

async function hasCompleteTeamScopedConversationSchema(inspector) {
  const [sessionChecks, assistantRunChecks, lacksTemporaryAssistantRunTable] =
    await Promise.all([
      Promise.all([
        inspector.hasColumnDefinition(
          "Session",
          TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN,
        ),
        inspector.hasNamedIndexOnColumns(
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.table,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.columns,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.unique,
        ),
      ]),
      Promise.all([
        inspector.hasColumnDefinition(
          "AssistantRun",
          TEAM_SCOPED_CONVERSATION_CURRENT_DOCUMENT_COLUMN,
        ),
        inspector.hasColumnDefinition(
          "AssistantRun",
          TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN,
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map(
          (foreignKey) => inspector.hasForeignKey("AssistantRun", foreignKey),
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES.map((index) =>
          inspector.hasNamedIndexOnColumns(
            index.table,
            index.name,
            index.columns,
            index.unique,
          ),
        ),
      ]),
      inspector.lacksTable("new_AssistantRun"),
    ]);

  return (
    lacksTemporaryAssistantRunTable &&
    sessionChecks.every(Boolean) &&
    assistantRunChecks.every(Boolean)
  );
}

async function hasUntouchedLegacyTeamScopedConversationSchema(inspector) {
  const [sessionChecks, assistantRunChecks] = await Promise.all([
    Promise.all([
      inspector.hasTable("Session"),
      inspector.hasColumn("Session", TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name),
      inspector.hasIndex(TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name),
    ]),
    Promise.all([
      inspector.hasTable("AssistantRun"),
      inspector.hasColumnDefinition(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN,
      ),
      inspector.hasColumn(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name,
      ),
      inspector.hasIndex("AssistantRun_organizationId_scopeKind_startedAt_idx"),
      ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map((foreignKey) =>
        inspector.hasForeignKey("AssistantRun", foreignKey),
      ),
      ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES
        .filter(
          (index) =>
            index.name !== "AssistantRun_organizationId_scopeKind_startedAt_idx",
        )
        .map((index) =>
          inspector.hasNamedIndexOnColumns(
            index.table,
            index.name,
            index.columns,
            index.unique,
          ),
        ),
    ]),
  ]);

  const [hasSessionTable, hasSessionScopeColumn, hasSessionScopeIndex] =
    sessionChecks;
  const [
    hasAssistantRunTable,
    hasLegacyDocumentColumn,
    hasAssistantRunScopeColumn,
    hasAssistantRunScopeIndex,
    ...assistantRunIntegrityChecks
  ] = assistantRunChecks;

  return (
    hasSessionTable &&
    hasAssistantRunTable &&
    hasLegacyDocumentColumn &&
    !hasSessionScopeColumn &&
    !hasSessionScopeIndex &&
    !hasAssistantRunScopeColumn &&
    !hasAssistantRunScopeIndex &&
    assistantRunIntegrityChecks.every(Boolean)
  );
}

async function hasCompleteAgentProfileManagementSchema(inspector) {
  const [hasAgentProfileTable, hasRoomAgentSessionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("AgentProfile"),
      inspector.hasTable("RoomAgentSession"),
      ...AGENT_PROFILE_MANAGEMENT_COLUMNS.map((column) =>
        inspector.hasColumn("AgentProfile", column),
      ),
    ]);

  if (
    !hasAgentProfileTable ||
    !hasRoomAgentSessionTable ||
    !columnPresence.every(Boolean)
  ) {
    return false;
  }

  return !(await hasRepairableAgentProfileManagementData(inspector));
}

async function hasCompleteRoomToolConfirmationRequestSchema(inspector) {
  if (!(await inspector.hasTable("RoomToolConfirmationRequest"))) {
    return false;
  }

  const columnChecks = await Promise.all(
    ROOM_TOOL_CONFIRMATION_REQUEST_COLUMNS.map((column) =>
      inspector.hasColumn("RoomToolConfirmationRequest", column),
    ),
  );
  if (!columnChecks.every(Boolean)) {
    return false;
  }

  const indexChecks = await Promise.all(
    ROOM_TOOL_CONFIRMATION_REQUEST_INDEXES.map((index) =>
      inspector.hasIndexOnColumns(
        "RoomToolConfirmationRequest",
        index.columns,
        index.unique,
      ),
    ),
  );
  return indexChecks.every(Boolean);
}

async function hasCompleteDurableRoomDelegationLedgerSchema(inspector) {
  const [tableChecks, lacksTemporaryGrantTable] = await Promise.all([
    Promise.all(
      DURABLE_ROOM_DELEGATION_TABLES.map((table) =>
        hasCompleteTableSchema(inspector, table),
      ),
    ),
    inspector.lacksTable("new_RoomDelegationGrant"),
  ]);
  return lacksTemporaryGrantTable && tableChecks.every(Boolean);
}

async function hasCompleteDocumentProposalCasSchema(inspector) {
  const [
    hasChangeSetTable,
    hasVersionTable,
    ...schemaChecks
  ] = await Promise.all([
    inspector.hasTable("StagedChangeSet"),
    inspector.hasTable("Version"),
    ...DOCUMENT_PROPOSAL_CAS_COLUMNS.map((column) =>
      inspector.hasColumn("StagedChangeSet", column),
    ),
    ...DOCUMENT_PROPOSAL_CAS_INDEXES.map((index) =>
      inspector.hasIndexOnColumns(
        "StagedChangeSet",
        index.columns,
        index.unique,
      ),
    ),
    ...DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS.map((foreignKey) =>
      inspector.hasForeignKey("StagedChangeSet", foreignKey),
    ),
    inspector.hasTrigger(VERSION_IMMUTABLE_TRIGGER, "Version"),
  ]);
  if (!hasChangeSetTable || !hasVersionTable || !schemaChecks.every(Boolean)) {
    return false;
  }

  return !(await hasLegacyPendingDocumentProposals(inspector));
}

async function hasCompleteTableSchema(inspector, table) {
  if (
    !(await inspector.hasTable(table.name)) ||
    !(await inspector.hasExactColumns(table.name, table.columns))
  ) {
    return false;
  }

  const [indexChecks, foreignKeyChecks, constraintChecks] = await Promise.all([
    Promise.all(
      table.indexes.map((index) =>
        index.name === undefined
          ? inspector.hasIndexOnColumns(
              table.name,
              index.columns,
              index.unique,
            )
          : inspector.hasNamedIndexOnColumns(
              table.name,
              index.name,
              index.columns,
              index.unique,
            ),
      ),
    ),
    Promise.all(
      (table.foreignKeys ?? []).map((foreignKey) =>
        inspector.hasForeignKey(table.name, foreignKey),
      ),
    ),
    Promise.all(
      table.checks.map((check) =>
        inspector.hasCheckConstraint(
          table.name,
          check.name,
          check.expression,
        ),
      ),
    ),
  ]);

  return [...indexChecks, ...foreignKeyChecks, ...constraintChecks].every(Boolean);
}

async function hasCompleteTableShapeWithoutChecks(inspector, table) {
  if (
    !(await inspector.hasTable(table.name)) ||
    !(await inspector.hasExactColumns(table.name, table.columns))
  ) {
    return false;
  }

  const indexChecks = await Promise.all(
    table.indexes.map((index) =>
      inspector.hasIndexOnColumns(table.name, index.columns, index.unique),
    ),
  );
  return indexChecks.every(Boolean);
}

async function hasCompleteLegacyRoomDelegationGrantSchema(inspector) {
  if (
    !(await inspector.hasTable("RoomDelegationGrant")) ||
    !(await inspector.hasExactColumns(
      "RoomDelegationGrant",
      LEGACY_ROOM_DELEGATION_GRANT_COLUMNS,
    ))
  ) {
    return false;
  }

  const [indexChecks, constraintChecks] = await Promise.all([
    Promise.all(
      ROOM_DELEGATION_GRANT_INDEXES.map((index) =>
        inspector.hasIndexOnColumns(
          "RoomDelegationGrant",
          index.columns,
          index.unique,
        ),
      ),
    ),
    Promise.all(
      LEGACY_ROOM_DELEGATION_GRANT_CHECKS.map((check) =>
        inspector.hasCheckConstraint(
          "RoomDelegationGrant",
          check.name,
          check.expression,
        ),
      ),
    ),
  ]);

  return [...indexChecks, ...constraintChecks].every(Boolean);
}

async function hasRepairableAgentProfileManagementData(inspector) {
  const [hasLegacyCapabilitiesRows, hasLegacyRoomSessionRows] =
    await Promise.all([
      inspector.hasAnyRows(`
        SELECT 1
        FROM "AgentProfile"
        WHERE CASE
          WHEN json_valid("skillsJson")
            AND json_type("skillsJson") = 'array'
            AND json_valid("capabilitiesJson")
          THEN json("capabilitiesJson") = json('${EMPTY_AGENT_CAPABILITIES}')
            AND json("capabilitiesJson") <> json(json_object(
              'schemaVersion', 1,
              'skills', json("skillsJson")
            ))
          ELSE 0
        END
        LIMIT 1
      `),
      inspector.hasAnyRows(`
        SELECT 1
        FROM "RoomAgentSession"
        WHERE "agentConfigVersion" = 'v1'
        LIMIT 1
      `),
    ]);

  return hasLegacyCapabilitiesRows || hasLegacyRoomSessionRows;
}

async function hasLegacyPendingDocumentProposals(inspector) {
  return inspector.hasAnyRows(`
    SELECT 1
    FROM "StagedChangeSet"
    WHERE "status" = 'pending'
      AND (
        "baseDraftRevision" IS NULL
        OR "patchSchemaVersion" IS NULL
        OR "patchSha256" IS NULL
        OR ("baseVersionId" IS NOT NULL AND "baseVersionSha256" IS NULL)
      )
    LIMIT 1
  `);
}

async function resolveMigrationStrategy(migrationName, inspector) {
  if (migrationName === AGENT_PROFILE_MANAGEMENT_MIGRATION) {
    return resolveAgentProfileManagementStrategy(inspector);
  }
  if (migrationName === ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION) {
    return resolveRoomToolConfirmationRequestStrategy(inspector);
  }
  if (migrationName === DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION) {
    return resolveDurableRoomDelegationLedgerStrategy(inspector);
  }
  if (migrationName === DOCUMENT_PROPOSAL_CAS_MIGRATION) {
    return resolveDocumentProposalCasStrategy(inspector);
  }
  if (migrationName === TEAM_SCOPED_CONVERSATIONS_MIGRATION) {
    return resolveTeamScopedConversationsStrategy(inspector);
  }

  const probe = MIGRATION_PROBES[migrationName];
  if (probe && (await probe(inspector))) {
    return { action: MIGRATION_ACTION_MARK };
  }
  return { action: MIGRATION_ACTION_APPLY };
}

async function resolveAgentProfileManagementStrategy(inspector) {
  const [hasAgentProfileTable, hasRoomAgentSessionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("AgentProfile"),
      inspector.hasTable("RoomAgentSession"),
      ...AGENT_PROFILE_MANAGEMENT_COLUMNS.map((column) =>
        inspector.hasColumn("AgentProfile", column),
      ),
    ]);

  if (!hasAgentProfileTable || !hasRoomAgentSessionTable) {
    throw new Error(
      `${AGENT_PROFILE_MANAGEMENT_MIGRATION} requires AgentProfile and RoomAgentSession tables to exist before compatibility checks.`,
    );
  }

  const presentColumns = columnPresence.filter(Boolean).length;
  if (
    presentColumns > 0 &&
    presentColumns < AGENT_PROFILE_MANAGEMENT_COLUMNS.length
  ) {
    throw new Error(
      `${AGENT_PROFILE_MANAGEMENT_MIGRATION} detected a partial AgentProfile schema. Refusing to rerun ALTER TABLE against a mixed state.`,
    );
  }

  if (presentColumns === 0) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  if (await hasRepairableAgentProfileManagementData(inspector)) {
    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: AGENT_PROFILE_MANAGEMENT_REPAIR_SQL,
    };
  }

  return { action: MIGRATION_ACTION_MARK };
}

async function resolveRoomToolConfirmationRequestStrategy(inspector) {
  const [hasRequestTable, hasGrantTable] = await Promise.all([
    inspector.hasTable("RoomToolConfirmationRequest"),
    inspector.hasTable("RoomToolConfirmationGrant"),
  ]);

  if (hasRequestTable) {
    if (!(await hasCompleteRoomToolConfirmationRequestSchema(inspector))) {
      throw new Error(
        `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} detected a partial RoomToolConfirmationRequest schema. Refusing to rerun CREATE TABLE against a mixed state.`,
      );
    }
    if (hasGrantTable) {
      throw new Error(
        `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} detected mixed legacy/current room tool confirmation tables. Refusing to guess whether RoomToolConfirmationGrant should be dropped.`,
      );
    }
    return { action: MIGRATION_ACTION_MARK };
  }

  if (hasGrantTable) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  throw new Error(
    `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} could not find either the legacy RoomToolConfirmationGrant table or the current RoomToolConfirmationRequest schema.`,
  );
}

async function resolveDurableRoomDelegationLedgerStrategy(inspector) {
  if (await hasCompleteDurableRoomDelegationLedgerSchema(inspector)) {
    return { action: MIGRATION_ACTION_MARK };
  }

  const [currentTableShapes, lacksTemporaryGrantTable] = await Promise.all([
    Promise.all(
      DURABLE_ROOM_DELEGATION_TABLES.map((table) =>
        hasCompleteTableShapeWithoutChecks(inspector, table),
      ),
    ),
    inspector.lacksTable("new_RoomDelegationGrant"),
  ]);
  if (lacksTemporaryGrantTable && currentTableShapes.every(Boolean)) {
    const invalidDataChecks = await Promise.all(
      DURABLE_ROOM_DELEGATION_DATA_VALIDATION_QUERIES.map((query) =>
        inspector.hasAnyRows(query),
      ),
    );
    if (invalidDataChecks.some(Boolean)) {
      throw new Error(
        `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} found data that violates durable delegation constraints. Refusing to rebuild or record the migration.`,
      );
    }

    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: DURABLE_ROOM_DELEGATION_REPAIR_SQL,
    };
  }

  const [
    hasGrantTable,
    hasRootBudgetTable,
    hasInvocationTable,
    hasTemporaryGrantTable,
    legacyGrantSchemaComplete,
    ...durableGrantColumnPresence
  ] = await Promise.all([
    inspector.hasTable("RoomDelegationGrant"),
    inspector.hasTable("RoomDelegationRootBudget"),
    inspector.hasTable("RoomDelegationInvocation"),
    inspector.hasTable("new_RoomDelegationGrant"),
    hasCompleteLegacyRoomDelegationGrantSchema(inspector),
    ...DURABLE_ROOM_DELEGATION_GRANT_ADDED_COLUMNS.map((column) =>
      inspector.hasColumn("RoomDelegationGrant", column),
    ),
  ]);

  const hasDurableArtifacts =
    hasRootBudgetTable ||
    hasInvocationTable ||
    hasTemporaryGrantTable ||
    durableGrantColumnPresence.some(Boolean);

  if (
    hasGrantTable &&
    legacyGrantSchemaComplete &&
    !hasDurableArtifacts
  ) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  if (hasGrantTable || hasDurableArtifacts) {
    throw new Error(
      `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} detected a partial durable room delegation ledger schema. Refusing to rebuild RoomDelegationGrant or create ledger tables against a mixed state.`,
    );
  }

  throw new Error(
    `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} requires the legacy RoomDelegationGrant table before compatibility checks.`,
  );
}

async function resolveDocumentProposalCasStrategy(inspector) {
  const [hasChangeSetTable, hasVersionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("StagedChangeSet"),
      inspector.hasTable("Version"),
      ...DOCUMENT_PROPOSAL_CAS_COLUMNS.map((column) =>
        inspector.hasColumn("StagedChangeSet", column),
      ),
    ]);

  if (!hasChangeSetTable || !hasVersionTable) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} requires StagedChangeSet and Version tables before compatibility checks.`,
    );
  }

  const presentColumns = columnPresence.filter(Boolean).length;
  if (presentColumns === 0) {
    return { action: MIGRATION_ACTION_APPLY };
  }
  if (presentColumns < DOCUMENT_PROPOSAL_CAS_COLUMNS.length) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} detected a partial StagedChangeSet CAS schema. Refusing to rebuild or record the migration against a mixed state.`,
    );
  }

  const [indexChecks, foreignKeyChecks, hasImmutableTrigger] =
    await Promise.all([
      Promise.all(
        DOCUMENT_PROPOSAL_CAS_INDEXES.map((index) =>
          inspector.hasIndexOnColumns(
            "StagedChangeSet",
            index.columns,
            index.unique,
          ),
        ),
      ),
      Promise.all(
        DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS.map((foreignKey) =>
          inspector.hasForeignKey("StagedChangeSet", foreignKey),
        ),
      ),
      inspector.hasTrigger(VERSION_IMMUTABLE_TRIGGER, "Version"),
    ]);

  if (!indexChecks.every(Boolean) || !foreignKeyChecks.every(Boolean)) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} detected CAS columns without the expected indexes or Version relations. Refusing to repair an ambiguous StagedChangeSet schema.`,
    );
  }

  if (
    !hasImmutableTrigger ||
    (await hasLegacyPendingDocumentProposals(inspector))
  ) {
    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: DOCUMENT_PROPOSAL_CAS_REPAIR_SQL,
    };
  }

  return { action: MIGRATION_ACTION_MARK };
}

async function inspectInterruptedTeamScopedConversationStage(inspector) {
  const [
    sessionHasCurrentScope,
    sessionHasCurrentIndex,
    assistantRunHasLegacyDocument,
    assistantRunHasScopeColumn,
    assistantRunHasScopeIndex,
    assistantRunIntegrityChecks,
  ] =
    await Promise.all([
      inspector.hasColumnDefinition("Session", TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN),
      inspector.hasNamedIndexOnColumns(
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.table,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.columns,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.unique,
      ),
      inspector.hasColumnDefinition(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN,
      ),
      inspector.hasColumn(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name,
      ),
      inspector.hasIndex("AssistantRun_organizationId_scopeKind_startedAt_idx"),
      Promise.all([
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map((foreignKey) =>
          inspector.hasForeignKey("AssistantRun", foreignKey),
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES
          .filter(
            (index) =>
              index.name !== "AssistantRun_organizationId_scopeKind_startedAt_idx",
          )
          .map((index) =>
            inspector.hasNamedIndexOnColumns(
              index.table,
              index.name,
              index.columns,
              index.unique,
            ),
          ),
      ]),
    ]);

  if (
    !sessionHasCurrentScope ||
    !sessionHasCurrentIndex ||
    !assistantRunHasLegacyDocument ||
    assistantRunHasScopeColumn ||
    assistantRunHasScopeIndex ||
    !assistantRunIntegrityChecks.every(Boolean)
  ) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but Session/AssistantRun are not in the exact interrupted team-scoped migration state.",
    };
  }

  if (
    !(await hasCompleteTableSchema(
      inspector,
      TEAM_SCOPED_CONVERSATION_STAGING_TABLE,
    ))
  ) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but its schema does not match the expected team-scoped AssistantRun staging table.",
    };
  }

  const [rowCountsMatch, hasMismatchedRows, hasLegacyExtraRows] = await Promise.all([
    inspector.scalarEquals(
      `
        SELECT COUNT(*) FROM "AssistantRun"
      `,
      `
        SELECT COUNT(*) FROM "new_AssistantRun"
      `,
    ),
    inspector.hasAnyRows(`
      SELECT 1
      FROM "AssistantRun" AS legacy
      LEFT JOIN "new_AssistantRun" AS staged
        ON staged."id" = legacy."id"
      WHERE staged."id" IS NULL
         OR staged."organizationId" <> legacy."organizationId"
         OR staged."sessionId" <> legacy."sessionId"
         OR NOT (
           (staged."documentId" IS NULL AND legacy."documentId" IS NULL)
           OR staged."documentId" = legacy."documentId"
         )
         OR staged."scopeKind" <> 'wiki'
         OR NOT (
           (staged."requestMessageId" IS NULL AND legacy."requestMessageId" IS NULL)
           OR staged."requestMessageId" = legacy."requestMessageId"
         )
         OR staged."mode" <> legacy."mode"
         OR staged."title" <> legacy."title"
         OR staged."status" <> legacy."status"
         OR NOT (
           (staged."summary" IS NULL AND legacy."summary" IS NULL)
           OR staged."summary" = legacy."summary"
         )
         OR NOT (
           (staged."payloadJson" IS NULL AND legacy."payloadJson" IS NULL)
           OR staged."payloadJson" = legacy."payloadJson"
         )
         OR NOT (
           (staged."createdByUserId" IS NULL AND legacy."createdByUserId" IS NULL)
           OR staged."createdByUserId" = legacy."createdByUserId"
         )
         OR NOT (
           (staged."originDeviceId" IS NULL AND legacy."originDeviceId" IS NULL)
           OR staged."originDeviceId" = legacy."originDeviceId"
         )
         OR staged."revision" <> legacy."revision"
         OR NOT (
           (staged."deletedAt" IS NULL AND legacy."deletedAt" IS NULL)
           OR staged."deletedAt" = legacy."deletedAt"
         )
         OR staged."startedAt" <> legacy."startedAt"
         OR NOT (
           (staged."finishedAt" IS NULL AND legacy."finishedAt" IS NULL)
           OR staged."finishedAt" = legacy."finishedAt"
         )
         OR staged."createdAt" <> legacy."createdAt"
         OR staged."updatedAt" <> legacy."updatedAt"
      LIMIT 1
    `),
    inspector.hasAnyRows(`
      SELECT 1
      FROM "new_AssistantRun" AS staged
      LEFT JOIN "AssistantRun" AS legacy
        ON legacy."id" = staged."id"
      WHERE legacy."id" IS NULL
      LIMIT 1
    `),
  ]);

  if (!rowCountsMatch || hasMismatchedRows || hasLegacyExtraRows) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but its rows do not exactly match legacy AssistantRun data for deterministic resume.",
    };
  }

  return { resumable: true };
}

async function resolveTeamScopedConversationsStrategy(inspector) {
  const [hasSessionTable, hasAssistantRunTable, hasTemporaryAssistantRunTable] =
    await Promise.all([
      inspector.hasTable("Session"),
      inspector.hasTable("AssistantRun"),
      inspector.hasTable("new_AssistantRun"),
    ]);

  if (!hasSessionTable || !hasAssistantRunTable) {
    throw new Error(
      `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} requires Session and AssistantRun tables before compatibility checks.`,
    );
  }

  if (hasTemporaryAssistantRunTable) {
    const interruptedStage = await inspectInterruptedTeamScopedConversationStage(
      inspector,
    );
    if (interruptedStage.resumable) {
      return {
        action: MIGRATION_ACTION_REPAIR,
        sql: TEAM_SCOPED_CONVERSATION_RESUME_SQL,
      };
    }
    throw new Error(
      `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} detected an ambiguous leftover new_AssistantRun table and will not guess how to recover it: ${interruptedStage.reason} Drop the stray staging table and restore a clean legacy or complete target schema before retrying bootstrap.`,
    );
  }

  if (await hasCompleteTeamScopedConversationSchema(inspector)) {
    return { action: MIGRATION_ACTION_MARK };
  }

  if (await hasUntouchedLegacyTeamScopedConversationSchema(inspector)) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  throw new Error(
    `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} detected a partial or mixed team-scoped conversation schema. Refusing to rebuild AssistantRun against a mixed state.`,
  );
}

function quoteSqliteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }

  return `"${value}"`;
}

function quoteSqliteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createSchemaInspector(client) {
  return {
    async hasTable(table) {
      const result = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["table", table],
      });
      return result.rows.length > 0;
    },
    async lacksTable(table) {
      return !(await this.hasTable(table));
    },
    async hasColumn(table, column) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      return result.rows.some((row) => {
        const name =
          typeof row.name === "string" ? row.name : String(row.name ?? "");
        return name === column;
      });
    },
    async hasColumnDefinition(table, expected) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      return result.rows.some((row) => {
        const column = {
          defaultValue:
            row.dflt_value === null || row.dflt_value === undefined
              ? null
              : String(row.dflt_value),
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          notNull: Boolean(Number(row.notnull)),
          primaryKeyPosition: Number(row.pk),
          type: String(row.type ?? "").trim().toUpperCase(),
        };
        return (
          column.name === expected.name &&
          column.type === expected.type.trim().toUpperCase() &&
          column.notNull === expected.notNull &&
          column.defaultValue === expected.defaultValue &&
          column.primaryKeyPosition === expected.primaryKeyPosition
        );
      });
    },
    async hasExactColumns(table, columns) {
      const result = await client.execute(
        `PRAGMA table_info(${quoteSqliteIdentifier(table)})`,
      );
      const actual = result.rows
        .map((row) => ({
          defaultValue:
            row.dflt_value === null || row.dflt_value === undefined
              ? null
              : String(row.dflt_value),
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          notNull: Boolean(Number(row.notnull)),
          position: Number(row.cid),
          primaryKeyPosition: Number(row.pk),
          type: String(row.type ?? "").trim().toUpperCase(),
        }))
        .sort((left, right) => left.position - right.position);
      return (
        actual.length === columns.length &&
        actual.every((column, position) => {
          const expected = columns[position];
          if (typeof expected === "string") {
            return column.name === expected;
          }
          return (
            column.name === expected.name &&
            column.type === expected.type.trim().toUpperCase() &&
            column.notNull === expected.notNull &&
            column.defaultValue === expected.defaultValue &&
            column.primaryKeyPosition === expected.primaryKeyPosition
          );
        })
      );
    },
    async hasIndex(index) {
      const result = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["index", index],
      });
      return result.rows.length > 0;
    },
    async hasUniqueIndex(table, columns) {
      return this.hasIndexOnColumns(table, columns, true);
    },
    async hasIndexOnColumns(table, columns, unique) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      for (const index of indexes.rows) {
        if (Boolean(Number(index.unique)) !== unique) continue;
        const name =
          typeof index.name === "string"
            ? index.name
            : String(index.name ?? "");
        if (!name) continue;
        const indexedColumns = await client.execute(
          `PRAGMA index_info(${quoteSqliteIdentifier(name)})`,
        );
        const actual = indexedColumns.rows
          .map((row) => ({
            name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
            sequence: Number(row.seqno),
          }))
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ name: column }) => column);
        if (
          actual.length === columns.length &&
          actual.every((column, index) => column === columns[index])
        ) {
          return true;
        }
      }
      return false;
    },
    async hasNamedIndexOnColumns(table, indexName, columns, unique) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      const index = indexes.rows.find(
        (candidate) => String(candidate.name ?? "") === indexName,
      );
      if (!index || Boolean(Number(index.unique)) !== unique) {
        return false;
      }

      const indexedColumns = await client.execute(
        `PRAGMA index_info(${quoteSqliteIdentifier(indexName)})`,
      );
      const actual = indexedColumns.rows
        .map((row) => ({
          name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
          sequence: Number(row.seqno),
        }))
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ name }) => name);
      return (
        actual.length === columns.length &&
        actual.every((column, position) => column === columns[position])
      );
    },
    async hasForeignKey(table, expected) {
      const foreignKeys = await client.execute(
        `PRAGMA foreign_key_list(${quoteSqliteIdentifier(table)})`,
      );
      return foreignKeys.rows.some((foreignKey) => {
        const column = String(foreignKey.from ?? "");
        const referencedTable = String(foreignKey.table ?? "");
        const referencedColumn = String(foreignKey.to ?? "");
        const onDelete = String(foreignKey.on_delete ?? "").toUpperCase();
        const onUpdate = String(foreignKey.on_update ?? "").toUpperCase();
        return (
          column === expected.column &&
          referencedTable === expected.referencedTable &&
          referencedColumn === expected.referencedColumn &&
          onDelete === expected.onDelete &&
          (expected.onUpdate === undefined || onUpdate === expected.onUpdate)
        );
      });
    },
    async hasTrigger(trigger, table) {
      const result = await client.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? AND tbl_name = ? LIMIT 1",
        args: ["trigger", trigger, table],
      });
      const sql = String(result.rows[0]?.sql ?? "");
      return (
        sql.includes("Version snapshot fields are immutable") &&
        sql.includes('NEW."content" IS NOT OLD."content"') &&
        sql.includes('NEW."versionType" IS NOT OLD."versionType"')
      );
    },
    async hasPartialUniqueIndex(table, columns, predicateSql) {
      const indexes = await client.execute(
        `PRAGMA index_list(${quoteSqliteIdentifier(table)})`,
      );
      const normalizedPredicate = predicateSql.replace(/\s+/g, " ").trim();
      for (const index of indexes.rows) {
        if (Number(index.unique) !== 1 || Number(index.partial) !== 1) continue;
        const name =
          typeof index.name === "string"
            ? index.name
            : String(index.name ?? "");
        if (!name) continue;
        const indexedColumns = await client.execute(
          `PRAGMA index_info(${quoteSqliteIdentifier(name)})`,
        );
        const actual = indexedColumns.rows
          .map((row) => ({
            name: typeof row.name === "string" ? row.name : String(row.name ?? ""),
            sequence: Number(row.seqno),
          }))
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ name: column }) => column);
        if (
          actual.length !== columns.length ||
          !actual.every((column, position) => column === columns[position])
        ) {
          continue;
        }

        const definition = await client.execute({
          sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
          args: ["index", name],
        });
        const sql =
          typeof definition.rows[0]?.sql === "string"
            ? definition.rows[0].sql
            : String(definition.rows[0]?.sql ?? "");
        if (!sql) continue;
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        if (normalizedSql.includes(normalizedPredicate)) {
          return true;
        }
      }
      return false;
    },
    async hasCheckConstraint(table, constraintName, expressionSql) {
      const definition = await client.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1",
        args: ["table", table],
      });
      const sql =
        typeof definition.rows[0]?.sql === "string"
          ? definition.rows[0].sql
          : String(definition.rows[0]?.sql ?? "");
      if (!sql) return false;

      const expected = `CONSTRAINT ${quoteSqliteIdentifier(constraintName)} CHECK (${expressionSql})`;
      return normalizeSqliteSchemaSql(sql).includes(
        normalizeSqliteSchemaSql(expected),
      );
    },
    async hasAnyRows(sql) {
      const result = await client.execute(sql);
      return result.rows.length > 0;
    },
    async hasNoRows(sql) {
      return !(await this.hasAnyRows(sql));
    },
    async scalarEquals(leftSql, rightSql) {
      const [left, right] = await Promise.all([
        client.execute(leftSql),
        client.execute(rightSql),
      ]);
      return (
        String(left.rows[0]?.[0] ?? left.rows[0]?.value ?? "") ===
        String(right.rows[0]?.[0] ?? right.rows[0]?.value ?? "")
      );
    },
  };
}

function normalizeSqliteSchemaSql(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

async function markMigrationApplied(client, migrationName) {
  const statements = [
    "BEGIN IMMEDIATE;",
    `INSERT INTO "_dao_local_migrations" ("name") VALUES (${quoteSqliteString(migrationName)});`,
    "COMMIT;",
  ].join("\n\n");
  await client.executeMultiple(statements);
}

async function executeMigrationStep(client, migrationName, sql) {
  const trimmedSql = sql?.trim();
  if (!trimmedSql) {
    return;
  }

  if (hasForeignKeyManagedMigration(trimmedSql)) {
    await executeForeignKeyManagedMigrationStep(
      client,
      migrationName,
      trimmedSql,
    );
    return;
  }

  const statements = [
    "BEGIN IMMEDIATE;",
    trimmedSql,
    `INSERT INTO "_dao_local_migrations" ("name") VALUES (${quoteSqliteString(migrationName)});`,
    "COMMIT;",
  ]
    .filter(Boolean)
    .join("\n\n");
  await client.executeMultiple(statements);
}

async function assertNoForeignKeyViolations(client, migrationName) {
  const result = await client.execute("PRAGMA foreign_key_check");
  if (result.rows.length === 0) {
    return;
  }

  const details = result.rows
    .slice(0, 5)
    .map((row) => {
      const table = String(row.table ?? "");
      const rowId = String(row.rowid ?? "");
      const parent = String(row.parent ?? "");
      const foreignKeyId = String(row.fkid ?? "");
      return `table=${table || "unknown"}, rowid=${rowId || "unknown"}, parent=${parent || "unknown"}, fkid=${foreignKeyId || "unknown"}`;
    })
    .join("; ");
  const remainder =
    result.rows.length > 5 ? ` (+${result.rows.length - 5} more)` : "";
  throw new Error(
    `${migrationName} failed foreign_key_check after schema changes: ${details}${remainder}`,
  );
}

function hasForeignKeyManagedMigration(sql) {
  return /PRAGMA\s+foreign_keys\s*=\s*OFF\b/i.test(sql);
}

function stripManagedForeignKeyPragmas(sql) {
  return sql
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*OFF\s*;\s*$/gim, "")
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, "")
    .replace(/^\s*PRAGMA\s+foreign_key_check\s*;\s*$/gim, "")
    .trim();
}

async function executeForeignKeyManagedMigrationStep(
  client,
  migrationName,
  sql,
) {
  const body = stripManagedForeignKeyPragmas(sql);
  if (!body) {
    throw new Error(
      `${migrationName} declared PRAGMA foreign_keys=OFF but has no executable migration body after stripping managed pragmas.`,
    );
  }

  await client.execute("PRAGMA foreign_keys = OFF");
  const transaction = await client.transaction("write");
  try {
    for (const statement of splitSqlStatements(body)) {
      await transaction.execute(statement);
    }
    await assertNoForeignKeyViolations(transaction, migrationName);
    await transaction.execute({
      sql: 'INSERT INTO "_dao_local_migrations" ("name") VALUES (?)',
      args: [migrationName],
    });
    await transaction.commit();
  } catch (error) {
    try {
      if (!transaction.closed) {
        await transaction.rollback();
      }
    } catch {
      // Best-effort rollback; preserve the original failure.
    }
    throw error;
  } finally {
    if (!transaction.closed) {
      transaction.close();
    }
    await client.execute("PRAGMA foreign_keys = ON");
  }
}

function splitSqlStatements(sql) {
  const statements = [];
  let buffer = "";
  let token = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let isTriggerStatement = false;
  let triggerBlockDepth = 0;

  const flushToken = () => {
    if (!token) return;
    const upper = token.toUpperCase();
    if (upper === "TRIGGER") {
      isTriggerStatement = true;
    } else if (isTriggerStatement && upper === "BEGIN") {
      triggerBlockDepth += 1;
    } else if (isTriggerStatement && upper === "END" && triggerBlockDepth > 0) {
      triggerBlockDepth -= 1;
    }
    token = "";
  };

  const flushStatement = () => {
    const statement = buffer.trim();
    if (statement) {
      statements.push(statement);
    }
    buffer = "";
    token = "";
    isTriggerStatement = false;
    triggerBlockDepth = 0;
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] ?? "";
    buffer += char;

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        buffer += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        buffer += next;
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      flushToken();
      buffer += next;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      flushToken();
      buffer += next;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      flushToken();
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      flushToken();
      inDoubleQuote = true;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      token += char;
      continue;
    }

    if (/[0-9]/.test(char) && token) {
      token += char;
      continue;
    }

    flushToken();

    if (char === ";") {
      if (!isTriggerStatement || triggerBlockDepth === 0) {
        flushStatement();
      }
    }
  }

  flushToken();
  flushStatement();
  return statements;
}

async function main() {
  const targetDbPath = path.join(resolveAppDataRoot(), "dev.db");
  const client = createClient({
    url: `file:${targetDbPath}`,
  });
  const inspector = createSchemaInspector(client);

  try {
    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    const journalMode = await client.execute('PRAGMA journal_mode = WAL');
    const effectiveJournalMode = String(
      journalMode.rows[0]?.journal_mode ?? journalMode.rows[0]?.[0] ?? '',
    ).toLowerCase();
    if (effectiveJournalMode !== 'wal') {
      throw new Error(
        `Could not enable SQLite WAL mode for ${targetDbPath}; got ${effectiveJournalMode || 'no result'}.`,
      );
    }
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA foreign_keys = ON');
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS "_dao_local_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = await client.execute(
      'SELECT "name" FROM "_dao_local_migrations" ORDER BY "name" ASC',
    );
    const appliedMigrations = new Set(
      appliedRows.rows
        .map((row) =>
          typeof row.name === "string" ? row.name : String(row.name ?? ""),
        )
        .filter(Boolean),
    );

    const migrationNames = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationNames) {
      if (appliedMigrations.has(migrationName)) {
        continue;
      }

      const strategy = await resolveMigrationStrategy(migrationName, inspector);
      if (strategy.action === MIGRATION_ACTION_MARK) {
        console.log(
          `Marking existing schema as already satisfying ${migrationName}`,
        );
        await assertNoForeignKeyViolations(client, migrationName);
        await markMigrationApplied(client, migrationName);
        continue;
      }

      if (strategy.action === MIGRATION_ACTION_REPAIR) {
        console.log(`Repairing existing schema for ${migrationName}`);
        await executeMigrationStep(client, migrationName, strategy.sql);
        if (!strategy.sql?.trim()) {
          await assertNoForeignKeyViolations(client, migrationName);
          await markMigrationApplied(client, migrationName);
        }
        continue;
      }

      const migrationPath = path.join(
        migrationsRoot,
        migrationName,
        "migration.sql",
      );
      const migrationSql = fs.readFileSync(migrationPath, "utf8");
      if (migrationSql.trim()) {
        console.log(`Applying ${migrationName}`);
      }
      await executeMigrationStep(client, migrationName, migrationSql);
      if (!migrationSql.trim()) {
        await assertNoForeignKeyViolations(client, migrationName);
        await markMigrationApplied(client, migrationName);
      }
    }
  } finally {
    await client.close();
  }
}

function resolveAppDataRoot() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--app-data-root");
  if (flagIndex !== -1) {
    const nextValue = args[flagIndex + 1];
    if (!nextValue) {
      throw new Error("Missing value for --app-data-root");
    }

    return path.resolve(nextValue);
  }

  const envAppDataRoot = process.env.DAO_APP_DATA_ROOT?.trim();
  if (envAppDataRoot) {
    return path.resolve(envAppDataRoot);
  }

  return repoRoot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
