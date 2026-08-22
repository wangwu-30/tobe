PRAGMA foreign_keys=OFF;

CREATE TABLE "new_RoomDelegationGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "roomId" TEXT NOT NULL,
  "issuedByUserId" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "targetAgentId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rootMessageId" TEXT,
  "consumedByInvocationId" TEXT,
  "consumedAt" DATETIME,
  "revokedAt" DATETIME,
  "expiresAt" DATETIME NOT NULL DEFAULT (datetime('now', '+30 days')),
  "hopLimit" INTEGER NOT NULL DEFAULT 3,
  "invocationLimit" INTEGER NOT NULL DEFAULT 8,
  "invocationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomDelegationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationGrant_scope_check" CHECK ("scope" IN ('once', 'room')),
  CONSTRAINT "RoomDelegationGrant_status_check" CHECK ("status" IN ('active', 'consumed', 'revoked')),
  CONSTRAINT "RoomDelegationGrant_agents_check" CHECK ("fromAgentId" <> "targetAgentId"),
  CONSTRAINT "RoomDelegationGrant_limits_check" CHECK ("hopLimit" > 0 AND "invocationLimit" > 0),
  CONSTRAINT "RoomDelegationGrant_count_check" CHECK ("invocationCount" >= 0 AND "invocationCount" <= "invocationLimit")
);

INSERT INTO "new_RoomDelegationGrant" (
  "id", "organizationId", "roomId", "issuedByUserId",
  "fromAgentId", "targetAgentId", "scope", "status",
  "rootMessageId", "consumedByInvocationId", "consumedAt",
  "revokedAt", "expiresAt", "hopLimit", "invocationLimit",
  "invocationCount", "createdAt", "updatedAt"
)
SELECT
  "id", "organizationId", "roomId", "issuedByUserId",
  "fromAgentId", "targetAgentId", "scope", "status",
  "rootMessageId", "consumedByInvocationId", "consumedAt",
  "revokedAt", datetime("updatedAt", '+30 days'), 3, 8,
  CASE WHEN "scope" = 'once' AND "status" = 'consumed' THEN 1 ELSE 0 END,
  "createdAt", "updatedAt"
FROM "RoomDelegationGrant";

DROP TABLE "RoomDelegationGrant";
ALTER TABLE "new_RoomDelegationGrant" RENAME TO "RoomDelegationGrant";
CREATE UNIQUE INDEX "RoomDelegationGrant_organizationId_roomId_consumedByInvocationId_key" ON "RoomDelegationGrant"("organizationId", "roomId", "consumedByInvocationId");
CREATE INDEX "RoomDelegationGrant_organizationId_roomId_status_fromAgentId_targetAgentId_idx" ON "RoomDelegationGrant"("organizationId", "roomId", "status", "fromAgentId", "targetAgentId");

CREATE TABLE "RoomDelegationRootBudget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "roomId" TEXT NOT NULL,
  "rootMessageId" TEXT NOT NULL,
  "invocationLimit" INTEGER NOT NULL,
  "invocationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomDelegationRootBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationRootBudget_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationRootBudget_limit_check" CHECK ("invocationLimit" > 0),
  CONSTRAINT "RoomDelegationRootBudget_count_check" CHECK ("invocationCount" >= 0 AND "invocationCount" <= "invocationLimit")
);
CREATE UNIQUE INDEX "RoomDelegationRootBudget_organizationId_roomId_rootMessageId_key" ON "RoomDelegationRootBudget"("organizationId", "roomId", "rootMessageId");
CREATE INDEX "RoomDelegationRootBudget_organizationId_roomId_updatedAt_idx" ON "RoomDelegationRootBudget"("organizationId", "roomId", "updatedAt");

CREATE TABLE "RoomDelegationInvocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "roomId" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "grantId" TEXT,
  "rootMessageId" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "targetAgentId" TEXT NOT NULL,
  "sourceRoomSessionId" TEXT NOT NULL,
  "sourceDeliveryId" TEXT NOT NULL,
  "sourceGeneration" INTEGER NOT NULL,
  "parentInvocationId" TEXT,
  "hop" INTEGER NOT NULL,
  "instructionMessageId" TEXT,
  "targetDeliveryId" TEXT,
  "acceptedEventId" TEXT,
  "blockedEventId" TEXT,
  "failureCode" TEXT,
  "status" TEXT NOT NULL,
  "completedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomDelegationInvocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "RoomDelegationGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_sourceRoomSessionId_fkey" FOREIGN KEY ("sourceRoomSessionId") REFERENCES "RoomAgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_sourceDeliveryId_fkey" FOREIGN KEY ("sourceDeliveryId") REFERENCES "RoomInboxDelivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_parentInvocationId_fkey" FOREIGN KEY ("parentInvocationId") REFERENCES "RoomDelegationInvocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_instructionMessageId_fkey" FOREIGN KEY ("instructionMessageId") REFERENCES "RoomMessage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_targetDeliveryId_fkey" FOREIGN KEY ("targetDeliveryId") REFERENCES "RoomInboxDelivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_acceptedEventId_fkey" FOREIGN KEY ("acceptedEventId") REFERENCES "RoomEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_blockedEventId_fkey" FOREIGN KEY ("blockedEventId") REFERENCES "RoomEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomDelegationInvocation_agents_check" CHECK ("status" <> 'accepted' OR "fromAgentId" <> "targetAgentId"),
  CONSTRAINT "RoomDelegationInvocation_generation_check" CHECK ("sourceGeneration" >= 0),
  CONSTRAINT "RoomDelegationInvocation_hop_check" CHECK ("hop" > 0),
  CONSTRAINT "RoomDelegationInvocation_status_check" CHECK ("status" IN ('accepted', 'blocked')),
  CONSTRAINT "RoomDelegationInvocation_accepted_receipt_check" CHECK ("status" <> 'accepted' OR ("grantId" IS NOT NULL AND "instructionMessageId" IS NOT NULL AND "targetDeliveryId" IS NOT NULL AND "acceptedEventId" IS NOT NULL AND "blockedEventId" IS NULL AND "failureCode" IS NULL)),
  CONSTRAINT "RoomDelegationInvocation_blocked_receipt_check" CHECK ("status" <> 'blocked' OR ("blockedEventId" IS NOT NULL AND "failureCode" IS NOT NULL AND "targetDeliveryId" IS NULL AND "acceptedEventId" IS NULL))
);
CREATE UNIQUE INDEX "RoomDelegationInvocation_targetDeliveryId_key" ON "RoomDelegationInvocation"("targetDeliveryId");
CREATE UNIQUE INDEX "RoomDelegationInvocation_organizationId_roomId_invocationId_key" ON "RoomDelegationInvocation"("organizationId", "roomId", "invocationId");
CREATE INDEX "RoomDelegationInvocation_organizationId_roomId_rootMessageId_status_idx" ON "RoomDelegationInvocation"("organizationId", "roomId", "rootMessageId", "status");
CREATE INDEX "RoomDelegationInvocation_grantId_status_createdAt_idx" ON "RoomDelegationInvocation"("grantId", "status", "createdAt");
CREATE INDEX "RoomDelegationInvocation_parentInvocationId_idx" ON "RoomDelegationInvocation"("parentInvocationId");
CREATE INDEX "RoomDelegationInvocation_sourceRoomSessionId_sourceDeliveryId_idx" ON "RoomDelegationInvocation"("sourceRoomSessionId", "sourceDeliveryId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
