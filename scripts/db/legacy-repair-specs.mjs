/**
 * Frozen historical schema expectations and drift-repair SQL definitions for
 * pre-v1 local SQLite databases (202603*–202608* transition era).
 *
 * Policy (docs/rfcs/m4-runtime-package-and-migration-baseline.md §4.2):
 * Do NOT add new hand-written DDL repair branches here; all new schema changes
 * must move strictly forward via prisma/migrations/.
 */

export const AGENT_PROFILE_MANAGEMENT_MIGRATION =
  "20260821130000_add_agent_profile_management";
export const ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION =
  "20260821140000_add_room_tool_confirmation_requests";
export const DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION =
  "20260821160000_add_durable_room_delegation_ledger";
export const DOCUMENT_PROPOSAL_CAS_MIGRATION =
  "20260821170000_document_proposal_cas";
export const CANVAS_TABLES_MIGRATION = "20260822010000_add_canvas_tables";
export const TEAM_SCOPED_CONVERSATIONS_MIGRATION =
  "20260823010000_add_team_scoped_conversations";
export const TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN = {
  name: "scopeKind",
  type: "TEXT",
  notNull: true,
  defaultValue: "'wiki'",
  primaryKeyPosition: 0,
};
export const TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN = {
  name: "documentId",
  type: "TEXT",
  notNull: true,
  defaultValue: null,
  primaryKeyPosition: 0,
};
export const TEAM_SCOPED_CONVERSATION_CURRENT_DOCUMENT_COLUMN = {
  name: "documentId",
  type: "TEXT",
  notNull: false,
  defaultValue: null,
  primaryKeyPosition: 0,
};
export const TEAM_SCOPED_CONVERSATION_SESSION_INDEX = {
  table: "Session",
  name: "Session_organizationId_scopeKind_updatedAt_idx",
  columns: ["organizationId", "scopeKind", "updatedAt"],
  unique: false,
};
export const TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES = [
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
export const TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS = [
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
export const TEAM_SCOPED_CONVERSATION_STAGING_TABLE = {
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
export const TEAM_SCOPED_CONVERSATION_RESUME_SQL = `
  DROP TABLE "AssistantRun";
  ALTER TABLE "new_AssistantRun" RENAME TO "AssistantRun";
  CREATE INDEX "AssistantRun_organizationId_startedAt_idx" ON "AssistantRun"("organizationId", "startedAt");
  CREATE INDEX "AssistantRun_organizationId_scopeKind_startedAt_idx" ON "AssistantRun"("organizationId", "scopeKind", "startedAt");
  CREATE INDEX "AssistantRun_sessionId_startedAt_idx" ON "AssistantRun"("sessionId", "startedAt");
  CREATE INDEX "AssistantRun_documentId_startedAt_idx" ON "AssistantRun"("documentId", "startedAt");
  CREATE INDEX "AssistantRun_status_startedAt_idx" ON "AssistantRun"("status", "startedAt");
`;
export const CANVAS_TABLES = [
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
export const DOCUMENT_PROPOSAL_CAS_COLUMNS = [
  "baseVersionSha256",
  "baseDraftRevision",
  "patchSchemaVersion",
  "patchSha256",
  "reviewedByUserId",
  "reviewedAt",
];
export const DOCUMENT_PROPOSAL_CAS_INDEXES = [
  { columns: ["baseVersionId"], unique: false },
  { columns: ["appliedCheckpointVersionId"], unique: false },
  { columns: ["reviewedByUserId"], unique: false },
];
export const DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS = [
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
export const VERSION_IMMUTABLE_TRIGGER = "Version_immutable_snapshot_update";
export const AGENT_PROFILE_MANAGEMENT_COLUMNS = [
  "capabilitiesJson",
  "configJson",
  "revision",
];
export const ROOM_TOOL_CONFIRMATION_REQUEST_COLUMNS = [
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
export const ROOM_TOOL_CONFIRMATION_REQUEST_INDEXES = [
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
export const LEGACY_ROOM_DELEGATION_GRANT_COLUMNS = [
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
export const DURABLE_ROOM_DELEGATION_GRANT_ADDED_COLUMNS = [
  "expiresAt",
  "hopLimit",
  "invocationLimit",
  "invocationCount",
];
export const ROOM_DELEGATION_GRANT_INDEXES = [
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
export const LEGACY_ROOM_DELEGATION_GRANT_CHECKS = [
  {
    name: "RoomDelegationGrant_scope_check",
    expression: `"scope" IN ('once', 'room')`,
  },
  {
    name: "RoomDelegationGrant_status_check",
    expression: `"status" IN ('active', 'consumed', 'revoked')`,
  },
];
export const DURABLE_ROOM_DELEGATION_TABLES = [
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
export const DURABLE_ROOM_DELEGATION_DATA_VALIDATION_QUERIES = [
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
export const DURABLE_ROOM_DELEGATION_REPAIR_SQL = `
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
export const EMPTY_AGENT_CAPABILITIES = '{"schemaVersion":1,"skills":[]}';
export const AGENT_PROFILE_MANAGEMENT_REPAIR_SQL = `
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
export const DOCUMENT_PROPOSAL_CAS_REPAIR_SQL = `
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
export const MIGRATION_ACTION_MARK = "mark";
export const MIGRATION_ACTION_APPLY = "apply";
export const MIGRATION_ACTION_REPAIR = "repair";
