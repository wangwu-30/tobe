import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { devNull } from 'node:os';
import path from 'node:path';

import {
  GIT_WORKTREE_CONTRACT_VERSION_V1,
  type FinalizedGitWorktree,
  type GitKnowledgeBaseResolveInput,
  type GitKnowledgeBaseResolver,
  type GitWorktreeCommitAuthorV1,
  type GitWorktreeDiffSummary,
  type GitWorktreePort,
  type GitWorktreeRecoveryPortV1,
  type GitWorktreeRecoveryStateV1,
  type GitWorktreePrepareInput,
  type PreparedGitWorktree,
} from './contracts';

const DEFAULT_MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const EMPTY_PATCH_SHA256 = createHash('sha256').update('').digest('hex');
const SAFE_ID = /^[A-Za-z0-9@][A-Za-z0-9._:@-]{0,127}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const COMMON_GIT_CONFIG = [
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'core.fsmonitor=false',
  '-c',
  'credential.helper=',
  '-c',
  'diff.external=',
];

export type LocalGitWorktreePortConfig = {
  /** Dedicated absolute directory owned by this service. */
  managedRoot: string;
  /** Trusted service identity; never populate it from a job or agent. */
  commitAuthor: GitWorktreeCommitAuthorV1;
  gitBinary?: string;
  maxGitOutputBytes?: number;
};

export type LocalGitKnowledgeBaseResolverConfig = {
  gitBinary?: string;
  maxGitOutputBytes?: number;
};

export type GitWorktreeOperation =
  | 'prepare'
  | 'finalize'
  | 'cleanup'
  | 'resolve-base'
  | 'configuration';

export type GitWorktreeErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'invalid-repository'
  | 'invalid-base-commit'
  | 'branch-already-exists'
  | 'worktree-path-conflict'
  | 'invalid-receipt'
  | 'unsafe-worktree-path'
  | 'worktree-not-registered'
  | 'worktree-state-changed'
  | 'uncommittable-changes'
  | 'git-command-failed';

/** Deliberately excludes command arguments, stdout, stderr, and diff content. */
export class GitWorktreeError extends Error {
  constructor(
    readonly code: GitWorktreeErrorCode,
    readonly operation: GitWorktreeOperation
  ) {
    super(`Git worktree ${operation} failed (${code}).`);
    this.name = 'GitWorktreeError';
  }
}

type GitResult = { stdout: Buffer; exitCode: number };
type RuntimeWorktreeState = {
  pathExists: boolean;
  branchHead?: string;
};

class LocalGitCommandRunner {
  protected readonly gitBinary: string;
  protected readonly maxGitOutputBytes: number;

  constructor(config: LocalGitKnowledgeBaseResolverConfig = {}) {
    if (
      (!config.gitBinary?.trim() && config.gitBinary !== undefined) ||
      (config.maxGitOutputBytes !== undefined &&
        (!Number.isSafeInteger(config.maxGitOutputBytes) ||
          config.maxGitOutputBytes <= 0))
    ) {
      throw new GitWorktreeError('invalid-config', 'configuration');
    }
    this.gitBinary = config.gitBinary ?? 'git';
    this.maxGitOutputBytes =
      config.maxGitOutputBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES;
  }

  protected async repositoryRoot(
    candidate: string,
    operation: Exclude<GitWorktreeOperation, 'configuration'>
  ): Promise<string> {
    if (!path.isAbsolute(candidate)) {
      throw new GitWorktreeError('invalid-repository', operation);
    }
    const physical = await safeRealpath(
      candidate,
      operation,
      'invalid-repository'
    );
    const info = await stat(physical).catch(() => null);
    if (!info?.isDirectory()) {
      throw new GitWorktreeError('invalid-repository', operation);
    }
    let root: string;
    try {
      const result = await this.git(
        physical,
        ['rev-parse', '--show-toplevel'],
        operation
      );
      root = path.resolve(result.stdout.toString('utf8').trim());
    } catch {
      throw new GitWorktreeError('invalid-repository', operation);
    }
    if (root !== physical) {
      throw new GitWorktreeError('invalid-repository', operation);
    }
    return physical;
  }

  protected async assertDefaultBranch(
    repositoryPath: string,
    defaultBranch: string,
    operation: 'prepare' | 'finalize' | 'cleanup' | 'resolve-base' = 'prepare'
  ): Promise<void> {
    try {
      assertDefaultBranchName(defaultBranch);
      await this.git(
        repositoryPath,
        ['check-ref-format', `refs/heads/${defaultBranch}`],
        operation
      );
    } catch {
      throw new GitWorktreeError('invalid-input', operation);
    }
  }

