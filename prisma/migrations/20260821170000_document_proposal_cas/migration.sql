PRAGMA foreign_keys=OFF;

CREATE TABLE "new_StagedChangeSet" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "sessionId" TEXT,
  "baseVersionId" TEXT,
  "baseVersionSha256" TEXT,
  "baseDraftRevision" INTEGER,
  "patchSchemaVersion" INTEGER,
  "patchSha256" TEXT,
  "appliedCheckpointVersionId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "sourceType" TEXT NOT NULL DEFAULT 'ai',
  "changesJson" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "originDeviceId" TEXT,
  "appliedAt" DATETIME,
  "discardedAt" DATETIME,
  "reviewedByUserId" TEXT,
  "reviewedAt" DATETIME,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StagedChangeSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StagedChangeSet_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StagedChangeSet_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StagedChangeSet_appliedCheckpointVersionId_fkey" FOREIGN KEY ("appliedCheckpointVersionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StagedChangeSet_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Proposals created before CAS metadata existed have no trustworthy draft/file
-- preimage. Preserve them for audit, but make pending rows non-actionable.
INSERT INTO "new_StagedChangeSet" (
  "id", "organizationId", "documentId", "sessionId",
  "baseVersionId", "baseVersionSha256", "baseDraftRevision",
  "patchSchemaVersion", "patchSha256", "appliedCheckpointVersionId",
  "title", "summary", "status", "sourceType", "changesJson",
  "createdByUserId", "originDeviceId", "appliedAt", "discardedAt",
  "reviewedByUserId", "reviewedAt", "revision", "deletedAt",
  "createdAt", "updatedAt"
)
SELECT
  "id", "organizationId", "documentId", "sessionId",
  CASE
    WHEN "baseVersionId" IS NULL OR EXISTS (
      SELECT 1 FROM "Version" WHERE "Version"."id" = "StagedChangeSet"."baseVersionId"
    ) THEN "baseVersionId"
    ELSE NULL
  END,
  NULL, NULL, NULL, NULL,
  CASE
    WHEN "appliedCheckpointVersionId" IS NULL OR EXISTS (
      SELECT 1 FROM "Version" WHERE "Version"."id" = "StagedChangeSet"."appliedCheckpointVersionId"
    ) THEN "appliedCheckpointVersionId"
    ELSE NULL
  END,
  "title", "summary",
  CASE WHEN "status" = 'pending' THEN 'discarded' ELSE "status" END,
  "sourceType", "changesJson", "createdByUserId", "originDeviceId",
  "appliedAt",
  CASE
    WHEN "status" = 'pending' THEN COALESCE("discardedAt", CURRENT_TIMESTAMP)
    ELSE "discardedAt"
  END,
  NULL,
  CASE WHEN "status" = 'pending' THEN CURRENT_TIMESTAMP ELSE NULL END,
  CASE WHEN "status" = 'pending' THEN "revision" + 1 ELSE "revision" END,
  "deletedAt", "createdAt",
  CASE WHEN "status" = 'pending' THEN CURRENT_TIMESTAMP ELSE "updatedAt" END
FROM "StagedChangeSet";

DROP TABLE "StagedChangeSet";
ALTER TABLE "new_StagedChangeSet" RENAME TO "StagedChangeSet";

CREATE INDEX "StagedChangeSet_organizationId_updatedAt_idx" ON "StagedChangeSet"("organizationId", "updatedAt");
CREATE INDEX "StagedChangeSet_documentId_updatedAt_idx" ON "StagedChangeSet"("documentId", "updatedAt");
CREATE INDEX "StagedChangeSet_sessionId_updatedAt_idx" ON "StagedChangeSet"("sessionId", "updatedAt");
CREATE INDEX "StagedChangeSet_status_updatedAt_idx" ON "StagedChangeSet"("status", "updatedAt");
CREATE INDEX "StagedChangeSet_baseVersionId_idx" ON "StagedChangeSet"("baseVersionId");
CREATE INDEX "StagedChangeSet_appliedCheckpointVersionId_idx" ON "StagedChangeSet"("appliedCheckpointVersionId");
CREATE INDEX "StagedChangeSet_reviewedByUserId_idx" ON "StagedChangeSet"("reviewedByUserId");

-- Version snapshot payload and provenance are immutable. Soft-deletion and the
-- revision counter remain writable lifecycle metadata; classification is in Label.
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

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
