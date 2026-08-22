declare module '../../../.tmp/room-backend-test/room-backend.mjs' {
  export * from './index';
  export { prisma } from '@/lib/db/prisma';
  export { IdempotencyConflictError } from '@/lib/platform/idempotency';
  export { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
  export { serializeRoomSseEvent } from '@/lib/room/sse';
  export { PrismaRoomHostContextSourceV1 } from '@/agent/room-host/prisma-context-source';
  export { createPrismaRoomHostStoreV1 } from '@/agent/room-host/prisma-store';
  export { ensurePlatformContext } from '@/lib/platform/server-context';
  export { listAgentProfilesV1 } from '@/objects/agent-profile/queries';
  export { builtinAssistantProfileIdV1 } from '@/objects/agent-profile/schema';
}
