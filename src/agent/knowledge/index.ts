export { GIT_WORKTREE_CONTRACT_VERSION_V1 } from './contracts';
export type {
  FinalizedGitWorktree,
  FinalizedGitWorktreeV1,
  GitKnowledgeBaseResolveInput,
  GitKnowledgeBaseResolveInputV1,
  GitKnowledgeBaseResolver,
  GitKnowledgeBaseResolverV1,
  GitWorktreeCommitAuthorV1,
  GitWorktreeContractVersionV1,
  GitWorktreeDiffSummary,
  GitWorktreeDiffSummaryV1,
  GitWorktreePort,
  GitWorktreeRecoveryPortV1,
  GitWorktreeRecoveryStateV1,
  GitWorktreePortV1,
  GitWorktreePrepareInput,
  GitWorktreePrepareInputV1,
  PreparedGitWorktree,
  PreparedGitWorktreeV1,
} from './contracts';
export {
  GitWorktreeError,
  LocalGitKnowledgeBaseResolver,
  LocalGitKnowledgeBaseResolverV1,
  LocalGitWorktreePort,
  LocalGitWorktreePortV1,
} from './git-worktree';
export {
  chunkKnowledgeDocument,
  type ChunkKnowledgeDocumentInput,
  type KnowledgeChunkV1,
} from './chunker';
export {
  KNOWLEDGE_INDEX_VERSION_V1,
  KNOWLEDGE_INDEX_VERSION_V2_FTS5,
  KnowledgeIndexBuildErrorV1,
  LocalKnowledgeIndexBuilderV1,
  isSqliteArtifactBytes,
  readKnowledgeIndexArtifactV1,
  type BuiltKnowledgeIndexV1,
  type KnowledgeIndexArtifactV1,
  type KnowledgeIndexBuilderInputV1,
  type KnowledgeIndexBuilderPortV1,
  type KnowledgeIndexDocumentV1,
  type LocalKnowledgeIndexBuilderConfigV1,
} from './index-builder';
export {
  KNOWLEDGE_RETRIEVAL_TRUST_V1,
  readBoundKnowledgeDocumentForScope,
  readKnowledgeIndexDocument,
  searchBoundKnowledgeForScope,
  searchKnowledgeIndexArtifact,
  type BoundKnowledgeDocumentReadV1,
  type BoundKnowledgeSearchHitV1,
  type KnowledgeArtifactDocumentReadV1,
  type KnowledgeArtifactSearchHitV1,
  type KnowledgeRetrievalTrustV1,
} from './search';
export {
  LocalTrustedKnowledgeGitPortV1,
  TrustedKnowledgeGitError,
  type LocalTrustedKnowledgeGitPortConfigV1,
  type TrustedKnowledgeDiffV1,
  type TrustedKnowledgeGitErrorCode,
  type TrustedKnowledgeGitPortV1,
  type TrustedKnowledgeMergeInputV1,
  type TrustedKnowledgeMergeResultV1,
} from './trusted-merge';
export {
  createTrustedKnowledgeMergeProcessV1,
  type TrustedKnowledgeMergeProcessConfigV1,
  type TrustedKnowledgeMergeProcessV1,
  type KnowledgeMergeRunSummaryV1,
} from './trusted-merge-process';
export {
  TrustedKnowledgeMergeWorkerV1,
  type KnowledgeMergeProcessResultV1,
  type TrustedKnowledgeMergeWorkerDependenciesV1,
  type TrustedKnowledgeMergeWorkerOptionsV1,
} from './trusted-merge-worker';
export {
  readTrustedKnowledgeDiffV1,
  type TrustedKnowledgeDiffReadInputV1,
} from './trusted-reader';
export type {
  GitWorktreeErrorCode,
  LocalGitKnowledgeBaseResolverConfig,
  LocalGitWorktreePortConfig,
} from './git-worktree';
