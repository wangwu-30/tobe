INSERT INTO "Label" (
  "id",
  "organizationId",
  "versionId",
  "kind",
  "name",
  "createdByUserId",
  "originDeviceId",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'bootstrap-milestone-' || "Version"."id",
  "Version"."organizationId",
  "Version"."id",
  'milestone',
  "Version"."title",
  "Version"."createdByUserId",
  "Version"."originDeviceId",
  1,
  NULL,
  "Version"."lockedAt",
  "Version"."lockedAt"
FROM "Version"
WHERE "Version"."deletedAt" IS NULL
  AND "Version"."versionType" = 'manual'
  AND NOT EXISTS (
    SELECT 1
    FROM "Label"
    WHERE "Label"."deletedAt" IS NULL
      AND "Label"."kind" = 'milestone'
      AND "Label"."versionId" = "Version"."id"
  );
