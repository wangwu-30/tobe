CREATE TABLE "RoomToolConfirmationRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "requestedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "rejectedByUserId" TEXT,
  "roomId" TEXT NOT NULL,
  "roomMessageId" TEXT NOT NULL,
  "roomSessionId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "toolCallId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "parametersJson" TEXT NOT NULL,
  "parametersHash" TEXT NOT NULL,
  "safetyLevel" TEXT NOT NULL,
  "writePolicy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "originDeviceId" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "capabilityHash" TEXT,
  "approvedAt" DATETIME,
  "executedAt" DATETIME,
  "rejectedAt" DATETIME,
  "executionJobId" TEXT,
  "executionJobReceiptJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomToolConfirmationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_roomMessageId_fkey" FOREIGN KEY ("roomMessageId") REFERENCES "RoomMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_roomSessionId_fkey" FOREIGN KEY ("roomSessionId") REFERENCES "RoomAgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "RoomInboxDelivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_executionJobId_fkey" FOREIGN KEY ("executionJobId") REFERENCES "ExecutionJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationRequest_status_check" CHECK ("status" IN ('pending', 'approved', 'executed', 'rejected', 'expired')),
  CONSTRAINT "RoomToolConfirmationRequest_parameters_json_check" CHECK (json_valid("parametersJson")),
  CONSTRAINT "RoomToolConfirmationRequest_parameters_hash_check" CHECK (length("parametersHash") = 64),
  CONSTRAINT "RoomToolConfirmationRequest_capability_hash_check" CHECK ("capabilityHash" IS NULL OR length("capabilityHash") = 64),
  CONSTRAINT "RoomToolConfirmationRequest_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "RoomToolConfirmationRequest_execution_check" CHECK (("status" = 'executed') = ("executionJobId" IS NOT NULL AND "executedAt" IS NOT NULL AND "executionJobReceiptJson" IS NOT NULL))
);

CREATE UNIQUE INDEX "RoomToolConfirmationRequest_capabilityHash_key" ON "RoomToolConfirmationRequest"("capabilityHash");
CREATE UNIQUE INDEX "RoomToolConfirmationRequest_executionJobId_key" ON "RoomToolConfirmationRequest"("executionJobId");
CREATE UNIQUE INDEX "RoomToolConfirmationRequest_org_session_delivery_call_key" ON "RoomToolConfirmationRequest"("organizationId", "roomSessionId", "deliveryId", "toolCallId");
CREATE INDEX "RoomToolConfirmationRequest_org_room_status_created_idx" ON "RoomToolConfirmationRequest"("organizationId", "roomId", "status", "createdAt");
CREATE INDEX "RoomToolConfirmationRequest_org_requester_status_expiry_idx" ON "RoomToolConfirmationRequest"("organizationId", "requestedByUserId", "status", "expiresAt");
CREATE INDEX "RoomToolConfirmationRequest_roomMessageId_idx" ON "RoomToolConfirmationRequest"("roomMessageId");
CREATE INDEX "RoomToolConfirmationRequest_roomSessionId_idx" ON "RoomToolConfirmationRequest"("roomSessionId");
CREATE INDEX "RoomToolConfirmationRequest_deliveryId_idx" ON "RoomToolConfirmationRequest"("deliveryId");

DROP TABLE "RoomToolConfirmationGrant";
