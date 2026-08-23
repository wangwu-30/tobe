CREATE TABLE "Room" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "key" TEXT NOT NULL DEFAULT 'default',
  "projectId" TEXT,
  "name" TEXT NOT NULL DEFAULT 'Project Room',
  "hostAgentId" TEXT NOT NULL,
  "policyJson" TEXT NOT NULL,
  "messageSequence" INTEGER NOT NULL DEFAULT 0,
  "eventSequence" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Room_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Room_organizationId_key_key" ON "Room"("organizationId", "key");
CREATE INDEX "Room_organizationId_projectId_updatedAt_idx" ON "Room"("organizationId", "projectId", "updatedAt");

CREATE TABLE "RoomMessage" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL, "actorType" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorDisplayName" TEXT,
  "text" TEXT NOT NULL, "attachmentsJson" TEXT NOT NULL DEFAULT '[]', "replyToMessageId" TEXT,
  "correlationId" TEXT, "metadataJson" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "RoomMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoomMessage_roomId_sequence_key" ON "RoomMessage"("roomId", "sequence");
CREATE INDEX "RoomMessage_organizationId_roomId_createdAt_idx" ON "RoomMessage"("organizationId", "roomId", "createdAt");
CREATE INDEX "RoomMessage_roomId_replyToMessageId_idx" ON "RoomMessage"("roomId", "replyToMessageId");

CREATE TABLE "RoomMention" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL, "mentionIndex" INTEGER NOT NULL, "agentId" TEXT NOT NULL, "handle" TEXT NOT NULL,
  "rangeStart" INTEGER NOT NULL, "rangeEnd" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomMention_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "RoomMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMention_range_check" CHECK ("rangeStart" >= 0 AND "rangeEnd" > "rangeStart")
);
CREATE UNIQUE INDEX "RoomMention_messageId_mentionIndex_key" ON "RoomMention"("messageId", "mentionIndex");
CREATE INDEX "RoomMention_organizationId_roomId_agentId_createdAt_idx" ON "RoomMention"("organizationId", "roomId", "agentId", "createdAt");

CREATE TABLE "RoomAgentSession" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL, "agentHandle" TEXT NOT NULL, "agentDisplayName" TEXT, "agentConfigVersion" TEXT NOT NULL DEFAULT 'v1',
  "deliverySequence" INTEGER NOT NULL DEFAULT 0, "lastRoomSequence" INTEGER NOT NULL DEFAULT 0, "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active', "generation" INTEGER NOT NULL DEFAULT 0, "leaseOwnerId" TEXT, "leaseExpiresAt" DATETIME,
  "lastHeartbeatAt" DATETIME, "runtimeId" TEXT, "runtimeSessionId" TEXT, "checkpointJson" TEXT,
  "checkpointUpdatedAt" DATETIME, "currentDeliveryId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomAgentSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomAgentSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomAgentSession_generation_check" CHECK ("generation" >= 0)
);
CREATE UNIQUE INDEX "RoomAgentSession_organizationId_roomId_agentId_key" ON "RoomAgentSession"("organizationId", "roomId", "agentId");
CREATE INDEX "RoomAgentSession_organizationId_status_updatedAt_idx" ON "RoomAgentSession"("organizationId", "status", "updatedAt");
CREATE INDEX "RoomAgentSession_status_leaseExpiresAt_idx" ON "RoomAgentSession"("status", "leaseExpiresAt");
CREATE INDEX "RoomAgentSession_leaseOwnerId_leaseExpiresAt_idx" ON "RoomAgentSession"("leaseOwnerId", "leaseExpiresAt");

CREATE TABLE "RoomInboxDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "roomSessionId" TEXT NOT NULL, "messageId" TEXT NOT NULL, "deliverySequence" INTEGER NOT NULL, "intent" TEXT NOT NULL,
  "causeJson" TEXT NOT NULL, "attempt" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'pending',
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimedAt" DATETIME, "completedAt" DATETIME, "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomInboxDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomInboxDelivery_roomSessionId_fkey" FOREIGN KEY ("roomSessionId") REFERENCES "RoomAgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomInboxDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "RoomMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomInboxDelivery_attempt_check" CHECK ("attempt" >= 1)
);
CREATE UNIQUE INDEX "RoomInboxDelivery_roomSessionId_deliverySequence_key" ON "RoomInboxDelivery"("roomSessionId", "deliverySequence");
CREATE UNIQUE INDEX "RoomInboxDelivery_roomSessionId_messageId_key" ON "RoomInboxDelivery"("roomSessionId", "messageId");
CREATE INDEX "RoomInboxDelivery_organizationId_status_availableAt_idx" ON "RoomInboxDelivery"("organizationId", "status", "availableAt");
CREATE INDEX "RoomInboxDelivery_organizationId_roomId_createdAt_idx" ON "RoomInboxDelivery"("organizationId", "roomId", "createdAt");

CREATE TABLE "RoomEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL, "dataJson" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoomEvent_roomId_sequence_key" ON "RoomEvent"("roomId", "sequence");
CREATE INDEX "RoomEvent_organizationId_roomId_sequence_idx" ON "RoomEvent"("organizationId", "roomId", "sequence");

CREATE TABLE "RoomOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "topic" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "payloadJson" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" DATETIME,
  "lastError" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomOutbox_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomOutbox_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "RoomOutbox_organizationId_topic_dedupeKey_key" ON "RoomOutbox"("organizationId", "topic", "dedupeKey");
CREATE INDEX "RoomOutbox_organizationId_status_availableAt_idx" ON "RoomOutbox"("organizationId", "status", "availableAt");

CREATE TABLE "RoomDelegationGrant" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL DEFAULT 'local-org', "roomId" TEXT NOT NULL,
  "issuedByUserId" TEXT NOT NULL, "fromAgentId" TEXT NOT NULL, "targetAgentId" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "rootMessageId" TEXT, "consumedByInvocationId" TEXT, "consumedAt" DATETIME,
  "revokedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomDelegationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationGrant_scope_check" CHECK ("scope" IN ('once', 'room')),
  CONSTRAINT "RoomDelegationGrant_status_check" CHECK ("status" IN ('active', 'consumed', 'revoked'))
);
CREATE INDEX "RoomDelegationGrant_organizationId_roomId_status_fromAgentId_targetAgentId_idx" ON "RoomDelegationGrant"("organizationId", "roomId", "status", "fromAgentId", "targetAgentId");
CREATE UNIQUE INDEX "RoomDelegationGrant_organizationId_roomId_consumedByInvocationId_key" ON "RoomDelegationGrant"("organizationId", "roomId", "consumedByInvocationId");
