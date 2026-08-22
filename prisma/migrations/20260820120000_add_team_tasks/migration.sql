CREATE TABLE "AgentProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "handle" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "skillsJson" TEXT NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "builtin" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentProfile_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentProfile_organizationId_handle_key"
  ON "AgentProfile"("organizationId", "handle");
CREATE INDEX "AgentProfile_organizationId_enabled_name_idx"
  ON "AgentProfile"("organizationId", "enabled", "name");

CREATE TABLE "TeamTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'execution',
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "projectId" TEXT,
  "workspaceId" TEXT,
  "threadId" TEXT,
  "createdByType" TEXT NOT NULL DEFAULT 'user',
  "createdById" TEXT NOT NULL,
  "assigneeType" TEXT,
  "assigneeId" TEXT,
  "blockedReason" TEXT,
  "dueAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamTask_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TeamTask_organizationId_updatedAt_idx"
  ON "TeamTask"("organizationId", "updatedAt");
CREATE INDEX "TeamTask_organizationId_status_updatedAt_idx"
  ON "TeamTask"("organizationId", "status", "updatedAt");
CREATE INDEX "TeamTask_organizationId_kind_updatedAt_idx"
  ON "TeamTask"("organizationId", "kind", "updatedAt");
CREATE INDEX "TeamTask_organizationId_projectId_updatedAt_idx"
  ON "TeamTask"("organizationId", "projectId", "updatedAt");
CREATE INDEX "TeamTask_organizationId_workspaceId_updatedAt_idx"
  ON "TeamTask"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "TeamTask_organizationId_threadId_updatedAt_idx"
  ON "TeamTask"("organizationId", "threadId", "updatedAt");
CREATE INDEX "TeamTask_organizationId_assigneeType_assigneeId_updatedAt_idx"
  ON "TeamTask"("organizationId", "assigneeType", "assigneeId", "updatedAt");

CREATE TABLE "TaskActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "taskId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL DEFAULT '',
  "actorType" TEXT NOT NULL DEFAULT 'user',
  "actorId" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskActivity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskActivity_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "TeamTask" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TaskActivity_organizationId_createdAt_idx"
  ON "TaskActivity"("organizationId", "createdAt");
CREATE INDEX "TaskActivity_taskId_createdAt_idx"
  ON "TaskActivity"("taskId", "createdAt");

INSERT INTO "AgentProfile" (
  "id",
  "organizationId",
  "handle",
  "name",
  "description",
  "skillsJson",
  "enabled",
  "builtin"
)
SELECT
  'builtin-assistant:' || "id",
  "id",
  '@assistant',
  'AI Assistant',
  'Built-in document and team task assistant.',
  '["document_editing","research","team_tasks"]',
  true,
  true
FROM "Organization";
