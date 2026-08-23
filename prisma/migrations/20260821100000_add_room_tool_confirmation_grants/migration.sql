CREATE TABLE "RoomToolConfirmationGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "actorUserId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "roomMessageId" TEXT,
  "roomSessionId" TEXT,
  "toolName" TEXT NOT NULL,
  "parametersHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "consumedByToolCallId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomToolConfirmationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationGrant_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationGrant_roomMessageId_fkey" FOREIGN KEY ("roomMessageId") REFERENCES "RoomMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationGrant_roomSessionId_fkey" FOREIGN KEY ("roomSessionId") REFERENCES "RoomAgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomToolConfirmationGrant_parametersHash_check" CHECK (length("parametersHash") = 64),
  CONSTRAINT "RoomToolConfirmationGrant_nonceHash_check" CHECK (length("nonceHash") = 64),
  CONSTRAINT "RoomToolConfirmationGrant_consumption_check" CHECK (
    ("consumedAt" IS NULL AND "consumedByToolCallId" IS NULL) OR
    ("consumedAt" IS NOT NULL AND "consumedByToolCallId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "RoomToolConfirmationGrant_nonceHash_key" ON "RoomToolConfirmationGrant"("nonceHash");
CREATE INDEX "RoomToolConfirmationGrant_organizationId_roomId_actorUserId_consumedAt_expiresAt_idx" ON "RoomToolConfirmationGrant"("organizationId", "roomId", "actorUserId", "consumedAt", "expiresAt");
CREATE INDEX "RoomToolConfirmationGrant_roomMessageId_idx" ON "RoomToolConfirmationGrant"("roomMessageId");
CREATE INDEX "RoomToolConfirmationGrant_roomSessionId_idx" ON "RoomToolConfirmationGrant"("roomSessionId");
