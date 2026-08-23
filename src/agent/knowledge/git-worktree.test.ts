import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  access,
  mkdir,
  mkdtemp,
  rename,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import type { GitWorktreePrepareInput } from './contracts';
import {
  GitWorktreeError,
  LocalGitKnowledgeBaseResolver,
  LocalGitWorktreePort,
} from './git-worktree';

const execFileAsync = promisify(execFile);
const AUTHOR = {
  name: 'Knowledge Commit Service',
  email: 'knowledge-commits@example.test',
};
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const temporaryRoots = new Set<string>();

type Fixture = {
  root: string;
  repoPath: string;
  managedRoot: string;
  port: LocalGitWorktreePort;
  baseCommit: string;
};

test.afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});
test('prepare isolates attempts and leaves a dirty default checkout untouched', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.repoPath, 'local-only.txt'), 'do not stage\n');
  const before = await defaultCheckoutSnapshot(fixture.repoPath);

  const first = await fixture.port.prepare(
    prepareInput(fixture, {
      jobId: 'Job:@One',
      attemptId: 'attempt-one',
      attemptNumber: 1,
      agentId: '@Research:Agent',
    })
  );
  const second = await fixture.port.prepare(
    prepareInput(fixture, {
      jobId: 'Job:@One',
      attemptId: 'attempt-two',
      attemptNumber: 2,
      agentId: '@Research:Agent',
    })
  );

  expect(first.branch).toMatch(
    new RegExp(
      '^agent/[a-z0-9._-]+/job/[a-z0-9._-]+/attempt/1-[0-9a-f]{10}$'
    )
  );
  expect(second.branch).toMatch(new RegExp('/attempt/2-[0-9a-f]{10}$'));
  expect(first.branch).not.toBe(second.branch);
  expect(first.mountPath).toBe('/');
  expect(first.worktreePath).not.toBe(second.worktreePath);
  const relativeWorktreePath = path.relative(
    fixture.managedRoot,
    first.worktreePath
  );
  expect(relativeWorktreePath.startsWith('..')).toBe(false);
  expect(path.isAbsolute(relativeWorktreePath)).toBe(false);
  expect(await defaultCheckoutSnapshot(fixture.repoPath)).toEqual(before);

  await fixture.port.cleanup(first);
  await fixture.port.cleanup(second);
});

test('omits optional agent identity for team-shared worktree receipts', async () => {
  const fixture = await createFixture();
  const changedPrepared = await fixture.port.prepare(
    prepareInput(fixture, {
      attemptId: 'team-changed',
      attemptNumber: 1,
      agentId: undefined,
    })
  );
  expect(changedPrepared).not.toHaveProperty('agentId');

  await writeFile(
    path.join(changedPrepared.worktreePath, 'team-change.txt'),
    'team knowledge\n'
  );
  const changed = await fixture.port.finalize(changedPrepared);
  expect(changed.changed).toBe(true);
  expect(changed).not.toHaveProperty('agentId');
  await fixture.port.cleanup(changedPrepared);

  const unchangedPrepared = await fixture.port.prepare(
    prepareInput(fixture, {
      attemptId: 'team-unchanged',
      attemptNumber: 2,
      agentId: undefined,
    })
  );
  expect(unchangedPrepared).not.toHaveProperty('agentId');
  const unchanged = await fixture.port.finalize(unchangedPrepared);
  expect(unchanged.changed).toBe(false);
  expect(unchanged).not.toHaveProperty('agentId');
  await fixture.port.cleanup(unchangedPrepared);
});

test('finalize reports no change without creating a commit', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));

  const result = await fixture.port.finalize(prepared);

  expect(result).toEqual({
    schemaVersion: 1,
    spaceId: 'space-one',
    jobId: 'job-one',
    attemptId: 'attempt-one',
    agentId: 'agent-one',
    changed: false,
    baseCommit: fixture.baseCommit,
    headCommit: fixture.baseCommit,
    branch: prepared.branch,
    files: [],
    diffSummary: {
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      shortStat: '',
    },
    patchSha256: EMPTY_SHA256,
  });
  expect(await gitText(prepared.worktreePath, ['rev-parse', 'HEAD'])).toBe(
    fixture.baseCommit
  );

  await fixture.port.cleanup(prepared);
});

