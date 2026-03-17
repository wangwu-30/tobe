ALTER TABLE "Document" ADD COLUMN "projectFolderId" TEXT;

CREATE TABLE "ProjectFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Document_organizationId_projectId_projectFolderId_updatedAt_idx"
ON "Document"("organizationId", "projectId", "projectFolderId", "updatedAt");

CREATE INDEX "ProjectFolder_organizationId_projectId_updatedAt_idx"
ON "ProjectFolder"("organizationId", "projectId", "updatedAt");
