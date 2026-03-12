-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'local',
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "cloudEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'local',
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "title" TEXT NOT NULL DEFAULT 'New Conversation',
    "wikiId" TEXT,
    "parentSessionId" TEXT,
    "forkedFromMessageId" TEXT,
    "baseVersionId" TEXT,
    "activeFileId" TEXT,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'chat',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_wikiId_fkey" FOREIGN KEY ("wikiId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_forkedFromMessageId_fkey" FOREIGN KEY ("forkedFromMessageId") REFERENCES "ChatMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_activeFileId_fkey" FOREIGN KEY ("activeFileId") REFERENCES "WorkspaceFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "documentId" TEXT,
    "model" TEXT,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "content" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "documentId" TEXT NOT NULL,
    "versionNum" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "sourceSessionId" TEXT,
    "sourceMessageId" TEXT,
    "snapshotType" TEXT NOT NULL DEFAULT 'manual',
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    CONSTRAINT "Version_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Version_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Version_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Version_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Version_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "documentId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'file',
    "kind" TEXT NOT NULL DEFAULT 'richtext',
    "role" TEXT NOT NULL DEFAULT 'deliverable',
    "path" TEXT NOT NULL,
    "language" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceFile_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkspaceFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommentThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "documentId" TEXT NOT NULL,
    "fileId" TEXT,
    "versionId" TEXT,
    "anchorText" TEXT NOT NULL,
    "selectionAnchor" TEXT,
    "draftRevision" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommentThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommentThread_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommentThread_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkspaceFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommentThread_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommentMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommentThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT,
    "documentId" TEXT,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceThreadId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "documentId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'note',
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WikiEditLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originDeviceId" TEXT NOT NULL,
    "lockedVersionId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WikiEditLock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WikiEditLock_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "kind" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "previewUrl" TEXT,
    "logPath" TEXT,
    "exitCode" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'local-org',
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "storageFormat" TEXT NOT NULL DEFAULT 'text',
    "mimeType" TEXT,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatAttachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "WorkspaceFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspacePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "deliverableType" TEXT NOT NULL DEFAULT 'document',
    "constraints" TEXT,
    "styleGuide" TEXT,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "version" INTEGER NOT NULL DEFAULT 1,
    "stagesJson" TEXT NOT NULL,
    "activeStageId" TEXT,
    "lastProgressNote" TEXT,
    "createdByUserId" TEXT,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspacePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspacePlan_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MutationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "responseJson" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MutationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StagedChangeSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "baseVersionId" TEXT,
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
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StagedChangeSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StagedChangeSet_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "originDeviceId" TEXT,
    "revision" INTEGER NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,
    "pushedAt" DATETIME,
    CONSTRAINT "SyncEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "lastEventId" TEXT,
    "lastOccurredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncCursor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncCursor_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Session_organizationId_updatedAt_idx" ON "Session"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Session_wikiId_updatedAt_idx" ON "Session"("wikiId", "updatedAt");

-- CreateIndex
CREATE INDEX "Session_parentSessionId_updatedAt_idx" ON "Session"("parentSessionId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_organizationId_createdAt_idx" ON "ChatMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_organizationId_updatedAt_idx" ON "Document"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Document_sessionId_updatedAt_idx" ON "Document"("sessionId", "updatedAt");

-- CreateIndex
CREATE INDEX "Version_organizationId_lockedAt_idx" ON "Version"("organizationId", "lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Version_documentId_versionNum_key" ON "Version"("documentId", "versionNum");

-- CreateIndex
CREATE INDEX "WorkspaceFile_organizationId_updatedAt_idx" ON "WorkspaceFile"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceFile_documentId_parentId_sortOrder_idx" ON "WorkspaceFile"("documentId", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceFile_documentId_path_key" ON "WorkspaceFile"("documentId", "path");

-- CreateIndex
CREATE INDEX "CommentThread_organizationId_updatedAt_idx" ON "CommentThread"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "CommentThread_documentId_updatedAt_idx" ON "CommentThread"("documentId", "updatedAt");

-- CreateIndex
CREATE INDEX "CommentThread_fileId_updatedAt_idx" ON "CommentThread"("fileId", "updatedAt");

-- CreateIndex
CREATE INDEX "CommentMessage_organizationId_createdAt_idx" ON "CommentMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentMessage_threadId_createdAt_idx" ON "CommentMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_organizationId_createdAt_idx" ON "Memory"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_documentId_createdAt_idx" ON "Memory"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_sessionId_createdAt_idx" ON "Memory"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_createdAt_idx" ON "KnowledgeItem"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_documentId_createdAt_idx" ON "KnowledgeItem"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WikiEditLock_documentId_key" ON "WikiEditLock"("documentId");

-- CreateIndex
CREATE INDEX "WikiEditLock_organizationId_expiresAt_idx" ON "WikiEditLock"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkspaceRun_organizationId_startedAt_idx" ON "WorkspaceRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkspaceRun_documentId_startedAt_idx" ON "WorkspaceRun"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkspaceRun_status_startedAt_idx" ON "WorkspaceRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AssistantRun_organizationId_startedAt_idx" ON "AssistantRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "AssistantRun_sessionId_startedAt_idx" ON "AssistantRun"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AssistantRun_documentId_startedAt_idx" ON "AssistantRun"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "AssistantRun_status_startedAt_idx" ON "AssistantRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_organizationId_createdAt_idx" ON "ChatAttachment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_sessionId_createdAt_idx" ON "ChatAttachment"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_createdAt_idx" ON "ChatAttachment"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_documentId_createdAt_idx" ON "ChatAttachment"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspacePlan_documentId_key" ON "WorkspacePlan"("documentId");

-- CreateIndex
CREATE INDEX "WorkspacePlan_organizationId_updatedAt_idx" ON "WorkspacePlan"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkspacePlan_documentId_updatedAt_idx" ON "WorkspacePlan"("documentId", "updatedAt");

-- CreateIndex
CREATE INDEX "MutationRequest_organizationId_userId_operation_status_updatedAt_idx" ON "MutationRequest"("organizationId", "userId", "operation", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "MutationRequest_organizationId_createdAt_idx" ON "MutationRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MutationRequest_organizationId_userId_operation_requestKey_key" ON "MutationRequest"("organizationId", "userId", "operation", "requestKey");

-- CreateIndex
CREATE INDEX "StagedChangeSet_organizationId_updatedAt_idx" ON "StagedChangeSet"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "StagedChangeSet_documentId_updatedAt_idx" ON "StagedChangeSet"("documentId", "updatedAt");

-- CreateIndex
CREATE INDEX "StagedChangeSet_sessionId_updatedAt_idx" ON "StagedChangeSet"("sessionId", "updatedAt");

-- CreateIndex
CREATE INDEX "StagedChangeSet_status_updatedAt_idx" ON "StagedChangeSet"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SyncEvent_organizationId_occurredAt_idx" ON "SyncEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "SyncEvent_entityType_entityId_revision_idx" ON "SyncEvent"("entityType", "entityId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_organizationId_deviceId_backend_key" ON "SyncCursor"("organizationId", "deviceId", "backend");