test('finalize commits all attempt changes with trusted author and trailers', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await appendFile(path.join(prepared.worktreePath, 'README.md'), 'changed\n');
  await mkdir(path.join(prepared.worktreePath, 'notes'));
  await writeFile(path.join(prepared.worktreePath, 'notes', 'new note.txt'), 'new\n');

  const result = await fixture.port.finalize(prepared);
  const patch = await gitBuffer(prepared.worktreePath, [
    'diff',
    '--binary',
    '--full-index',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    result.baseCommit,
    result.headCommit,
    '--',
  ]);
  const commit = await gitBuffer(prepared.worktreePath, [
    'show',
    '-s',
    '--format=%an%x00%ae%x00%cn%x00%ce%x00%B',
    'HEAD',
  ]);
  const [authorName, authorEmail, committerName, committerEmail, message] = commit
    .toString('utf8')
    .split('\0');

  expect(result.changed).toBe(true);
  expect(result.baseCommit).toBe(fixture.baseCommit);
  expect(result.headCommit).not.toBe(fixture.baseCommit);
  expect(new Set(result.files)).toEqual(
    new Set(['README.md', 'notes/new note.txt'])
  );
  expect(result.diffSummary).toMatchObject({
    filesChanged: 2,
    insertions: 2,
    deletions: 0,
  });
  expect(result.patchSha256).toBe(
    createHash('sha256').update(patch).digest('hex')
  );
  expect([authorName, authorEmail, committerName, committerEmail]).toEqual([
    AUTHOR.name,
    AUTHOR.email,
    AUTHOR.name,
    AUTHOR.email,
  ]);
  expect(message).toContain('Job-Id: job-one');
  expect(message).toContain('Attempt-Id: attempt-one');
  expect(message).toContain('Agent-Id: agent-one');
  expect(await gitText(prepared.worktreePath, ['status', '--porcelain'])).toBe('');
  expect(await gitText(fixture.repoPath, ['rev-parse', 'refs/heads/main'])).toBe(
    fixture.baseCommit
  );

  await fixture.port.cleanup(prepared);
});

test('trusted base resolver returns the full default branch commit without a worktree', async () => {
  const fixture = await createFixture();
  const resolver = new LocalGitKnowledgeBaseResolver();
  await mkdir(path.join(fixture.repoPath, 'nested'));

  await expect(
    resolver.resolve({ repoPath: fixture.repoPath, defaultBranch: 'main' })
  ).resolves.toBe(fixture.baseCommit);
  expect(
    await gitText(fixture.repoPath, ['worktree', 'list', '--porcelain'])
  ).not.toContain(fixture.managedRoot);

  await expect(
    resolver.resolve({
      repoPath: path.join(fixture.repoPath, 'nested'),
      defaultBranch: 'main',
    })
  ).rejects.toMatchObject({ code: 'invalid-repository' });
  await expect(
    resolver.resolve({
      repoPath: fixture.repoPath,
      defaultBranch: '--upload-pack=evil',
    })
  ).rejects.toMatchObject({ code: 'invalid-input' });
});

