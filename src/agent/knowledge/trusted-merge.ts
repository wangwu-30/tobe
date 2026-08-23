import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { devNull } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEFAULT_MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const COMMON_GIT_ARGS = [
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'core.fsmonitor=false',
  '-c',
  'credential.helper=',
  '-c',
  'diff.external=',
] as const;

export type TrustedKnowledgeGitErrorCode =
  | 'invalid-input'
  | 'invalid-repository'
  | 'proposal-ref-changed'
  | 'default-ref-changed'
  | 'invalid-commit-range'
  | 'patch-hash-mismatch'
  | 'git-command-failed';

export class TrustedKnowledgeGitError extends Error {
  readonly conflict: boolean;

  constructor(
    readonly code: TrustedKnowledgeGitErrorCode,
    options: { cause?: unknown; conflict?: boolean } = {}
  ) {
    super(`Trusted knowledge Git operation failed (${code}).`,
      options.cause ? { cause: options.cause } : undefined);
    this.name = 'TrustedKnowledgeGitError';
    this.conflict = options.conflict ?? [
      'proposal-ref-changed',
      'default-ref-changed',
      'invalid-commit-range',
      'patch-hash-mismatch',
    ].includes(code);
  }
}

export type TrustedKnowledgeMergeInputV1 = {
  repositoryPath: string;
  defaultBranch: string;
  proposalBranch: string;
  baseCommit: string;
  headCommit: string;
  expectedPatchSha256?: string | null;
};

export type TrustedKnowledgeDiffV1 = {
  schemaVersion: 1;
  baseCommit: string;
  headCommit: string;
  patch: string;
  patchSha256: string;
};

export type TrustedKnowledgeMergeResultV1 = {
  schemaVersion: 1;
  mergedCommit: string;
  replayed: boolean;
};

export interface TrustedKnowledgeGitPortV1 {
  readDiff(input: TrustedKnowledgeMergeInputV1): Promise<TrustedKnowledgeDiffV1>;
  merge(input: TrustedKnowledgeMergeInputV1): Promise<TrustedKnowledgeMergeResultV1>;
}

export type LocalTrustedKnowledgeGitPortConfigV1 = {
  gitBinary?: string;
  maxGitOutputBytes?: number;
};

/**
 * Privileged local-only Git adapter. All paths and refs must originate from
 * trusted KnowledgeSpace/ChangeRequest rows; callers must never pass model or
 * runtime-provided repository paths to this port.
 */
