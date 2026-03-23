ALTER TABLE "Session" ADD COLUMN "projectId" TEXT;

ALTER TABLE "ChatMessage" ADD COLUMN "focusNodeId" TEXT;

CREATE INDEX "Session_projectId_updatedAt_idx" ON "Session"("projectId", "updatedAt");

CREATE INDEX "ChatMessage_focusNodeId_createdAt_idx" ON "ChatMessage"("focusNodeId", "createdAt");