test('explicit baseCommit must exist and be reachable from the default branch', async () => {
  const fixture = await createFixture();
  const firstCommit = fixture.baseCommit;
  await writeFile(path.join(fixture.repoPath, 'second.txt'), 'second\n');
  await commitAll(fixture.repoPath, 'second');
  const defaultHead = await gitText(fixture.repoPath, ['rev-parse', 'HEAD']);

  const fromFirst = await fixture.port.prepare(
    prepareInput(fixture, {
      attemptId: 'from-first',
      attemptNumber: 2,
      baseCommit: firstCommit,
    })
  );
  expect(await gitText(fromFirst.worktreePath, ['rev-parse', 'HEAD'])).toBe(
    firstCommit
  );
  expect(await gitText(fixture.repoPath, ['rev-parse', 'HEAD'])).toBe(defaultHead);
  await fixture.port.cleanup(fromFirst);

  await git(fixture.repoPath, ['checkout', '--orphan', 'unrelated']);
  await git(fixture.repoPath, ['rm', '-rf', '--ignore-unmatch', '.']);
  await writeFile(path.join(fixture.repoPath, 'unrelated.txt'), 'unrelated\n');
  await commitAll(fixture.repoPath, 'unrelated');
  const unrelated = await gitText(fixture.repoPath, ['rev-parse', 'HEAD']);
  await git(fixture.repoPath, ['checkout', 'main']);

  await expect(
    fixture.port.prepare(
      prepareInput(fixture, {
        attemptId: 'unrelated-attempt',
        attemptNumber: 3,
        baseCommit: unrelated,
      })
    )
  ).rejects.toMatchObject({ code: 'invalid-base-commit' });
  await expect(
    fixture.port.prepare(
      prepareInput(fixture, {
        attemptId: 'short-hash',
        attemptNumber: 4,
        baseCommit: firstCommit.slice(0, 12),
      })
    )
  ).rejects.toMatchObject({ code: 'invalid-base-commit' });
});

test('prepareOrRecover exact replay returns the same isolated clone receipt', async () => {
  const fixture = await createFixture();
  const input = prepareInput(fixture);
  const first = await fixture.port.prepareOrRecover(input);

  await expect(fixture.port.prepareOrRecover(input)).resolves.toEqual(first);
  const canonicalRegistrations = await gitText(fixture.repoPath, [
    'worktree',
    'list',
    '--porcelain',
  ]);
  expect(canonicalRegistrations).not.toContain(first.worktreePath);
  expect(await gitText(first.worktreePath, ['rev-parse', '--git-common-dir'])).toBe(
    '.git'
  );
  expect(await gitText(first.worktreePath, ['remote'])).toBe('');
  expect(
    await gitText(first.worktreePath, [
      'config',
      '--local',
      '--get',
      'dao.knowledge-receipt',
    ])
  ).toMatch(/^knowledge-workspace-v1:[0-9a-f]{64}$/);
  expect(
    await filesContaining(
      path.join(first.worktreePath, '.git'),
      Buffer.from(fixture.repoPath)
    )
  ).toEqual([]);

  await fixture.port.cleanup(first);
});

test('attempt-local ref mutation cannot change the canonical default ref', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await writeFile(path.join(prepared.worktreePath, 'hostile.txt'), 'hostile\n');
  await commitAll(prepared.worktreePath, 'host runtime commit');
  const hostileHead = await gitText(prepared.worktreePath, ['rev-parse', 'HEAD']);

  await git(prepared.worktreePath, [
    'update-ref',
    'refs/heads/main',
    hostileHead,
    fixture.baseCommit,
  ]);

  expect(await gitText(prepared.worktreePath, ['rev-parse', 'refs/heads/main'])).toBe(
    hostileHead
  );
  expect(await gitText(fixture.repoPath, ['rev-parse', 'refs/heads/main'])).toBe(
    fixture.baseCommit
  );
  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'drifted',
  });

  await fixture.port.discardQuarantined(prepared);
});

test('trusted suspended recovery accepts dirty base state without weakening prepare replay', async () => {
  const fixture = await createFixture();
  const input = prepareInput(fixture);
  const prepared = await fixture.port.prepareOrRecover(input);

  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'prepared-clean',
  });
  await appendFile(path.join(prepared.worktreePath, 'README.md'), 'suspended\n');
  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'prepared-dirty',
  });
  await expect(fixture.port.prepareOrRecover(input)).rejects.toMatchObject({
    code: 'branch-already-exists',
  });

  await expect(fixture.port.recoverSuspended(prepared)).resolves.toEqual(prepared);
  expect(await gitText(prepared.worktreePath, ['status', '--porcelain'])).toContain(
    'README.md'
  );
  const finalized = await fixture.port.finalizeOrRecover(prepared);
  expect(finalized.changed).toBe(true);
  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'finalized-clean',
  });

  await fixture.port.cleanupOrRecover(prepared);
  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'absent',
  });
});

