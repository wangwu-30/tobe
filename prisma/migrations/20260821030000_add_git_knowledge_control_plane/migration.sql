CREATE TABLE "KnowledgeSpace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "scope" TEXT NOT NULL,
  "ownerAgentId" TEXT,
  "repoPath" TEXT,
  "repoUrl" TEXT,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "credentialRef" TEXT,
  "readPolicy" TEXT NOT NULL,
  "writePolicy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeSpace_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSpace_scope_check"
    CHECK ("scope" IN ('team', 'agent')),
  CONSTRAINT "KnowledgeSpace_owner_scope_check"
    CHECK (
      ("scope" = 'team' AND "ownerAgentId" IS NULL) OR
      ("scope" = 'agent' AND "ownerAgentId" IS NOT NULL)
    ),
  CONSTRAINT "KnowledgeSpace_repository_check"
    CHECK ("repoPath" IS NOT NULL OR "repoUrl" IS NOT NULL)
);

CREATE UNIQUE INDEX "KnowledgeSpace_id_organizationId_key"
  ON "KnowledgeSpace"("id", "organizationId");
CREATE INDEX "KnowledgeSpace_organizationId_scope_updatedAt_idx"
  ON "KnowledgeSpace"("organizationId", "scope", "updatedAt");
CREATE INDEX "KnowledgeSpace_organizationId_ownerAgentId_updatedAt_idx"
  ON "KnowledgeSpace"("organizationId", "ownerAgentId", "updatedAt");

CREATE TABLE "KnowledgeBinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT,
  "spaceId" TEXT NOT NULL,
  "mountPath" TEXT NOT NULL,
  "access" TEXT NOT NULL DEFAULT 'read',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeBinding_spaceId_organizationId_fkey"
    FOREIGN KEY ("spaceId", "organizationId")
    REFERENCES "KnowledgeSpace" ("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeBinding_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeBinding_access_check"
    CHECK ("access" IN ('read', 'propose'))
);

CREATE UNIQUE INDEX "KnowledgeBinding_organizationId_workspaceId_agentId_spaceId_mountPath_key"
  ON "KnowledgeBinding"("organizationId", "workspaceId", "agentId", "spaceId", "mountPath");
CREATE INDEX "KnowledgeBinding_organizationId_workspaceId_updatedAt_idx"
  ON "KnowledgeBinding"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "KnowledgeBinding_organizationId_agentId_updatedAt_idx"
  ON "KnowledgeBinding"("organizationId", "agentId", "updatedAt");
CREATE INDEX "KnowledgeBinding_spaceId_updatedAt_idx"
  ON "KnowledgeBinding"("spaceId", "updatedAt");

CREATE TABLE "KnowledgeChangeRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "jobId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "baseCommit" TEXT NOT NULL,
  "headCommit" TEXT NOT NULL,
  "branchName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "diffSummary" TEXT NOT NULL DEFAULT '',
  "diffMetadataJson" TEXT NOT NULL DEFAULT '{}',
  "reviewerId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" DATETIME,
  "mergedCommit" TEXT,
  "mergedAt" DATETIME,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeChangeRequest_spaceId_organizationId_fkey"
    FOREIGN KEY ("spaceId", "organizationId")
    REFERENCES "KnowledgeSpace" ("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChangeRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChangeRequest_status_check"
    CHECK ("status" IN ('pending_review', 'approved', 'conflicted', 'rejected', 'merged')),
  CONSTRAINT "KnowledgeChangeRequest_merge_metadata_check"
    CHECK (
      ("status" = 'merged' AND "mergedCommit" IS NOT NULL AND "mergedAt" IS NOT NULL) OR
      ("status" <> 'merged' AND "mergedCommit" IS NULL AND "mergedAt" IS NULL)
    ),
  CONSTRAINT "KnowledgeChangeRequest_revision_check"
    CHECK ("revision" >= 1)
);

-- jobId and attemptId intentionally remain audit references rather than FKs so
-- retained review history is not coupled to execution-row retention. Creation
-- validates that both rows belong to the same organization and attempt/job pair.

CREATE UNIQUE INDEX "KnowledgeChangeRequest_attemptId_spaceId_headCommit_key"
  ON "KnowledgeChangeRequest"("attemptId", "spaceId", "headCommit");
CREATE UNIQUE INDEX "KnowledgeChangeRequest_id_organizationId_key"
  ON "KnowledgeChangeRequest"("id", "organizationId");
CREATE INDEX "KnowledgeChangeRequest_organizationId_status_updatedAt_idx"
  ON "KnowledgeChangeRequest"("organizationId", "status", "updatedAt");
CREATE INDEX "KnowledgeChangeRequest_jobId_createdAt_idx"
  ON "KnowledgeChangeRequest"("jobId", "createdAt");
CREATE INDEX "KnowledgeChangeRequest_attemptId_createdAt_idx"
  ON "KnowledgeChangeRequest"("attemptId", "createdAt");
CREATE INDEX "KnowledgeChangeRequest_spaceId_status_updatedAt_idx"
  ON "KnowledgeChangeRequest"("spaceId", "status", "updatedAt");

-- SQLite requires a referenced table to exist before this composite foreign
-- key can be enforced reliably, so snapshots are created after change requests.
CREATE TABLE "KnowledgeSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "spaceId" TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "commitSha" TEXT NOT NULL,
  "indexVersion" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSnapshot_spaceId_organizationId_fkey"
    FOREIGN KEY ("spaceId", "organizationId")
    REFERENCES "KnowledgeSpace" ("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSnapshot_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSnapshot_changeRequestId_organizationId_fkey"
    FOREIGN KEY ("changeRequestId", "organizationId")
    REFERENCES "KnowledgeChangeRequest" ("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeSnapshot_spaceId_commitSha_indexVersion_key"
  ON "KnowledgeSnapshot"("spaceId", "commitSha", "indexVersion");
CREATE INDEX "KnowledgeSnapshot_organizationId_createdAt_idx"
  ON "KnowledgeSnapshot"("organizationId", "createdAt");
CREATE INDEX "KnowledgeSnapshot_spaceId_createdAt_idx"
  ON "KnowledgeSnapshot"("spaceId", "createdAt");
CREATE INDEX "KnowledgeSnapshot_changeRequestId_createdAt_idx"
  ON "KnowledgeSnapshot"("changeRequestId", "createdAt");