  protected async commitAt(
    repositoryPath: string,
    revision: string,
    operation: 'prepare' | 'finalize' | 'cleanup' | 'resolve-base'
  ): Promise<string> {
    const result = await this.git(
      repositoryPath,
      ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
      operation
    );
    const commit = result.stdout.toString('utf8').trim().toLowerCase();
    if (!OBJECT_ID.test(commit)) {
      throw new GitWorktreeError('invalid-base-commit', operation);
    }
    return commit;
  }

  protected git(
    repositoryPath: string,
    args: readonly string[],
    operation: Exclude<GitWorktreeOperation, 'configuration'>,
    acceptedExitCodes: readonly number[] = [0],
    extraEnvironment: Readonly<Record<string, string>> = {}
  ): Promise<GitResult> {
    const environment = safeEnvironment(extraEnvironment);
    return new Promise((resolve, reject) => {
      execFile(
        this.gitBinary,
        [...COMMON_GIT_CONFIG, '-C', repositoryPath, ...args],
        {
          encoding: 'buffer',
          env: environment,
          maxBuffer: this.maxGitOutputBytes,
          windowsHide: true,
        },
        (error, stdout) => {
          const exitCode = numericExitCode(error);
          if (error && !acceptedExitCodes.includes(exitCode)) {
            reject(new GitWorktreeError('git-command-failed', operation));
            return;
          }
          resolve({
            stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
            exitCode,
          });
        }
      );
    });
  }
}

export class LocalGitKnowledgeBaseResolver
  extends LocalGitCommandRunner
  implements GitKnowledgeBaseResolver
{
  async resolve(input: GitKnowledgeBaseResolveInput): Promise<string> {
    assertBaseResolveInput(input);
    const repositoryPath = await this.repositoryRoot(
      input.repoPath,
      'resolve-base'
    );
    await this.assertDefaultBranch(
      repositoryPath,
      input.defaultBranch,
      'resolve-base'
    );
    try {
      return await this.commitAt(
        repositoryPath,
        `refs/heads/${input.defaultBranch}`,
        'resolve-base'
      );
    } catch {
      throw new GitWorktreeError('invalid-base-commit', 'resolve-base');
    }
  }
}

