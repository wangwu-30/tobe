ALTER TABLE "AgentProfile"
  ADD COLUMN "capabilitiesJson" TEXT NOT NULL DEFAULT '{"schemaVersion":1,"skills":[]}';

ALTER TABLE "AgentProfile"
  ADD COLUMN "configJson" TEXT NOT NULL DEFAULT '{"schemaVersion":1,"room":{"runtimeId":"pi-agent-core","configVersion":1}}';

ALTER TABLE "AgentProfile"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "AgentProfile"
SET "capabilitiesJson" = json_object(
  'schemaVersion', 1,
  'skills', json("skillsJson")
)
WHERE json_valid("skillsJson")
  AND json_type("skillsJson") = 'array';

-- Room sessions snapshot the public config version as text because the Room
-- contract predates AgentProfile V1 and its column is intentionally opaque.
UPDATE "RoomAgentSession"
SET "agentConfigVersion" = '1'
WHERE "agentConfigVersion" = 'v1';
