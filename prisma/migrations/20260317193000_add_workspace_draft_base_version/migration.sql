ALTER TABLE "Document" ADD COLUMN "draftBaseVersionId" TEXT;

CREATE INDEX "Document_draftBaseVersionId_idx" ON "Document"("draftBaseVersionId");