export class LocalGitWorktreePort
  extends LocalGitCommandRunner
  implements GitWorktreePort, GitWorktreeRecoveryPortV1
{
  private readonly configuredRoot: string;
  private readonly author: GitWorktreeCommitAuthorV1;

  constructor(config: LocalGitWorktreePortConfig) {
    super(config);
    if (
      !path.isAbsolute(config.managedRoot) ||
      /[\r\n\0]/.test(config.managedRoot) ||
      path.resolve(config.managedRoot) === path.parse(config.managedRoot).root ||
      !isSafeAuthor(config.commitAuthor)
    ) {
      throw new GitWorktreeError('invalid-config', 'configuration');
    }

    this.configuredRoot = path.resolve(config.managedRoot);
    this.author = { ...config.commitAuthor };
  }

  async prepare(
    input: GitWorktreePrepareInput
  ): Promise<PreparedGitWorktree> {
    return this.prepareInternal(input, false);
  }

  async prepareOrRecover(
    input: GitWorktreePrepareInput
  ): Promise<PreparedGitWorktree> {
    return this.prepareInternal(input, true);
  }

  private async prepareInternal(
    input: GitWorktreePrepareInput,
    allowBranchOnlyRecovery: boolean
  ): Promise<PreparedGitWorktree> {
    assertPrepareInput(input);
    const root = await this.managedRoot('prepare');
    const repositoryPath = await this.repositoryRoot(
      input.repoPath,
      'prepare'
    );
    if (
      repositoryPath === root ||
      isStrictDescendant(root, repositoryPath) ||
      isStrictDescendant(repositoryPath, root)
    ) {
      throw new GitWorktreeError('invalid-repository', 'prepare');
    }
    await this.assertDefaultBranch(repositoryPath, input.defaultBranch);

    const baseCommit = await this.resolveBaseCommit(repositoryPath, input);
    const branch = buildBranch(input);
    const worktreePath = buildWorktreePath(
      root,
      repositoryPath,
      input
    );
    const prepared: PreparedGitWorktree = {
      schemaVersion: GIT_WORKTREE_CONTRACT_VERSION_V1,
      spaceId: input.spaceId,
      mountPath: input.mountPath,
      repositoryPath,
      worktreePath,
      defaultBranch: input.defaultBranch,
      branch,
      baseCommit,
      jobId: input.jobId,
      attemptId: input.attemptId,
      attemptNumber: input.attemptNumber,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    };

    const existing = await this.inspectPrepareState(prepared);
    if (await this.isExactPreparedState(prepared, existing)) {
      return prepared;
    }
    this.assertPrepareStateAvailable(
      prepared,
      existing,
      allowBranchOnlyRecovery
    );
    await this.assertNewWorktreePath(root, worktreePath);

    try {
      // A branch-only retry must atomically prove the ref stayed at the base.
      await this.git(
        repositoryPath,
        [
          'update-ref',
          `refs/heads/${branch}`,
          baseCommit,
          existing.branchHead ?? '',
        ],
        'prepare'
      );
      await this.git(
        path.dirname(worktreePath),
        [
          'clone',
          '--no-hardlinks',
          '--no-checkout',
          '--no-tags',
          '--single-branch',
          '--branch',
          input.defaultBranch,
          repositoryPath,
          worktreePath,
        ],
        'prepare'
      );
      await this.git(worktreePath, ['remote', 'remove', 'origin'], 'prepare');
      await this.git(
        worktreePath,
        ['checkout', '--no-track', '-b', branch, baseCommit],
        'prepare'
      );
      await this.git(
        worktreePath,
        ['reset', '--hard', '--no-recurse-submodules', baseCommit],
        'prepare'
      );
      await rm(path.join(worktreePath, '.git', 'logs'), {
        recursive: true,
        force: true,
      });
      await this.git(
        worktreePath,
        ['config', '--local', 'dao.knowledge-receipt', receiptMarker(prepared)],
        'prepare'
      );
    } catch {
      const recovered = await this.inspectPrepareState(prepared);
      if (await this.isExactPreparedState(prepared, recovered)) {
        return prepared;
      }
      this.throwPrepareStateConflict(prepared, recovered);
    }

    const created = await this.inspectPrepareState(prepared);
    if (!(await this.isExactPreparedState(prepared, created))) {
      throw new GitWorktreeError('worktree-state-changed', 'prepare');
    }
    return prepared;
  }

  async finalize(
    prepared: PreparedGitWorktree
  ): Promise<FinalizedGitWorktree> {
    return this.finalizeOrRecover(prepared);
  }

  async finalizeOrRecover(
    prepared: PreparedGitWorktree
  ): Promise<FinalizedGitWorktree> {
    const validated = await this.validateActiveReceipt(prepared, 'finalize');
    const startingHead = await this.assertCheckedOutBranch(validated);

    const status = await this.git(
      validated.worktreePath,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ],
      'finalize'
    );
    if (startingHead !== validated.baseCommit) {
      const recovered = await this.recoverFinalized(
        validated,
        startingHead,
        status.stdout
      );
      if (recovered) return recovered;
      throw new GitWorktreeError('worktree-state-changed', 'finalize');
    }
    if (status.stdout.length === 0) {
      return unchangedResult(validated);
    }

    await this.git(
      validated.worktreePath,
      ['add', '--all', '--', '.'],
      'finalize'
    );
    const staged = await this.git(
      validated.worktreePath,
      ['diff', '--cached', '--quiet', '--exit-code', '--', '.'],
      'finalize',
      [0, 1]
    );
    const unstaged = await this.git(
      validated.worktreePath,
      ['diff', '--quiet', '--exit-code', '--ignore-submodules=none', '--', '.'],
      'finalize',
      [0, 1]
    );
    if (staged.exitCode === 0 || unstaged.exitCode !== 0) {
      throw new GitWorktreeError('uncommittable-changes', 'finalize');
    }

    const tree = (
      await this.git(validated.worktreePath, ['write-tree'], 'finalize')
    ).stdout
      .toString('utf8')
      .trim();
    const commit = await this.git(
      validated.worktreePath,
      ['commit-tree', tree, '-p', validated.baseCommit, '-m', commitMessage(validated)],
      'finalize',
      [0],
      {
        GIT_AUTHOR_NAME: this.author.name,
        GIT_AUTHOR_EMAIL: this.author.email,
        GIT_COMMITTER_NAME: this.author.name,
        GIT_COMMITTER_EMAIL: this.author.email,
      }
    );
    const headCommit = commit.stdout.toString('utf8').trim().toLowerCase();
    if (!OBJECT_ID.test(headCommit)) {
      throw new GitWorktreeError('git-command-failed', 'finalize');
    }
    try {
      await this.git(
        validated.worktreePath,
        [
          'update-ref',
          `refs/heads/${validated.branch}`,
          headCommit,
          validated.baseCommit,
        ],
        'finalize'
      );
      await this.git(
        validated.repositoryPath,
        ['fetch', '--no-tags', validated.worktreePath, headCommit],
        'finalize'
      );
      await this.git(
        validated.repositoryPath,
        [
          'update-ref',
          `refs/heads/${validated.branch}`,
          headCommit,
          validated.baseCommit,
        ],
        'finalize'
      );
    } catch {
      const recovered = await this.recoverFinalized(validated);
      if (recovered) return recovered;
      throw new GitWorktreeError('worktree-state-changed', 'finalize');
    }

    const recovered = await this.recoverFinalized(validated, headCommit);
    if (!recovered) {
      throw new GitWorktreeError('worktree-state-changed', 'finalize');
    }
    return recovered;
  }

  async cleanup(prepared: PreparedGitWorktree): Promise<void> {
    return this.cleanupOrRecover(prepared);
  }

  async cleanupOrRecover(prepared: PreparedGitWorktree): Promise<void> {
    const validated = await this.validateReceiptIdentity(prepared, 'cleanup');
    const existing = await lstat(validated.worktreePath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('worktree-state-changed', 'cleanup');
      }
    );
    if (!existing) {
      return;
    }
    await this.assertSafeWorktreeDirectory(validated, 'cleanup');
    await rm(validated.worktreePath, { recursive: true, force: false });
  }

  async inspectRecoveryState(
    prepared: PreparedGitWorktree
  ): Promise<GitWorktreeRecoveryStateV1> {
    let validated: PreparedGitWorktree;
    try {
      validated = await this.validateReceiptIdentity(prepared, 'cleanup');
    } catch {
      return { schemaVersion: 1, state: 'drifted' };
    }
    const existing = await lstat(validated.worktreePath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        return false as const;
      }
    );
    if (existing === null) return { schemaVersion: 1, state: 'absent' };
    if (existing === false) return { schemaVersion: 1, state: 'drifted' };
    try {
      await this.assertSafeWorktreeDirectory(validated, 'cleanup');
      const head = await this.assertCheckedOutBranch(validated, 'cleanup');
      const status = await this.workingTreeStatus(validated, 'cleanup');
      if (head === validated.baseCommit) {
        return {
          schemaVersion: 1,
          state: status.length === 0 ? 'prepared-clean' : 'prepared-dirty',
        };
      }
      if (status.length === 0 && await this.isTrustedFinalizedCommit(validated, head)) {
        return { schemaVersion: 1, state: 'finalized-clean' };
      }
    } catch {
      // The public recovery DTO deliberately does not disclose path/ref detail.
    }
    return { schemaVersion: 1, state: 'drifted' };
  }

  async recoverSuspended(
    prepared: PreparedGitWorktree
  ): Promise<PreparedGitWorktree> {
    const validated = await this.validateActiveReceipt(prepared, 'finalize');
    const head = await this.assertCheckedOutBranch(validated, 'finalize');
    if (head !== validated.baseCommit) {
      throw new GitWorktreeError('worktree-state-changed', 'finalize');
    }
    return validated;
  }

  async discardQuarantined(prepared: PreparedGitWorktree): Promise<void> {
    await this.cleanupOrRecover(prepared);
  }

  private async changedResult(
    prepared: PreparedGitWorktree,
    headCommit: string
  ): Promise<FinalizedGitWorktree> {
    const range = [prepared.baseCommit, headCommit];
    const patch = await this.git(
      prepared.worktreePath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        ...range,
        '--',
      ],
      'finalize'
    );
    const names = await this.git(
      prepared.worktreePath,
      ['diff', '--name-only', '-z', '--no-renames', ...range, '--'],
      'finalize'
    );
    const shortStat = await this.git(
      prepared.worktreePath,
      ['diff', '--shortstat', '--no-renames', ...range, '--'],
      'finalize'
    );
    const files = splitNull(names.stdout);

    return {
      schemaVersion: GIT_WORKTREE_CONTRACT_VERSION_V1,
      spaceId: prepared.spaceId,
      jobId: prepared.jobId,
      attemptId: prepared.attemptId,
      ...(prepared.agentId === undefined
        ? {}
        : { agentId: prepared.agentId }),
      changed: true,
      baseCommit: prepared.baseCommit,
      headCommit,
      branch: prepared.branch,
      files,
      diffSummary: parseShortStat(
        shortStat.stdout.toString('utf8'),
        files.length
      ),
      patchSha256: createHash('sha256').update(patch.stdout).digest('hex'),
    };
  }

  private async recoverFinalized(
    prepared: PreparedGitWorktree,
    knownHead?: string,
    knownStatus?: Buffer
  ): Promise<FinalizedGitWorktree | null> {
    let head: string;
    try {
      head = await this.assertCheckedOutBranch(prepared);
    } catch {
      return null;
    }
    if (
      head === prepared.baseCommit ||
      (knownHead !== undefined && head !== knownHead)
    ) {
      return null;
    }

    const status = knownStatus ??
      (
        await this.git(
          prepared.worktreePath,
          [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
            '--ignore-submodules=none',
          ],
          'finalize'
        )
      ).stdout;
    if (status.length > 0) return null;

    if (!(await this.isTrustedFinalizedCommit(prepared, head))) return null;
    const result = await this.changedResult(prepared, head);
    const finalHead = await this.assertCheckedOutBranch(prepared);
    const finalStatus = await this.workingTreeStatus(prepared, 'finalize');
    if (finalHead !== head || finalStatus.length > 0) return null;
    try {
      await this.commitAt(prepared.repositoryPath, head, 'finalize');
    } catch {
      await this.git(
        prepared.repositoryPath,
        ['fetch', '--no-tags', prepared.worktreePath, head],
        'finalize'
      );
    }
    let proposalHead: string;
    try {
      proposalHead = await this.commitAt(
        prepared.repositoryPath,
        `refs/heads/${prepared.branch}`,
        'finalize'
      );
    } catch {
      return null;
    }
    if (proposalHead === prepared.baseCommit) {
      await this.git(
        prepared.repositoryPath,
        ['update-ref', `refs/heads/${prepared.branch}`, head, prepared.baseCommit],
        'finalize'
      );
    } else if (proposalHead !== head) {
      return null;
    }
    if (
      await this.commitAt(
        prepared.repositoryPath,
        `refs/heads/${prepared.branch}`,
        'finalize'
      ) !== head
    ) {
      return null;
    }
    return result;
  }

  private async isTrustedFinalizedCommit(
    prepared: PreparedGitWorktree,
    head: string
  ): Promise<boolean> {
    const metadata = await this.git(
      prepared.worktreePath,
      [
        'show',
        '-s',
        '--format=%an%x00%ae%x00%cn%x00%ce%x00%P%x00%B',
        head,
      ],
      'finalize'
    );
    const [
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      parents,
      ...messageParts
    ] = metadata.stdout.toString('utf8').split('\0');
    const message = messageParts.join('\0').trimEnd();
    return !(
      authorName !== this.author.name ||
      authorEmail !== this.author.email ||
      committerName !== this.author.name ||
      committerEmail !== this.author.email ||
      parents.trim() !== prepared.baseCommit ||
      message !== commitMessage(prepared)
    );
  }

  private async inspectPrepareState(
    prepared: PreparedGitWorktree
  ): Promise<RuntimeWorktreeState> {
    const existing = await lstat(prepared.worktreePath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('worktree-state-changed', 'prepare');
      }
    );
    const branch = await this.git(
      prepared.repositoryPath,
      ['show-ref', '--verify', '--quiet', `refs/heads/${prepared.branch}`],
      'prepare',
      [0, 1]
    );
    return {
      pathExists: existing !== null,
      branchHead:
        branch.exitCode === 0
          ? await this.commitAt(
              prepared.repositoryPath,
              `refs/heads/${prepared.branch}`,
              'prepare'
            )
          : undefined,
    };
  }

  private async isExactPreparedState(
    prepared: PreparedGitWorktree,
    state: RuntimeWorktreeState
  ): Promise<boolean> {
    if (
      !state.pathExists ||
      state.branchHead !== prepared.baseCommit
    ) {
      return false;
    }
    try {
      await this.assertSafeWorktreeDirectory(prepared, 'prepare');
      const head = await this.assertCheckedOutBranch(prepared, 'prepare');
      const status = await this.git(
        prepared.worktreePath,
        [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--ignore-submodules=none',
        ],
        'prepare'
      );
      return head === prepared.baseCommit && status.stdout.length === 0;
    } catch {
      return false;
    }
  }

  private assertPrepareStateAvailable(
    prepared: PreparedGitWorktree,
    state: RuntimeWorktreeState,
    allowBranchOnlyRecovery: boolean
  ): void {
    if (
      !state.pathExists &&
      (state.branchHead === undefined ||
        (allowBranchOnlyRecovery &&
          state.branchHead === prepared.baseCommit))
    ) {
      return;
    }
    this.throwPrepareStateConflict(prepared, state);
  }

  private throwPrepareStateConflict(
    prepared: PreparedGitWorktree,
    state: RuntimeWorktreeState
  ): never {
    if (
      state.branchHead !== undefined
    ) {
      throw new GitWorktreeError('branch-already-exists', 'prepare');
    }
    if (
      state.pathExists
    ) {
      throw new GitWorktreeError('worktree-path-conflict', 'prepare');
    }
    throw new GitWorktreeError('worktree-state-changed', 'prepare');
  }

  private async validateReceiptIdentity(
    prepared: PreparedGitWorktree,
    operation: 'finalize' | 'cleanup'
  ): Promise<PreparedGitWorktree> {
    try {
      assertPrepareInput({
        spaceId: prepared.spaceId,
        mountPath: prepared.mountPath,
        repoPath: prepared.repositoryPath,
        defaultBranch: prepared.defaultBranch,
        jobId: prepared.jobId,
        attemptId: prepared.attemptId,
        attemptNumber: prepared.attemptNumber,
        ...(prepared.agentId === undefined
          ? {}
          : { agentId: prepared.agentId }),
        baseCommit: prepared.baseCommit,
      });
    } catch {
      throw new GitWorktreeError('invalid-receipt', operation);
    }
    if (
      prepared.schemaVersion !== GIT_WORKTREE_CONTRACT_VERSION_V1 ||
      !OBJECT_ID.test(prepared.baseCommit)
    ) {
      throw new GitWorktreeError('invalid-receipt', operation);
    }

    const root = await this.managedRoot(operation);
    const repositoryPath = await this.repositoryRoot(
      prepared.repositoryPath,
      operation
    );
    try {
      await this.assertDefaultBranch(
        repositoryPath,
        prepared.defaultBranch,
        operation
      );
      const baseCommit = await this.commitAt(
        repositoryPath,
        prepared.baseCommit,
        operation
      );
      const reachable = await this.git(
        repositoryPath,
        [
          'merge-base',
          '--is-ancestor',
          baseCommit,
          `refs/heads/${prepared.defaultBranch}`,
        ],
        operation,
        [0, 1]
      );
      if (baseCommit !== prepared.baseCommit || reachable.exitCode !== 0) {
        throw new Error('invalid base');
      }
    } catch {
      throw new GitWorktreeError('invalid-receipt', operation);
    }
    const input = {
      ...prepared,
      repoPath: repositoryPath,
    };
    const expectedPath = buildWorktreePath(root, repositoryPath, input);
    if (
      prepared.repositoryPath !== repositoryPath ||
      prepared.branch !== buildBranch(input) ||
      prepared.worktreePath !== expectedPath ||
      repositoryPath === root ||
      isStrictDescendant(root, repositoryPath) ||
      isStrictDescendant(repositoryPath, root)
    ) {
      throw new GitWorktreeError('invalid-receipt', operation);
    }
    return { ...prepared, repositoryPath, worktreePath: expectedPath };
  }

  private async validateActiveReceipt(
    prepared: PreparedGitWorktree,
    operation: 'finalize' | 'cleanup'
  ): Promise<PreparedGitWorktree> {
    const validated = await this.validateReceiptIdentity(prepared, operation);
    const existing = await lstat(validated.worktreePath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('worktree-state-changed', operation);
      }
    );
    if (!existing) {
      throw new GitWorktreeError('worktree-not-registered', operation);
    }

    await this.assertSafeWorktreeDirectory(validated, operation);
    return validated;
  }

  private async assertSafeWorktreeDirectory(
    prepared: PreparedGitWorktree,
    operation: 'prepare' | 'finalize' | 'cleanup'
  ): Promise<void> {
    const root = await this.managedRoot(operation);
    const physicalPath = await safeRealpath(prepared.worktreePath, operation);
    if (
      physicalPath !== prepared.worktreePath ||
      !isStrictDescendant(root, physicalPath)
    ) {
      throw new GitWorktreeError('unsafe-worktree-path', operation);
    }
    const worktreeRoot = await this.repositoryRoot(physicalPath, operation);
    if (worktreeRoot !== physicalPath) {
      throw new GitWorktreeError('unsafe-worktree-path', operation);
    }

    const expectedGitDirectory = path.join(physicalPath, '.git');
    const gitDirectory = path.resolve(
      (
        await this.git(
          physicalPath,
          ['rev-parse', '--absolute-git-dir'],
          operation
        )
      ).stdout.toString('utf8').trim()
    );
    const commonDirectoryValue = (
      await this.git(physicalPath, ['rev-parse', '--git-common-dir'], operation)
    ).stdout.toString('utf8').trim();
    const commonDirectory = path.resolve(physicalPath, commonDirectoryValue);
    const gitDirectoryInfo = await lstat(expectedGitDirectory).catch(() => null);
    if (
      gitDirectory !== expectedGitDirectory ||
      commonDirectory !== expectedGitDirectory ||
      !gitDirectoryInfo?.isDirectory() ||
      gitDirectoryInfo.isSymbolicLink()
    ) {
      throw new GitWorktreeError('unsafe-worktree-path', operation);
    }

    const remotes = await this.git(physicalPath, ['remote'], operation);
    const alternatesPath = path.join(
      expectedGitDirectory,
      'objects',
      'info',
      'alternates'
    );
    const alternates = await lstat(alternatesPath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('unsafe-worktree-path', operation);
      }
    );
    if (remotes.stdout.length > 0 || alternates !== null) {
      throw new GitWorktreeError('unsafe-worktree-path', operation);
    }

    const marker = await this.git(
      physicalPath,
      ['config', '--local', '--get', 'dao.knowledge-receipt'],
      operation,
      [0, 1]
    );
    if (
      marker.exitCode !== 0 ||
      marker.stdout.toString('utf8').trim() !== receiptMarker(prepared)
    ) {
      throw new GitWorktreeError('worktree-not-registered', operation);
    }
  }

  private async workingTreeStatus(
    prepared: PreparedGitWorktree,
    operation: 'prepare' | 'finalize' | 'cleanup'
  ): Promise<Buffer> {
    return (
      await this.git(
        prepared.worktreePath,
        [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--ignore-submodules=none',
        ],
        operation
      )
    ).stdout;
  }

  private async assertCheckedOutBranch(
    prepared: PreparedGitWorktree,
    operation: 'prepare' | 'finalize' | 'cleanup' = 'finalize'
  ): Promise<string> {
    const branch = await this.git(
      prepared.worktreePath,
      ['symbolic-ref', '--quiet', 'HEAD'],
      operation,
      [0, 1]
    );
    let head: string;
    try {
      head = await this.commitAt(prepared.worktreePath, 'HEAD', operation);
    } catch {
      throw new GitWorktreeError('worktree-state-changed', operation);
    }
    if (
      branch.exitCode !== 0 ||
      branch.stdout.toString('utf8').trim() !== `refs/heads/${prepared.branch}`
    ) {
      throw new GitWorktreeError('worktree-state-changed', operation);
    }
    return head;
  }

  private async resolveBaseCommit(
    repositoryPath: string,
    input: GitWorktreePrepareInput
  ): Promise<string> {
    const revision = input.baseCommit ?? `refs/heads/${input.defaultBranch}`;
    if (input.baseCommit && !OBJECT_ID.test(input.baseCommit.toLowerCase())) {
      throw new GitWorktreeError('invalid-base-commit', 'prepare');
    }
    let commit: string;
    try {
      commit = await this.commitAt(repositoryPath, revision, 'prepare');
    } catch {
      throw new GitWorktreeError('invalid-base-commit', 'prepare');
    }
    const reachable = await this.git(
      repositoryPath,
      [
        'merge-base',
        '--is-ancestor',
        commit,
        `refs/heads/${input.defaultBranch}`,
      ],
      'prepare',
      [0, 1]
    );
    if (reachable.exitCode !== 0) {
      throw new GitWorktreeError('invalid-base-commit', 'prepare');
    }
    return commit;
  }

  private async managedRoot(
    operation: 'prepare' | 'finalize' | 'cleanup'
  ): Promise<string> {
    await mkdir(this.configuredRoot, { recursive: true, mode: 0o700 });
    const root = await safeRealpath(this.configuredRoot, operation);
    if (root === path.parse(root).root) {
      throw new GitWorktreeError('unsafe-worktree-path', operation);
    }
    return root;
  }

  private async assertNewWorktreePath(
    root: string,
    worktreePath: string
  ): Promise<void> {
    if (!isStrictDescendant(root, worktreePath)) {
      throw new GitWorktreeError('unsafe-worktree-path', 'prepare');
    }
    const parent = path.dirname(worktreePath);
    await ensureSafeDirectoryChain(root, parent);
    const existing = await lstat(worktreePath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('worktree-path-conflict', 'prepare');
      }
    );
    if (existing) {
      throw new GitWorktreeError('worktree-path-conflict', 'prepare');
    }
  }

}

