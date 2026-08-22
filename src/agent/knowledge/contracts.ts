export const GIT_WORKTREE_CONTRACT_VERSION_V1 = 1 as const;

export type GitWorktreeContractVersionV1 =
  typeof GIT_WORKTREE_CONTRACT_VERSION_V1;

/**
 * Identity used by the trusted control plane when it creates a commit. It is
 * configuration, never agent- or prompt-provided input.
 */
export type GitWorktreeCommitAuthorV1 = {
  name: string;
  email: string;
};

export type GitWorktreePrepareInput = {
  spaceId: string;
  /** Logical mount selected by admission. V1 only supports the repository root. */
  mountPath: '/';
  /**
   * Privileged input: callers MUST obtain this absolute path from a trusted
   * KnowledgeSpace repository binding. A job goal, prompt, tool argument, or
   * runtime response must never supply or override it.
   */
  repoPath: string;
  defaultBranch: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  agentId?: string;
  /** An immutable commit id frozen by the control plane, when available. */
  baseCommit?: string;
};

/**
 * Opaque lifecycle receipt. Consumers should persist it unchanged and pass it
 * back to finalize/cleanup; the local implementation validates every field
 * again before performing a mutating operation.
 */
export type PreparedGitWorktree = {
  schemaVersion: GitWorktreeContractVersionV1;
  spaceId: string;
  mountPath: '/';
  repositoryPath: string;
  worktreePath: string;
  defaultBranch: string;
  branch: string;
  baseCommit: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  agentId?: string;
};

export type GitWorktreeDiffSummary = {
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** Git's locale-stable shortstat text; empty when there is no change. */
  shortStat: string;
};

export type FinalizedGitWorktree = {
  schemaVersion: GitWorktreeContractVersionV1;
  spaceId: string;
  jobId: string;
  attemptId: string;
  agentId?: string;
  changed: boolean;
  baseCommit: string;
  headCommit: string;
  branch: string;
  files: readonly string[];
  diffSummary: GitWorktreeDiffSummary;
  /** Lower-case SHA-256 of the canonical binary Git patch; never the patch. */
  patchSha256: string;
};

/**
 * Creates isolated attempt worktrees and turns their edits into reviewable
 * commits. This port deliberately has no merge, push, fetch, or default-branch
 * mutation operation.
 */
export interface GitWorktreePort {
  prepare(input: GitWorktreePrepareInput): Promise<PreparedGitWorktree>;
  prepareOrRecover(
    input: GitWorktreePrepareInput
  ): Promise<PreparedGitWorktree>;
  finalize(
    prepared: PreparedGitWorktree
  ): Promise<FinalizedGitWorktree>;
  finalizeOrRecover(
    prepared: PreparedGitWorktree
  ): Promise<FinalizedGitWorktree>;
  cleanup(prepared: PreparedGitWorktree): Promise<void>;
  cleanupOrRecover(prepared: PreparedGitWorktree): Promise<void>;
}

export type GitWorktreeRecoveryStateV1 = {
  schemaVersion: GitWorktreeContractVersionV1;
  state:
    | 'absent'
    | 'prepared-clean'
    | 'prepared-dirty'
    | 'finalized-clean'
    | 'drifted';
};

/**
 * Trusted operator/recovery seam. This is intentionally separate from the
 * runtime-facing port so normal prepare recovery remains clean-only. Every
 * method requires a durable PreparedGitWorktree receipt and revalidates it.
 */
export interface GitWorktreeRecoveryPortV1 {
  inspectRecoveryState(
    prepared: PreparedGitWorktree
  ): Promise<GitWorktreeRecoveryStateV1>;
  recoverSuspended(
    prepared: PreparedGitWorktree
  ): Promise<PreparedGitWorktree>;
  discardQuarantined(prepared: PreparedGitWorktree): Promise<void>;
}

export type GitKnowledgeBaseResolveInput = {
  /** Trusted absolute path from a KnowledgeSpace repository binding. */
  repoPath: string;
  defaultBranch: string;
};

/** Resolves a trusted local repository ref to a full immutable commit id. */
export interface GitKnowledgeBaseResolver {
  resolve(input: GitKnowledgeBaseResolveInput): Promise<string>;
}

export type GitWorktreePrepareInputV1 = GitWorktreePrepareInput;
export type PreparedGitWorktreeV1 = PreparedGitWorktree;
export type GitWorktreeDiffSummaryV1 = GitWorktreeDiffSummary;
export type FinalizedGitWorktreeV1 = FinalizedGitWorktree;
export type GitWorktreePortV1 = GitWorktreePort;
export type GitKnowledgeBaseResolveInputV1 = GitKnowledgeBaseResolveInput;
export type GitKnowledgeBaseResolverV1 = GitKnowledgeBaseResolver;
