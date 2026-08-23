export {
  createProposeDocumentChangeTool,
} from '@/agent/tools/document/propose-document-change';
export { safeJsonParse } from '@/framework/resilience/safe-data';
export { prisma } from '@/lib/db/prisma';
export { IdempotencyConflictError } from '@/lib/platform/idempotency';
export { applyCommentSourceChange } from '@/lib/comments/source-apply';
export {
  canonicalJson,
  createStagedChangeSet,
  sha256,
} from '@/lib/workspace/planning';
export { applyStagedChangeSet } from '@/lib/workspace/staged-changes';
export { createWorkspaceVersion } from '@/objects/state/commands';
export { resolveDraftBaseVersionIdForVersion } from '@/objects/state/queries';