export {
  LocalGitKnowledgeBaseResolver as LocalGitKnowledgeBaseResolverV1,
  LocalGitWorktreePort as LocalGitWorktreePortV1,
};

function assertPrepareInput(input: GitWorktreePrepareInput): void {
  if (
    !SAFE_ID.test(input.spaceId) ||
    input.mountPath !== '/' ||
    !SAFE_ID.test(input.jobId) ||
    !SAFE_ID.test(input.attemptId) ||
    input.agentId !== undefined && !SAFE_ID.test(input.agentId) ||
    !path.isAbsolute(input.repoPath) ||
    /[\r\n\0]/.test(input.repoPath) ||
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    typeof input.defaultBranch !== 'string' ||
    input.defaultBranch.length === 0 ||
    input.defaultBranch.length > 240 ||
    /[\u0000-\u0020\u007f]/.test(input.defaultBranch)
  ) {
    throw new GitWorktreeError('invalid-input', 'prepare');
  }
}

function assertBaseResolveInput(input: GitKnowledgeBaseResolveInput): void {
  if (
    !path.isAbsolute(input.repoPath) ||
    /[\r\n\0]/.test(input.repoPath) ||
    typeof input.defaultBranch !== 'string' ||
    input.defaultBranch.length === 0 ||
    input.defaultBranch.length > 240 ||
    /[\u0000-\u0020\u007f]/.test(input.defaultBranch)
  ) {
    throw new GitWorktreeError('invalid-input', 'resolve-base');
  }
}