export class LocalTrustedKnowledgeGitPortV1
  implements TrustedKnowledgeGitPortV1
{
  private readonly gitBinary: string;
  private readonly maxGitOutputBytes: number;

  constructor(config: LocalTrustedKnowledgeGitPortConfigV1 = {}) {
    if (
      (config.gitBinary !== undefined && !config.gitBinary.trim()) ||
      (config.maxGitOutputBytes !== undefined &&
        (!Number.isSafeInteger(config.maxGitOutputBytes) ||
          config.maxGitOutputBytes < 1))
    ) {
      throw new TrustedKnowledgeGitError('invalid-input');
    }
    this.gitBinary = config.gitBinary ?? 'git';
    this.maxGitOutputBytes =
      config.maxGitOutputBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES;
  }

  async readDiff(
    input: TrustedKnowledgeMergeInputV1
  ): Promise<TrustedKnowledgeDiffV1> {
    const validated = await this.validate(input);
    return {
      schemaVersion: 1,
      baseCommit: validated.baseCommit,
      headCommit: validated.headCommit,
      patch: validated.patch.toString('utf8'),
      patchSha256: validated.patchSha256,
    };
  }

  async merge(
    input: TrustedKnowledgeMergeInputV1
  ): Promise<TrustedKnowledgeMergeResultV1> {
    const validated = await this.validate(input);
    const defaultRef = `refs/heads/${input.defaultBranch}`;
    const current = await this.commitAt(validated.repositoryPath, defaultRef);
    if (current === validated.headCommit) {
      return { schemaVersion: 1, mergedCommit: current, replayed: true };
    }
    if (current !== validated.baseCommit) {
      throw new TrustedKnowledgeGitError('default-ref-changed', { conflict: true });
    }

    try {
      await this.git(validated.repositoryPath, [
        'update-ref',
        defaultRef,
        validated.headCommit,
        validated.baseCommit,
      ]);
      return {
        schemaVersion: 1,
        mergedCommit: validated.headCommit,
        replayed: false,
      };
    } catch (error) {
      const racedHead = await this.commitAt(validated.repositoryPath, defaultRef)
        .catch(() => null);
      if (racedHead === validated.headCommit) {
        return {
          schemaVersion: 1,
          mergedCommit: validated.headCommit,
          replayed: true,
        };
      }
      throw new TrustedKnowledgeGitError('default-ref-changed', {
        cause: error,
        conflict: true,
      });
    }
  }

  private async validate(input: TrustedKnowledgeMergeInputV1) {
    assertMergeInput(input);
    const repositoryPath = await this.repositoryRoot(input.repositoryPath);
    await this.checkRef(repositoryPath, input.defaultBranch);
    await this.checkRef(repositoryPath, input.proposalBranch);

    const baseCommit = await this.commitAt(repositoryPath, input.baseCommit);
    const headCommit = await this.commitAt(repositoryPath, input.headCommit);
    if (baseCommit !== input.baseCommit || headCommit !== input.headCommit) {
      throw new TrustedKnowledgeGitError('invalid-input');
    }
    const proposalHead = await this.commitAt(
      repositoryPath,
      `refs/heads/${input.proposalBranch}`
    );
    if (proposalHead !== headCommit) {
      throw new TrustedKnowledgeGitError('proposal-ref-changed', { conflict: true });
    }
    const ancestor = await this.git(repositoryPath, [
      'merge-base',
      '--is-ancestor',
      baseCommit,
      headCommit,
    ], [0, 1]);
    if (ancestor.exitCode !== 0) {
      throw new TrustedKnowledgeGitError('invalid-commit-range', { conflict: true });
    }

    const patch = (await this.git(repositoryPath, canonicalDiffArgs(baseCommit, headCommit))).stdout;
    const patchSha256 = createHash('sha256').update(patch).digest('hex');
    if (
      input.expectedPatchSha256 &&
      patchSha256 !== input.expectedPatchSha256.toLowerCase()
    ) {
      throw new TrustedKnowledgeGitError('patch-hash-mismatch', { conflict: true });
    }
    return { repositoryPath, baseCommit, headCommit, patch, patchSha256 };
  }

  private async repositoryRoot(candidate: string): Promise<string> {
    let physical: string;
    try {
      physical = await realpath(candidate);
      if (!(await stat(physical)).isDirectory()) throw new Error('not-directory');
    } catch (error) {
      throw new TrustedKnowledgeGitError('invalid-repository', { cause: error });
    }
    try {
      const top = (await this.git(physical, ['rev-parse', '--show-toplevel']))
        .stdout.toString('utf8').trim();
      if (path.resolve(top) !== physical) {
        throw new TrustedKnowledgeGitError('invalid-repository');
      }
    } catch (error) {
      if (error instanceof TrustedKnowledgeGitError) throw error;
      throw new TrustedKnowledgeGitError('invalid-repository', { cause: error });
    }
    return physical;
  }

  private async checkRef(repositoryPath: string, branch: string): Promise<void> {
    try {
      await this.git(repositoryPath, [
        'check-ref-format',
        `refs/heads/${branch}`,
      ]);
    } catch (error) {
      throw new TrustedKnowledgeGitError('invalid-input', { cause: error });
    }
  }

  private async commitAt(repositoryPath: string, revision: string): Promise<string> {
    try {
      const value = (await this.git(repositoryPath, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${revision}^{commit}`,
      ])).stdout.toString('utf8').trim().toLowerCase();
      if (!OBJECT_ID.test(value)) throw new Error('invalid-object-id');
      return value;
    } catch (error) {
      if (error instanceof TrustedKnowledgeGitError) throw error;
      throw new TrustedKnowledgeGitError('git-command-failed', { cause: error });
    }
  }

  private async git(
    cwd: string,
    args: readonly string[],
    allowedExitCodes: readonly number[] = [0]
  ): Promise<{ stdout: Buffer; exitCode: number }> {
    try {
      const result = await execFileAsync(
        this.gitBinary,
        [...COMMON_GIT_ARGS, '-C', cwd, ...args],
        {
          encoding: 'buffer',
          maxBuffer: this.maxGitOutputBytes,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            TMP: process.env.TMP,
            TEMP: process.env.TEMP,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: devNull,
            GIT_NO_REPLACE_OBJECTS: '1',
            GIT_TERMINAL_PROMPT: '0',
            GIT_PAGER: 'cat',
            LC_ALL: 'C',
            LANG: 'C',
          },
        }
      );
      return { stdout: result.stdout, exitCode: 0 };
    } catch (error) {
      const exitCode = readExitCode(error);
      if (allowedExitCodes.includes(exitCode)) {
        return { stdout: readStdout(error), exitCode };
      }
      throw new TrustedKnowledgeGitError('git-command-failed', { cause: error });
    }
  }
}

function canonicalDiffArgs(baseCommit: string, headCommit: string): string[] {
  return [
    'diff',
    '--binary',
    '--full-index',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    baseCommit,
    headCommit,
    '--',
  ];
}

function assertMergeInput(input: TrustedKnowledgeMergeInputV1): void {
  if (
    !path.isAbsolute(input.repositoryPath) ||
    /[\r\n\0]/.test(input.repositoryPath) ||
    !validBranch(input.defaultBranch) ||
    !validBranch(input.proposalBranch) ||
    !OBJECT_ID.test(input.baseCommit) ||
    !OBJECT_ID.test(input.headCommit) ||
    input.baseCommit === input.headCommit ||
    (input.expectedPatchSha256 !== undefined &&
      input.expectedPatchSha256 !== null &&
      !/^[0-9a-f]{64}$/i.test(input.expectedPatchSha256))
  ) {
    throw new TrustedKnowledgeGitError('invalid-input');
  }
}

function validBranch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !/[\u0000-\u0020\u007f]/.test(value) &&
    !value.startsWith('-')
  );
}

function readExitCode(error: unknown): number {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'number'
    ? error.code
    : -1;
}

function readStdout(error: unknown): Buffer {
  if (typeof error !== 'object' || error === null || !('stdout' in error)) {
    return Buffer.alloc(0);
  }
  const stdout = error.stdout;
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''));
}
