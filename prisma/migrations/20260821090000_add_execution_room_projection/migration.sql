ALTER TABLE "ExecutionJob" ADD COLUMN "originRoomId" TEXT;
ALTER TABLE "ExecutionJob" ADD COLUMN "originRoomMessageId" TEXT;

CREATE INDEX "ExecutionJob_organizationId_originRoomId_createdAt_idx"
  ON "ExecutionJob"("organizationId", "originRoomId", "createdAt");
CREATE INDEX "ExecutionJob_originRoomMessageId_idx"
  ON "ExecutionJob"("originRoomMessageId");

CREATE TABLE "ExecutionOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "roomId" TEXT,
  "topic" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" DATETIME,
  "roomEventId" TEXT,
  "ignoredReason" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExecutionOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionOutbox_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExecutionOutbox_status_check" CHECK ("status" IN ('pending', 'delivering', 'delivered', 'ignored')),
  CONSTRAINT "ExecutionOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "ExecutionOutbox_organizationId_topic_dedupeKey_key"
  ON "ExecutionOutbox"("organizationId", "topic", "dedupeKey");
CREATE INDEX "ExecutionOutbox_organizationId_status_availableAt_idx"
  ON "ExecutionOutbox"("organizationId", "status", "availableAt");
CREATE INDEX "ExecutionOutbox_jobId_createdAt_idx"
  ON "ExecutionOutbox"("jobId", "createdAt");
CREATE INDEX "ExecutionOutbox_roomId_status_availableAt_idx"
  ON "ExecutionOutbox"("roomId", "status", "availableAt");