function assertDefaultBranchName(defaultBranch: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(defaultBranch) ||
    defaultBranch.includes('..') ||
    defaultBranch.includes('//') ||
    defaultBranch.includes('@{') ||
    defaultBranch.endsWith('.') ||
    defaultBranch.endsWith('/')
  ) {
    throw new Error('unsafe ref');
  }
}

function buildBranch(input: GitWorktreePrepareInput): string {
  return `agent/${sanitizeAgent(input.agentId)}/job/${sanitizeRefComponent(
    input.jobId,
    'job'
  )}/attempt/${input.attemptNumber}-${digest(input.attemptId, 10)}`;
}

function buildWorktreePath(
  root: string,
  repositoryPath: string,
  input: GitWorktreePrepareInput
): string {
  return path.join(
    root,
    `space-${fileComponent(input.spaceId)}-${digest(repositoryPath, 10)}`,
    `agent-${sanitizeAgent(input.agentId)}`,
    `job-${fileComponent(input.jobId)}`,
    `attempt-${input.attemptNumber}-${digest(input.attemptId, 10)}`
  );
}

function sanitizeAgent(agentId: string | undefined): string {
  return sanitizeRefComponent(agentId ?? 'unassigned', 'agent');
}

function sanitizeRefComponent(source: string, fallback: string): string {
  let slug = source
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 48);
  if (slug.toLowerCase().endsWith('.lock')) {
    slug = `${slug.slice(0, -5)}-lock`;
  }
  slug ||= fallback;
  return slug === source ? slug : `${slug}-${digest(source, 10)}`;
}

function fileComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
}

function digest(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function receiptMarker(prepared: PreparedGitWorktree): string {
  const identity = [
    String(prepared.schemaVersion),
    prepared.spaceId,
    prepared.mountPath,
    prepared.repositoryPath,
    prepared.worktreePath,
    prepared.defaultBranch,
    prepared.branch,
    prepared.baseCommit,
    prepared.jobId,
    prepared.attemptId,
    String(prepared.attemptNumber),
    prepared.agentId ?? '',
  ].join('\0');
  return `knowledge-workspace-v1:${createHash('sha256')
    .update(identity)
    .digest('hex')}`;
}

function commitMessage(prepared: PreparedGitWorktree): string {
  return [
    `Knowledge change for job ${prepared.jobId}`,
    '',
    `Job-Id: ${prepared.jobId}`,
    `Attempt-Id: ${prepared.attemptId}`,
    `Agent-Id: ${prepared.agentId ?? 'unassigned'}`,
  ].join('\n');
}

function unchangedResult(
  prepared: PreparedGitWorktree
): FinalizedGitWorktree {
  return {
    schemaVersion: GIT_WORKTREE_CONTRACT_VERSION_V1,
    spaceId: prepared.spaceId,
    jobId: prepared.jobId,
    attemptId: prepared.attemptId,
    ...(prepared.agentId === undefined
      ? {}
      : { agentId: prepared.agentId }),
    changed: false,
    baseCommit: prepared.baseCommit,
    headCommit: prepared.baseCommit,
    branch: prepared.branch,
    files: [],
    diffSummary: { filesChanged: 0, insertions: 0, deletions: 0, shortStat: '' },
    patchSha256: EMPTY_PATCH_SHA256,
  };
}

function parseShortStat(
  value: string,
  filesChanged: number
): GitWorktreeDiffSummary {
  const shortStat = value.trim();
  const insertions = Number(
    shortStat.match(/(\d+) insertion(?:s)?\(\+\)/)?.[1] ?? 0
  );
  const deletions = Number(
    shortStat.match(/(\d+) deletion(?:s)?\(-\)/)?.[1] ?? 0
  );
  return { filesChanged, insertions, deletions, shortStat };
}

function splitNull(value: Buffer): string[] {
  return value
    .toString('utf8')
    .split('\0')
    .filter((item) => item.length > 0);
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(
    relative &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
  );
}

async function ensureSafeDirectoryChain(
  root: string,
  directory: string
): Promise<void> {
  const relative = path.relative(root, directory);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new GitWorktreeError('unsafe-worktree-path', 'prepare');
  }

  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const existing = await lstat(current).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw new GitWorktreeError('unsafe-worktree-path', 'prepare');
      }
    );
    if (!existing) {
      await mkdir(current, { mode: 0o700 });
    } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new GitWorktreeError('unsafe-worktree-path', 'prepare');
    }
    if ((await safeRealpath(current, 'prepare')) !== current) {
      throw new GitWorktreeError('unsafe-worktree-path', 'prepare');
    }
  }
}

function safeRealpath(
  candidate: string,
  operation: Exclude<GitWorktreeOperation, 'configuration'>,
  code: GitWorktreeErrorCode = 'unsafe-worktree-path'
): Promise<string> {
  return realpath(candidate).catch(() => {
    throw new GitWorktreeError(code, operation);
  });
}

function safeEnvironment(
  additions: Readonly<Record<string, string>>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of [
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SystemRoot',
    'WINDIR',
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    LC_ALL: 'C',
    LANG: 'C',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    ...additions,
  };
}

function numericExitCode(error: Error | null): number {
  if (!error) return 0;
  const code = (error as Error & { code?: number | string }).code;
  return typeof code === 'number' ? code : -1;
}

function isSafeAuthor(author: GitWorktreeCommitAuthorV1): boolean {
  return Boolean(
    author.name.trim() &&
      author.email.trim() &&
      author.name.length <= 200 &&
      author.email.length <= 320 &&
      !/[\r\n\0<>]/.test(author.name) &&
      !/[\r\n\0<>]/.test(author.email) &&
      /^[^@\s]+@[^@\s]+$/.test(author.email)
  );
}
