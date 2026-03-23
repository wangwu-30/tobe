CREATE TABLE "ProjectMount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sourceProjectId" TEXT NOT NULL,
    "targetProjectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMount_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMount_targetProjectId_fkey" FOREIGN KEY ("targetProjectId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectMount_sourceProjectId_targetProjectId_key"
ON "ProjectMount"("sourceProjectId", "targetProjectId");

CREATE INDEX "ProjectMount_organizationId_sourceProjectId_idx"
ON "ProjectMount"("organizationId", "sourceProjectId");

CREATE INDEX "ProjectMount_organizationId_targetProjectId_idx"
ON "ProjectMount"("organizationId", "targetProjectId");
