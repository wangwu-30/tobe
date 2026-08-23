-- CreateTable
CREATE TABLE "NodeRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'dependency',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NodeRelation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NodeRelation_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NodeRelation_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectCanvasLayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "projectId" TEXT NOT NULL,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectCanvasLayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectCanvasLayout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NodeRelation_organizationId_sourceNodeId_idx" ON "NodeRelation"("organizationId", "sourceNodeId");

-- CreateIndex
CREATE INDEX "NodeRelation_organizationId_targetNodeId_idx" ON "NodeRelation"("organizationId", "targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeRelation_sourceNodeId_targetNodeId_kind_key" ON "NodeRelation"("sourceNodeId", "targetNodeId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCanvasLayout_organizationId_projectId_key" ON "ProjectCanvasLayout"("organizationId", "projectId");
