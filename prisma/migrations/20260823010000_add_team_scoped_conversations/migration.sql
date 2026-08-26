PRAGMA foreign_keys=OFF;

ALTER TABLE "Session"
ADD COLUMN "scopeKind" TEXT NOT NULL DEFAULT 'wiki';

CREATE INDEX "Session_organizationId_scopeKind_updatedAt_idx" ON "Session"("organizationId", "scopeKind", "updatedAt");

CREATE TABLE "new_AssistantRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT NOT NULL,
    "documentId" TEXT,
    "scopeKind" TEXT NOT NULL DEFAULT 'wiki',
    "requestMessageId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'revision',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "summary" TEXT,
    "payloadJson" TEXT,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssistantRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantRun_requestMessageId_fkey" FOREIGN KEY ("requestMessageId") REFERENCES "ChatMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_AssistantRun" (
    "id",
    "organizationId",
    "sessionId",
    "documentId",
    "scopeKind",
    "requestMessageId",
    "mode",
    "title",
    "status",
    "summary",
    "payloadJson",
    "createdByUserId",
    "originDeviceId",
    "revision",
    "deletedAt",
    "startedAt",
    "finishedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "organizationId",
    "sessionId",
    "documentId",
    'wiki',
    "requestMessageId",
    "mode",
    "title",
    "status",
    "summary",
    "payloadJson",
    "createdByUserId",
    "originDeviceId",
    "revision",
    "deletedAt",
    "startedAt",
    "finishedAt",
    "createdAt",
    "updatedAt"
FROM "AssistantRun";

DROP TABLE "AssistantRun";
ALTER TABLE "new_AssistantRun" RENAME TO "AssistantRun";

CREATE INDEX "AssistantRun_organizationId_startedAt_idx" ON "AssistantRun"("organizationId", "startedAt");
CREATE INDEX "AssistantRun_organizationId_scopeKind_startedAt_idx" ON "AssistantRun"("organizationId", "scopeKind", "startedAt");
CREATE INDEX "AssistantRun_sessionId_startedAt_idx" ON "AssistantRun"("sessionId", "startedAt");
CREATE INDEX "AssistantRun_documentId_startedAt_idx" ON "AssistantRun"("documentId", "startedAt");
CREATE INDEX "AssistantRun_status_startedAt_idx" ON "AssistantRun"("status", "startedAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
