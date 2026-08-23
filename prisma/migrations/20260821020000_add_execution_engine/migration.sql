CREATE TABLE "ExecutionRuntime" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "driver" TEXT NOT NULL,
  "version" TEXT,
  "endpoint" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "registrationJson" TEXT NOT NULL DEFAULT '{}',
  "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
  "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  "healthJson" TEXT NOT NULL DEFAULT '{}',
  "lastHeartbeatAt" DATETIME,
  "capacityTotal" INTEGER NOT NULL DEFAULT 1,
  "capacityUsed" INTEGER NOT NULL DEFAULT 0,
  "capacityJson" TEXT NOT NULL DEFAULT '{}',
  "capacityUpdatedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExecutionRuntime_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExecutionRuntime_organizationId_key_key"
  ON "ExecutionRuntime"("organizationId", "key");
CREATE INDEX "ExecutionRuntime_organizationId_enabled_healthStatus_updatedAt_idx"
  ON "ExecutionRuntime"("organizationId", "enabled", "healthStatus", "updatedAt");
CREATE INDEX "ExecutionRuntime_organizationId_driver_enabled_idx"
  ON "ExecutionRuntime"("organizationId", "driver", "enabled");
CREATE INDEX "ExecutionRuntime_organizationId_lastHeartbeatAt_idx"
  ON "ExecutionRuntime"("organizationId", "lastHeartbeatAt");

CREATE TABLE "ExecutionJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "teamTaskId" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "specJson" TEXT NOT NULL,
  "requirementsJson" TEXT NOT NULL DEFAULT '{}',
  "contextManifestJson" TEXT NOT NULL DEFAULT '{}',
  "selectionJson" TEXT NOT NULL DEFAULT '{}',
  "requestedRuntimeId" TEXT,
  "selectedRuntimeId" TEXT,
  "selectionReason" TEXT,
  "selectedAt" DATETIME,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "deadlineAt" DATETIME,
  "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "cancelRequestedAt" DATETIME,
  "resultJson" TEXT,
  "errorJson" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExecutionJob_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionJob_teamTaskId_fkey"
    FOREIGN KEY ("teamTaskId") REFERENCES "TeamTask" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExecutionJob_requestedRuntimeId_fkey"
    FOREIGN KEY ("requestedRuntimeId") REFERENCES "ExecutionRuntime" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExecutionJob_selectedRuntimeId_fkey"
    FOREIGN KEY ("selectedRuntimeId") REFERENCES "ExecutionRuntime" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ExecutionJob_organizationId_status_priority_queuedAt_idx"
  ON "ExecutionJob"("organizationId", "status", "priority", "queuedAt");
CREATE INDEX "ExecutionJob_organizationId_kind_status_updatedAt_idx"
  ON "ExecutionJob"("organizationId", "kind", "status", "updatedAt");
CREATE INDEX "ExecutionJob_teamTaskId_createdAt_idx"
  ON "ExecutionJob"("teamTaskId", "createdAt");
CREATE INDEX "ExecutionJob_requestedRuntimeId_status_queuedAt_idx"
  ON "ExecutionJob"("requestedRuntimeId", "status", "queuedAt");
CREATE INDEX "ExecutionJob_selectedRuntimeId_status_updatedAt_idx"
  ON "ExecutionJob"("selectedRuntimeId", "status", "updatedAt");
CREATE INDEX "ExecutionJob_status_deadlineAt_idx"
  ON "ExecutionJob"("status", "deadlineAt");

CREATE TABLE "ExecutionAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "runtimeId" TEXT,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "leaseOwnerId" TEXT,
  "leaseExpiresAt" DATETIME,
  "lastHeartbeatAt" DATETIME,
  "runtimeRunId" TEXT,
  "checkpointJson" TEXT,
  "resultJson" TEXT,
  "errorJson" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExecutionAttempt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionAttempt_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionAttempt_runtimeId_fkey"
    FOREIGN KEY ("runtimeId") REFERENCES "ExecutionRuntime" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExecutionAttempt_jobId_number_key"
  ON "ExecutionAttempt"("jobId", "number");
CREATE UNIQUE INDEX "ExecutionAttempt_runtimeId_runtimeRunId_key"
  ON "ExecutionAttempt"("runtimeId", "runtimeRunId");
CREATE INDEX "ExecutionAttempt_organizationId_status_updatedAt_idx"
  ON "ExecutionAttempt"("organizationId", "status", "updatedAt");
CREATE INDEX "ExecutionAttempt_jobId_status_updatedAt_idx"
  ON "ExecutionAttempt"("jobId", "status", "updatedAt");
CREATE INDEX "ExecutionAttempt_runtimeId_status_leaseExpiresAt_idx"
  ON "ExecutionAttempt"("runtimeId", "status", "leaseExpiresAt");
CREATE INDEX "ExecutionAttempt_leaseOwnerId_leaseExpiresAt_idx"
  ON "ExecutionAttempt"("leaseOwnerId", "leaseExpiresAt");
CREATE INDEX "ExecutionAttempt_status_leaseExpiresAt_idx"
  ON "ExecutionAttempt"("status", "leaseExpiresAt");

CREATE TABLE "ExecutionEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "attemptId" TEXT,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'runtime',
  "runtimeEventId" TEXT,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionEvent_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionEvent_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExecutionEvent_jobId_sequence_key"
  ON "ExecutionEvent"("jobId", "sequence");
CREATE UNIQUE INDEX "ExecutionEvent_attemptId_runtimeEventId_key"
  ON "ExecutionEvent"("attemptId", "runtimeEventId");
CREATE INDEX "ExecutionEvent_organizationId_createdAt_idx"
  ON "ExecutionEvent"("organizationId", "createdAt");
CREATE INDEX "ExecutionEvent_jobId_occurredAt_idx"
  ON "ExecutionEvent"("jobId", "occurredAt");
CREATE INDEX "ExecutionEvent_attemptId_occurredAt_idx"
  ON "ExecutionEvent"("attemptId", "occurredAt");

CREATE TABLE "ExecutionArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "attemptId" TEXT,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storageUri" TEXT,
  "payloadJson" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "sha256" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionArtifact_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionArtifact_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionArtifact_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ExecutionArtifact_organizationId_createdAt_idx"
  ON "ExecutionArtifact"("organizationId", "createdAt");
CREATE INDEX "ExecutionArtifact_jobId_kind_createdAt_idx"
  ON "ExecutionArtifact"("jobId", "kind", "createdAt");
CREATE INDEX "ExecutionArtifact_attemptId_createdAt_idx"
  ON "ExecutionArtifact"("attemptId", "createdAt");
