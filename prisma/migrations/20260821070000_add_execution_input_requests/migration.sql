CREATE TABLE "ExecutionInputRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "schemaJson" TEXT NOT NULL DEFAULT '{}',
  "responseJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" DATETIME,
  "respondedById" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExecutionInputRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionInputRequest_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionInputRequest_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionInputRequest_status_check"
    CHECK ("status" IN ('pending', 'answered', 'cancelled')),
  CONSTRAINT "ExecutionInputRequest_revision_check"
    CHECK ("revision" >= 1)
);

CREATE UNIQUE INDEX "ExecutionInputRequest_attemptId_requestKey_key"
  ON "ExecutionInputRequest"("attemptId", "requestKey");
CREATE INDEX "ExecutionInputRequest_organizationId_status_requestedAt_idx"
  ON "ExecutionInputRequest"("organizationId", "status", "requestedAt");
CREATE INDEX "ExecutionInputRequest_jobId_status_requestedAt_idx"
  ON "ExecutionInputRequest"("jobId", "status", "requestedAt");
CREATE INDEX "ExecutionInputRequest_attemptId_status_requestedAt_idx"
  ON "ExecutionInputRequest"("attemptId", "status", "requestedAt");
