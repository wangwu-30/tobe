ALTER TABLE "KnowledgeSpace" ADD COLUMN "activeSnapshotId" TEXT;

ALTER TABLE "KnowledgeSnapshot" ADD COLUMN "artifactPath" TEXT NOT NULL DEFAULT '';
ALTER TABLE "KnowledgeSnapshot" ADD COLUMN "artifactSha256" TEXT NOT NULL DEFAULT '';
ALTER TABLE "KnowledgeSnapshot" ADD COLUMN "readyAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "KnowledgeSnapshot_id_organizationId_key"
  ON "KnowledgeSnapshot"("id", "organizationId");

CREATE TABLE "KnowledgeMergeOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "changeRequestId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "expectedBaseCommit" TEXT NOT NULL,
  "expectedHeadCommit" TEXT NOT NULL,
  "indexVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseOwnerId" TEXT,
  "leaseExpiresAt" DATETIME,
  "mergedCommit" TEXT,
  "snapshotId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeMergeOperation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeMergeOperation_changeRequestId_organizationId_fkey"
    FOREIGN KEY ("changeRequestId", "organizationId")
    REFERENCES "KnowledgeChangeRequest" ("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeMergeOperation_status_check"
    CHECK ("status" IN ('queued', 'running', 'conflicted', 'failed', 'succeeded')),
  CONSTRAINT "KnowledgeMergeOperation_expectedRevision_check"
    CHECK ("expectedRevision" >= 1),
  CONSTRAINT "KnowledgeMergeOperation_attemptCount_check"
    CHECK ("attemptCount" >= 0),
  CONSTRAINT "KnowledgeMergeOperation_terminal_metadata_check"
    CHECK (
      ("status" = 'succeeded' AND "mergedCommit" IS NOT NULL AND "snapshotId" IS NOT NULL AND "completedAt" IS NOT NULL) OR
      ("status" IN ('conflicted', 'failed') AND "completedAt" IS NOT NULL) OR
      ("status" IN ('queued', 'running') AND "completedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "KnowledgeMergeOperation_changeRequestId_expectedRevision_key"
  ON "KnowledgeMergeOperation"("changeRequestId", "expectedRevision");
CREATE INDEX "KnowledgeMergeOperation_organizationId_status_updatedAt_idx"
  ON "KnowledgeMergeOperation"("organizationId", "status", "updatedAt");
CREATE INDEX "KnowledgeMergeOperation_changeRequestId_createdAt_idx"
  ON "KnowledgeMergeOperation"("changeRequestId", "createdAt");
