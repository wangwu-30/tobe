CREATE TABLE "WorkflowPlaybook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "documentId" TEXT,
    "sourceVersionId" TEXT,
    "sourceThreadId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowPlaybook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowPlaybook_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowPlaybook_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowPlaybook_sourceThreadId_fkey" FOREIGN KEY ("sourceThreadId") REFERENCES "CommentThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "WorkflowPlaybook_organizationId_createdAt_idx" ON "WorkflowPlaybook"("organizationId", "createdAt");
CREATE INDEX "WorkflowPlaybook_documentId_createdAt_idx" ON "WorkflowPlaybook"("documentId", "createdAt");
CREATE INDEX "WorkflowPlaybook_sourceVersionId_createdAt_idx" ON "WorkflowPlaybook"("sourceVersionId", "createdAt");
