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
  'bootstrap-recovery-' || "Version"."id",
  "Version"."organizationId",
  "Version"."id",
  'recovery',
  "Version"."title",
  "Version"."createdByUserId",
  "Version"."originDeviceId",
  1,
  NULL,
  "Version"."lockedAt",
  "Version"."lockedAt"
FROM "Version"
WHERE "Version"."deletedAt" IS NULL
  AND "Version"."versionType" IN ('checkpoint', 'checkpoint_pinned')
  AND NOT EXISTS (
    SELECT 1
    FROM "Label"
    WHERE "Label"."deletedAt" IS NULL
      AND "Label"."kind" = 'recovery'
      AND "Label"."versionId" = "Version"."id"
  );

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
  'bootstrap-pinned-' || "Version"."id",
  "Version"."organizationId",
  "Version"."id",
  'pinned',
  "Version"."title",
  "Version"."createdByUserId",
  "Version"."originDeviceId",
  1,
  NULL,
  "Version"."lockedAt",
  "Version"."lockedAt"
FROM "Version"
WHERE "Version"."deletedAt" IS NULL
  AND "Version"."versionType" = 'checkpoint_pinned'
  AND NOT EXISTS (
    SELECT 1
    FROM "Label"
    WHERE "Label"."deletedAt" IS NULL
      AND "Label"."kind" = 'pinned'
      AND "Label"."versionId" = "Version"."id"
  );