test('recovery fails closed when the isolated clone receipt marker is missing', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await git(prepared.worktreePath, [
    'config',
    '--local',
    '--unset',
    'dao.knowledge-receipt',
  ]);

  await expect(fixture.port.inspectRecoveryState(prepared)).resolves.toEqual({
    schemaVersion: 1,
    state: 'drifted',
  });
  await expect(fixture.port.recoverSuspended(prepared)).rejects.toMatchObject({
    code: 'worktree-not-registered',
  });
  await expect(fixture.port.discardQuarantined(prepared)).rejects.toMatchObject({
    code: 'worktree-not-registered',
  });
});

test('distinct durable attempts with the same job and number use different branches', async () => {
  const fixture = await createFixture();
  const first = await fixture.port.prepare(prepareInput(fixture));
  const second = await fixture.port.prepare(
    prepareInput(fixture, { attemptId: 'another-attempt-same-number' })
  );

  expect(first.branch).not.toBe(second.branch);
  expect(first.worktreePath).not.toBe(second.worktreePath);
  expect(await gitText(fixture.repoPath, ['rev-parse', first.branch])).toBe(
    fixture.baseCommit
  );
  expect(await gitText(fixture.repoPath, ['rev-parse', second.branch])).toBe(
    fixture.baseCommit
  );

  await fixture.port.cleanup(first);
  await fixture.port.cleanup(second);
});

test('prepareOrRecover resumes branch-only setup at the frozen base', async () => {
  const branchOnlyFixture = await createFixture();
  const input = prepareInput(branchOnlyFixture, {
    baseCommit: branchOnlyFixture.baseCommit,
  });
  const prepared = await branchOnlyFixture.port.prepare(input);
  await branchOnlyFixture.port.cleanup(prepared);

  await expect(
    branchOnlyFixture.port.prepare(input)
  ).rejects.toMatchObject({ code: 'branch-already-exists' });
  const recovered = await branchOnlyFixture.port.prepareOrRecover(input);
  expect(recovered).toEqual(prepared);
  expect(await gitText(recovered.worktreePath, ['rev-parse', 'HEAD'])).toBe(
    branchOnlyFixture.baseCommit
  );
  await branchOnlyFixture.port.cleanup(recovered);
});

test('prepareOrRecover rejects a branch-only state moved from the frozen base', async () => {
  const fixture = await createFixture();
  const input = prepareInput(fixture, { baseCommit: fixture.baseCommit });
  const prepared = await fixture.port.prepare(input);
  await fixture.port.cleanup(prepared);

  await writeFile(path.join(fixture.repoPath, 'advanced.txt'), 'advanced\n');
  await commitAll(fixture.repoPath, 'advance default branch');
  const advancedHead = await gitText(fixture.repoPath, ['rev-parse', 'HEAD']);
  await git(fixture.repoPath, [
    'update-ref',
    `refs/heads/${prepared.branch}`,
    advancedHead,
    fixture.baseCommit,
  ]);

  await expect(fixture.port.prepareOrRecover(input)).rejects.toMatchObject({
    code: 'branch-already-exists',
  });
  expect(await gitText(fixture.repoPath, ['rev-parse', prepared.branch])).toBe(
    advancedHead
  );
  await expect(access(prepared.worktreePath)).rejects.toBeTruthy();
});

test('prepareOrRecover rejects a path-only state without deleting it', async () => {
  const pathOnlyFixture = await createFixture();
  const pathReceipt = await pathOnlyFixture.port.prepare(
    prepareInput(pathOnlyFixture)
  );
  await pathOnlyFixture.port.cleanup(pathReceipt);
  await git(pathOnlyFixture.repoPath, ['branch', '-D', pathReceipt.branch]);
  await mkdir(pathReceipt.worktreePath, { recursive: true });
  await writeFile(path.join(pathReceipt.worktreePath, 'sentinel.txt'), 'safe\n');
  await expect(
    pathOnlyFixture.port.prepareOrRecover(prepareInput(pathOnlyFixture))
  ).rejects.toMatchObject({ code: 'worktree-path-conflict' });
  await expect(
    access(path.join(pathReceipt.worktreePath, 'sentinel.txt'))
  ).resolves.toBeUndefined();
});

