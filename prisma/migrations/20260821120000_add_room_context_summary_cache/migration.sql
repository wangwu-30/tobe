CREATE TABLE "RoomContextSummaryCache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL DEFAULT 'local-org',
  "roomId" TEXT NOT NULL,
  "roomSessionId" TEXT NOT NULL,
  "fromSequence" INTEGER NOT NULL,
  "throughSequence" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "aclHash" TEXT NOT NULL,
  "configVersion" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomContextSummaryCache_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomContextSummaryCache_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomContextSummaryCache_roomSessionId_fkey"
    FOREIGN KEY ("roomSessionId") REFERENCES "RoomAgentSession" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomContextSummaryCache_sequence_check"
    CHECK ("fromSequence" >= 0 AND "throughSequence" >= "fromSequence")
);

CREATE UNIQUE INDEX "RoomContextSummaryCache_roomSessionId_configVersion_key"
  ON "RoomContextSummaryCache" ("roomSessionId", "configVersion");

CREATE INDEX "RoomContextSummaryCache_organizationId_roomId_updatedAt_idx"
  ON "RoomContextSummaryCache" ("organizationId", "roomId", "updatedAt");

CREATE INDEX "RoomContextSummaryCache_organizationId_roomSessionId_updatedAt_idx"
  ON "RoomContextSummaryCache" ("organizationId", "roomSessionId", "updatedAt");
