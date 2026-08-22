ALTER TABLE "ExecutionAttempt"
  ADD COLUMN "capacityReserved" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing running attempts were admitted before ownership was recorded on
-- the attempt. They are the only rows that can legitimately hold a slot.
UPDATE "ExecutionAttempt"
SET "capacityReserved" = TRUE
WHERE "status" = 'running';

ALTER TABLE "ExecutionInputRequest"
  ADD COLUMN "responseId" TEXT;

-- Preserve stable identity for any answers written before this migration.
UPDATE "ExecutionInputRequest"
SET "responseId" = 'legacy:' || "id"
WHERE "status" = 'answered' AND "responseId" IS NULL;

CREATE UNIQUE INDEX "ExecutionInputRequest_responseId_key"
  ON "ExecutionInputRequest"("responseId");