test('prepareOrRecover rejects an already dirty matching worktree', async () => {
  const fixture = await createFixture();
  const input = prepareInput(fixture);
  const prepared = await fixture.port.prepareOrRecover(input);
  await appendFile(path.join(prepared.worktreePath, 'README.md'), 'dirty\n');

  await expect(fixture.port.prepareOrRecover(input)).rejects.toMatchObject({
    code: 'branch-already-exists',
  });

  await fixture.port.cleanup(prepared);
});

test('finalizeOrRecover exact replay reconstructs the finalized receipt', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await appendFile(path.join(prepared.worktreePath, 'README.md'), 'changed\n');

  const first = await fixture.port.finalizeOrRecover(prepared);
  await expect(fixture.port.finalizeOrRecover(prepared)).resolves.toEqual(first);
  expect(
    await gitText(prepared.worktreePath, [
      'rev-list',
      '--count',
      `${prepared.baseCommit}..HEAD`,
    ])
  ).toBe('1');

  await fixture.port.cleanup(prepared);
});

test('finalizeOrRecover rejects a lookalike commit with mismatched trailers', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await writeFile(path.join(prepared.worktreePath, 'manual.txt'), 'manual\n');
  await git(prepared.worktreePath, ['add', '--all']);
  await git(prepared.worktreePath, [
    '-c',
    `user.name=${AUTHOR.name}`,
    '-c',
    `user.email=${AUTHOR.email}`,
    'commit',
    '--no-gpg-sign',
    '-m',
    'Knowledge change for job job-one',
    '-m',
    'Job-Id: job-one\nAttempt-Id: another-attempt\nAgent-Id: agent-one',
  ]);

  await expect(fixture.port.finalizeOrRecover(prepared)).rejects.toMatchObject({
    code: 'worktree-state-changed',
  });
  await fixture.port.cleanup(prepared);
});

test('cleanup rejects tampered receipts and symlink escapes', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  const outside = path.join(fixture.root, 'must-survive');
  await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.txt'), 'safe\n');

  await expect(
    fixture.port.cleanup({ ...prepared, worktreePath: outside })
  ).rejects.toMatchObject({ code: 'invalid-receipt' });
  await expect(
    fixture.port.cleanup({ ...prepared, baseCommit: '0'.repeat(40) })
  ).rejects.toMatchObject({ code: 'invalid-receipt' });
  await expect(
    fixture.port.cleanup({ ...prepared, defaultBranch: 'missing' })
  ).rejects.toMatchObject({ code: 'invalid-receipt' });
  await expect(access(path.join(outside, 'sentinel.txt'))).resolves.toBeUndefined();

  const savedWorktree = `${prepared.worktreePath}-saved`;
  await rename(prepared.worktreePath, savedWorktree);
  await symlink(outside, prepared.worktreePath, 'dir');
  await expect(fixture.port.cleanup(prepared)).rejects.toMatchObject({
    code: 'unsafe-worktree-path',
  });
  await expect(access(path.join(outside, 'sentinel.txt'))).resolves.toBeUndefined();

  await unlink(prepared.worktreePath);
  await rename(savedWorktree, prepared.worktreePath);
  await fixture.port.cleanup(prepared);
  await expect(access(prepared.worktreePath)).rejects.toBeTruthy();
  expect(await gitText(fixture.repoPath, ['worktree', 'list', '--porcelain'])).not
    .toContain(prepared.worktreePath);
});

test('cleanup does not remove an unregistered repository at the expected path', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));
  await fixture.port.cleanup(prepared);

  await mkdir(prepared.worktreePath, { recursive: true });
  await git(prepared.worktreePath, ['init']);
  await writeFile(path.join(prepared.worktreePath, 'sentinel.txt'), 'safe\n');
  await commitAll(prepared.worktreePath, 'independent repository');

  await expect(fixture.port.cleanup(prepared)).rejects.toMatchObject({
    code: 'worktree-not-registered',
  });
  await expect(
    access(path.join(prepared.worktreePath, 'sentinel.txt'))
  ).resolves.toBeUndefined();
});

test('cleanupOrRecover exact replay succeeds when path and registration are absent', async () => {
  const fixture = await createFixture();
  const prepared = await fixture.port.prepare(prepareInput(fixture));

  await fixture.port.cleanupOrRecover(prepared);
  await expect(fixture.port.cleanupOrRecover(prepared)).resolves.toBeUndefined();
});

