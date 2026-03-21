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
  'bootstrap-head-' || "Version"."id",
  "Version"."organizationId",
  "Version"."id",
  'head',
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
    FROM "Version" AS "ChildVersion"
    WHERE "ChildVersion"."deletedAt" IS NULL
      AND "ChildVersion"."organizationId" = "Version"."organizationId"
      AND "ChildVersion"."parentVersionId" = "Version"."id"
      AND "ChildVersion"."versionType" NOT IN ('checkpoint', 'checkpoint_pinned')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Label"
    WHERE "Label"."deletedAt" IS NULL
      AND "Label"."kind" = 'head'
      AND "Label"."versionId" = "Version"."id"
  );
