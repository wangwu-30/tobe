CREATE TABLE "Note" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'knowledge',
  "title" TEXT,
  "content" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "sourceRef" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "originDeviceId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Note_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Note_organizationId_createdAt_idx" ON "Note"("organizationId", "createdAt");
CREATE INDEX "Note_organizationId_scope_scopeId_createdAt_idx"
  ON "Note"("organizationId", "scope", "scopeId", "createdAt");

INSERT INTO "Note" (
  "id",
  "organizationId",
  "scope",
  "scopeId",
  "kind",
  "title",
  "content",
  "source",
  "sourceRef",
  "active",
  "createdByUserId",
  "originDeviceId",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "organizationId",
  CASE WHEN "documentId" IS NULL THEN 'user' ELSE 'deliverable' END,
  COALESCE("documentId", "createdByUserId", "organizationId"),
  'knowledge',
  "title",
  "content",
  COALESCE("sourceType", 'manual'),
  NULL,
  true,
  "createdByUserId",
  "originDeviceId",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
FROM "KnowledgeItem";

INSERT INTO "Note" (
  "id",
  "organizationId",
  "scope",
  "scopeId",
  "kind",
  "title",
  "content",
  "source",
  "sourceRef",
  "active",
  "createdByUserId",
  "originDeviceId",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "organizationId",
  CASE WHEN "documentId" IS NULL THEN 'user' ELSE 'deliverable' END,
  COALESCE("documentId", "createdByUserId", "organizationId"),
  "category",
  NULL,
  "content",
  CASE WHEN "sourceThreadId" IS NULL THEN 'memory' ELSE 'thread' END,
  "sourceThreadId",
  "active",
  "createdByUserId",
  "originDeviceId",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
FROM "Memory";

DROP TABLE "KnowledgeItem";
DROP TABLE "Memory";
