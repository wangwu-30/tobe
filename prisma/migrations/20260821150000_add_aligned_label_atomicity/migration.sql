WITH "ranked_aligned" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "versionId", "kind"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "alignment_rank"
  FROM "Label"
  WHERE "kind" = 'aligned'
    AND "deletedAt" IS NULL
)
UPDATE "Label"
SET
  "deletedAt" = CURRENT_TIMESTAMP,
  "revision" = "revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_aligned"
  WHERE "alignment_rank" > 1
);

CREATE UNIQUE INDEX "Label_active_aligned_version_unique_idx"
ON "Label"("versionId")
WHERE "kind" = 'aligned' AND "deletedAt" IS NULL;
