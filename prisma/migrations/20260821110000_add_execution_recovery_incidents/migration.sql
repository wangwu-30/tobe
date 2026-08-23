CREATE TABLE "ExecutionRecoveryIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'unknown',
    "discardable" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requestedAction" TEXT,
    "resolution" TEXT,
    "actionRequestedAt" DATETIME,
    "actionRequestedById" TEXT,
    "resolvedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionRecoveryIncident_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionRecoveryIncident_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionRecoveryIncident_attemptId_fkey"
      FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExecutionRecoveryIncident_attemptId_generation_key"
  ON "ExecutionRecoveryIncident" ("attemptId", "generation");

CREATE INDEX "ExecutionRecoveryIncident_organizationId_status_updatedAt_idx"
  ON "ExecutionRecoveryIncident" ("organizationId", "status", "updatedAt");

CREATE INDEX "ExecutionRecoveryIncident_jobId_createdAt_idx"
  ON "ExecutionRecoveryIncident" ("jobId", "createdAt");

CREATE INDEX "ExecutionRecoveryIncident_attemptId_createdAt_idx"
  ON "ExecutionRecoveryIncident" ("attemptId", "createdAt");
