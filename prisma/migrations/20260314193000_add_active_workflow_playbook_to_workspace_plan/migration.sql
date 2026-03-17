ALTER TABLE "WorkspacePlan"
ADD COLUMN "activeWorkflowPlaybookId" TEXT;

CREATE INDEX "WorkspacePlan_activeWorkflowPlaybookId_updatedAt_idx"
ON "WorkspacePlan"("activeWorkflowPlaybookId", "updatedAt");