test('rejects untrusted paths, unsafe ids and attempt branch state changes', async () => {
  const fixture = await createFixture();
  await mkdir(path.join(fixture.repoPath, 'nested'));
  await expect(
    fixture.port.prepare(
      prepareInput(fixture, { repoPath: path.join(fixture.repoPath, 'nested') })
    )
  ).rejects.toBeInstanceOf(GitWorktreeError);
  await expect(
    fixture.port.prepare(prepareInput(fixture, { jobId: '../escape' }))
  ).rejects.toMatchObject({ code: 'invalid-input' });
  await expect(
    fixture.port.prepare(
      prepareInput(fixture, { mountPath: '/nested' as '/' })
    )
  ).rejects.toMatchObject({ code: 'invalid-input' });
  await expect(
    fixture.port.prepare(
      prepareInput(fixture, { defaultBranch: '--upload-pack=evil' })
    )
  ).rejects.toMatchObject({ code: 'invalid-input' });

  const prepared = await fixture.port.prepare(
    prepareInput(fixture, { attemptId: 'precommitted', attemptNumber: 5 })
  );
  await writeFile(path.join(prepared.worktreePath, 'manual.txt'), 'manual\n');
  await commitAll(prepared.worktreePath, 'untrusted manual commit');
  await expect(fixture.port.finalize(prepared)).rejects.toMatchObject({
    code: 'worktree-state-changed',
  });
  await fixture.port.cleanup(prepared);
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'git-worktree-port-'));
  temporaryRoots.add(root);
  const repoPath = path.join(root, 'repository');
  const managedRoot = path.join(root, 'managed-worktrees');
  await mkdir(repoPath);
  await git(root, ['init', repoPath]);
  await git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await writeFile(path.join(repoPath, 'README.md'), 'initial\n');
  await commitAll(repoPath, 'initial');
  const baseCommit = await gitText(repoPath, ['rev-parse', 'HEAD']);
  return {
    root,
    repoPath,
    managedRoot,
    baseCommit,
    port: new LocalGitWorktreePort({
      managedRoot,
      commitAuthor: AUTHOR,
    }),
  };
}

function prepareInput(
  fixture: Fixture,
  overrides: Partial<GitWorktreePrepareInput> = {}
): GitWorktreePrepareInput {
  return {
    spaceId: 'space-one',
    mountPath: '/',
    repoPath: fixture.repoPath,
    defaultBranch: 'main',
    jobId: 'job-one',
    attemptId: 'attempt-one',
    attemptNumber: 1,
    agentId: 'agent-one',
    ...overrides,
  };
}

async function defaultCheckoutSnapshot(repoPath: string) {
  return {
    branch: await gitText(repoPath, ['symbolic-ref', '--short', 'HEAD']),
    head: await gitText(repoPath, ['rev-parse', 'HEAD']),
    status: await gitBuffer(repoPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]),
  };
}

async function commitAll(repoPath: string, message: string): Promise<void> {
  await git(repoPath, ['add', '--all']);
  await git(repoPath, [
    '-c',
    'user.name=Fixture Author',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--no-gpg-sign',
    '-m',
    message,
  ]);
}

async function gitText(repoPath: string, args: string[]): Promise<string> {
  return (await git(repoPath, args)).stdout.toString('utf8').trim();
}

async function gitBuffer(repoPath: string, args: string[]): Promise<Buffer> {
  return (await git(repoPath, args)).stdout;
}

async function git(
  repoPath: string,
  args: string[]
): Promise<{ stdout: Buffer }> {
  const result = await execFileAsync('git', ['-C', repoPath, ...args], {
    encoding: 'buffer',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
  });
  return { stdout: result.stdout };
}

async function filesContaining(
  root: string,
  needle: Buffer,
  relative = ''
): Promise<string[]> {
  const matches: string[] = [];
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await filesContaining(root, needle, next)));
    } else if (entry.isFile() && (await readFile(path.join(root, next))).includes(needle)) {
      matches.push(next);
    }
  }
  return matches.sort();
}
