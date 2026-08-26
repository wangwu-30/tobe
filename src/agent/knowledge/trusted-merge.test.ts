import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import {
  LocalKnowledgeIndexBuilderV1,
  readKnowledgeIndexArtifactV1,
} from './index-builder';
import {
  LocalTrustedKnowledgeGitPortV1,
  TrustedKnowledgeGitError,
  type TrustedKnowledgeMergeInputV1,
} from './trusted-merge';

const execFileAsync = promisify(execFile);
const temporaryRoots = new Set<string>();

test.afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

test('concurrent same-base proposals use CAS: one merges and one conflicts', async () => {
  const fixture = await createFixture();
  const first = await createProposal(fixture.repoPath, fixture.baseCommit, 'proposal/one', 'one.txt', 'one\n');
  const second = await createProposal(fixture.repoPath, fixture.baseCommit, 'proposal/two', 'two.txt', 'two\n');
  const port = new LocalTrustedKnowledgeGitPortV1();

  const settled = await Promise.allSettled([port.merge(first), port.merge(second)]);

  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const rejected = settled.find((result) => result.status === 'rejected');
  expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(TrustedKnowledgeGitError);
  expect((rejected as PromiseRejectedResult).reason).toMatchObject({
    code: 'default-ref-changed',
    conflict: true,
  });
  const winner = settled.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ mergedCommit: string }>;
  expect(winner.value.mergedCommit).toMatch(/^[0-9a-f]{40}$/);
});

test('exact replay succeeds after the default ref already reached the approved head', async () => {
  const fixture = await createFixture();
  const proposal = await createProposal(
    fixture.repoPath,
    fixture.baseCommit,
    'proposal/replay',
    'replay.md',
    '# replay\n'
  );
  const port = new LocalTrustedKnowledgeGitPortV1();

  const first = await port.merge(proposal);
  const replay = await port.merge(proposal);

  expect(first).toEqual({ schemaVersion: 1, mergedCommit: proposal.headCommit, replayed: false });
  expect(replay).toEqual({ schemaVersion: 1, mergedCommit: proposal.headCommit, replayed: true });
});

test('validates proposal ref and canonical patch hash before mutation', async () => {
  const fixture = await createFixture();
  const proposal = await createProposal(
    fixture.repoPath,
    fixture.baseCommit,
    'proposal/validated',
    'validated.md',
    'trusted\n'
  );
  const port = new LocalTrustedKnowledgeGitPortV1();

  await expect(
    port.merge({ ...proposal, expectedPatchSha256: 'f'.repeat(64) })
  ).rejects.toMatchObject({ code: 'patch-hash-mismatch' });
  expect(await git(fixture.repoPath, ['rev-parse', 'refs/heads/main'])).toBe(fixture.baseCommit);

  await git(proposalWorktreePath(fixture.repoPath, proposal.proposalBranch), [
    'reset',
    '--hard',
    fixture.baseCommit,
  ]);
  await expect(port.merge(proposal)).rejects.toMatchObject({ code: 'proposal-ref-changed' });
});

test('index artifacts are deterministic, atomic, hashed, and safe to read', async () => {
  const fixture = await createFixture();
  const proposal = await createProposal(
    fixture.repoPath,
    fixture.baseCommit,
    'proposal/index',
    'knowledge/guide.md',
    '# Guide\nStable text.\n'
  );
  const artifactRoot = path.join(fixture.root, 'indexes');
  const builder = new LocalKnowledgeIndexBuilderV1({ artifactRoot });

  const first = await builder.build({
    repositoryPath: fixture.repoPath,
    spaceId: 'space-a',
    commitSha: proposal.headCommit,
    indexVersion: 'knowledge-index-v1',
  });
  const second = await builder.build({
    repositoryPath: fixture.repoPath,
    spaceId: 'space-a',
    commitSha: proposal.headCommit,
    indexVersion: 'knowledge-index-v1',
  });

  expect(second.artifactPath).toBe(first.artifactPath);
  expect(second.artifactSha256).toBe(first.artifactSha256);
  const bytes = await readFile(first.artifactPath);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(first.artifactSha256);
  const artifact = await readKnowledgeIndexArtifactV1(first.artifactPath, first.artifactSha256);
  expect(artifact).toMatchObject({
    schemaVersion: 1,
    commitSha: proposal.headCommit,
    indexVersion: 'knowledge-index-v1',
  });
  expect(artifact.documents.map((document) => document.path)).toEqual([
    'README.md',
    'knowledge/guide.md',
  ]);
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(path.dirname(first.artifactPath)));
  expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tobe-trusted-merge-'));
  temporaryRoots.add(root);
  const repoPath = path.join(root, 'knowledge');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['checkout', '-b', 'main']);
  await writeFile(path.join(repoPath, 'README.md'), '# Knowledge\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    'commit', '-m', 'base',
  ]);
  const baseCommit = await git(repoPath, ['rev-parse', 'HEAD']);
  return { root, repoPath, baseCommit };
}

async function createProposal(
  repoPath: string,
  baseCommit: string,
  proposalBranch: string,
  file: string,
  content: string
): Promise<TrustedKnowledgeMergeInputV1> {
  await git(repoPath, ['branch', proposalBranch, baseCommit]);
  const worktree = proposalWorktreePath(repoPath, proposalBranch);
  await git(repoPath, ['worktree', 'add', worktree, proposalBranch]);
  const filePath = path.join(worktree, file);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  await git(worktree, ['add', '.']);
  await git(worktree, [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    'commit', '-m', proposalBranch,
  ]);
  const headCommit = await git(worktree, ['rev-parse', 'HEAD']);
  const patch = await gitBuffer(repoPath, canonicalDiffArgs(baseCommit, headCommit));
  return {
    repositoryPath: repoPath,
    defaultBranch: 'main',
    proposalBranch,
    baseCommit,
    headCommit,
    expectedPatchSha256: createHash('sha256').update(patch).digest('hex'),
  };
}

function proposalWorktreePath(repoPath: string, proposalBranch: string) {
  return path.join(path.dirname(repoPath), proposalBranch.replaceAll('/', '-'));
}

function canonicalDiffArgs(baseCommit: string, headCommit: string) {
  return [
    'diff', '--binary', '--full-index', '--no-color', '--no-ext-diff',
    '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/',
    baseCommit, headCommit, '--',
  ];
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitBuffer(cwd, args)).toString('utf8').trim();
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'buffer' });
  return result.stdout;
}
