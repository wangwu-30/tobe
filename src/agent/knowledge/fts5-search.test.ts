import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createClient, type Client, type InValue } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { isGovernedAgentTool } from '@/agent/tool-policy';
import { createReadKnowledgeDocTool } from '@/agent/tools/knowledge/read-knowledge-doc';
import { createSearchKnowledgeTool } from '@/agent/tools/knowledge/search-knowledge';

import { chunkKnowledgeDocument } from './chunker';
import {
  KNOWLEDGE_INDEX_VERSION_V2_FTS5,
  KnowledgeIndexBuildErrorV1,
  LocalKnowledgeIndexBuilderV1,
  readKnowledgeIndexArtifactV1,
} from './index-builder';
import {
  KNOWLEDGE_RETRIEVAL_TRUST_V1,
  readKnowledgeIndexDocument,
  searchKnowledgeIndexArtifact,
  type KnowledgeQueryDb,
} from './search';

const execFileAsync = promisify(execFile);
const temporaryRoots = new Set<string>();

test.afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { force: true, recursive: true })
    )
  );
  temporaryRoots.clear();
});

test('chunkKnowledgeDocument splits by markdown headings, ignores fenced code headings, and preserves exact offsets', () => {
  const markdown = [
    '# Launch Architecture',
    'Intro overview paragraph.',
    '',
    '```md',
    '# Not A Real Heading Inside Code Fence',
    '```',
    '',
    '## Pricing Policy',
    'Pilot price is 42 credits per month.',
    '',
    '### Approval Gate',
    'Human owner review is mandatory before release.',
  ].join('\n');

  const chunks = chunkKnowledgeDocument({
    content: markdown,
    maxChunkChars: 160,
    overlapChars: 20,
    path: 'docs/launch.md',
  });

  expect(chunks.length).toBeGreaterThanOrEqual(3);
  for (const chunk of chunks) {
    expect(markdown.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    expect(chunk.content.length).toBeLessThanOrEqual(160);
  }
  expect(chunks.some((chunk) => chunk.heading === 'Launch Architecture')).toBe(true);
  expect(
    chunks.some((chunk) => chunk.heading.includes('Not A Real Heading'))
  ).toBe(false);
  expect(
    chunks.some((chunk) => chunk.heading === 'Launch Architecture > Pricing Policy')
  ).toBe(true);
  expect(
    chunks.some(
      (chunk) =>
        chunk.heading === 'Launch Architecture > Pricing Policy > Approval Gate'
    )
  ).toBe(true);
});

test('SQLite FTS5 v2 index is byte-deterministic, readable via V1 reader, supports English + CJK BM25 + pagination, and fails closed on tampering', async () => {
  const fixture = await createGitKnowledgeFixture({
    'docs/pricing.md': [
      '# Pricing Architecture',
      'The approved enterprise pilot pricing tier is 42 credits.',
      '',
      '## Rollout Rules',
      'All pricing adjustments require CFO sign-off before publication.',
    ].join('\n'),
    'docs/release-zh.md': [
      '# 发布上线清单',
      '正式发布上线前必须完成灰度验证与人工审批。',
      '',
      '## 回滚策略',
      '若监控指标异常，应在五分钟内触发回滚。',
    ].join('\n'),
    'docs/long-spec.md': `# Specification\n${'Detailed clause entry.\n'.repeat(120)}`,
  });

  const artifactRoot = path.join(fixture.root, 'indexes');
  const builder = new LocalKnowledgeIndexBuilderV1({ artifactRoot });

  const first = await builder.build({
    commitSha: fixture.commitSha,
    indexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    repositoryPath: fixture.repoPath,
    spaceId: 'space-fts5',
  });
  const second = await builder.build({
    commitSha: fixture.commitSha,
    indexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    repositoryPath: fixture.repoPath,
    spaceId: 'space-fts5',
  });

  expect(first.artifactPath.endsWith('.sqlite')).toBe(true);
  expect(second.artifactPath).toBe(first.artifactPath);
  expect(second.artifactSha256).toBe(first.artifactSha256);
  const onDiskBytes = await readFile(first.artifactPath);
  expect(createHash('sha256').update(onDiskBytes).digest('hex')).toBe(
    first.artifactSha256
  );

  // V1 artifact reader transparently verifies and reads SQLite FTS5 snapshots.
  const artifact = await readKnowledgeIndexArtifactV1(
    first.artifactPath,
    first.artifactSha256
  );
  expect(artifact).toMatchObject({
    commitSha: fixture.commitSha,
    indexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    schemaVersion: 1,
  });
  expect(artifact.documents.map((doc) => doc.path)).toEqual([
    'docs/long-spec.md',
    'docs/pricing.md',
    'docs/release-zh.md',
  ]);

  // English BM25 search via unicode61.
  const enHits = await searchKnowledgeIndexArtifact({
    artifactPath: first.artifactPath,
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    limit: 5,
    query: 'enterprise pilot pricing credits',
  });
  expect(enHits.length).toBeGreaterThan(0);
  expect(enHits[0]).toMatchObject({
    heading: 'Pricing Architecture',
    path: 'docs/pricing.md',
  });
  expect(enHits[0].snippet).toContain('42 credits');

  // Chinese/CJK >= 3 chars via trigram BM25.
  const zhTrigramHits = await searchKnowledgeIndexArtifact({
    artifactPath: first.artifactPath,
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    limit: 5,
    query: '灰度验证与人工审批',
  });
  expect(zhTrigramHits.length).toBeGreaterThan(0);
  expect(zhTrigramHits[0].path).toBe('docs/release-zh.md');

  // 2-character CJK query via bounded fallback.
  const zhShortHits = await searchKnowledgeIndexArtifact({
    artifactPath: first.artifactPath,
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    limit: 5,
    query: '回滚',
  });
  expect(zhShortHits.length).toBeGreaterThan(0);
  expect(zhShortHits[0].path).toBe('docs/release-zh.md');

  // FTS5 syntax metacharacters never throw.
  const metacharHits = await searchKnowledgeIndexArtifact({
    artifactPath: first.artifactPath,
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    limit: 5,
    query: '"pricing" AND NOT (credits*) :^ -foo',
  });
  expect(metacharHits.some((hit) => hit.path === 'docs/pricing.md')).toBe(true);

  // Windowed pagination via readKnowledgeIndexDocument.
  const page1 = await readKnowledgeIndexDocument({
    artifactPath: first.artifactPath,
    documentPath: 'docs/long-spec.md',
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    maxChars: 500,
    offsetChars: 0,
  });
  expect(page1).not.toBeNull();
  expect(page1?.hasMore).toBe(true);
  expect(page1?.nextOffsetChars).toBe(500);
  expect(page1?.content.length).toBe(500);

  const page2 = await readKnowledgeIndexDocument({
    artifactPath: first.artifactPath,
    documentPath: 'docs/long-spec.md',
    expectedCommitSha: fixture.commitSha,
    expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    expectedSha256: first.artifactSha256,
    maxChars: 500,
    offsetChars: page1!.nextOffsetChars!,
  });
  expect(page2?.offsetChars).toBe(500);
  expect(page2?.content.length).toBe(500);

  // Path traversal & missing paths fail closed.
  expect(
    await readKnowledgeIndexDocument({
      artifactPath: first.artifactPath,
      documentPath: '../etc/passwd',
      expectedCommitSha: fixture.commitSha,
      expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
      expectedSha256: first.artifactSha256,
    })
  ).toBeNull();

  // Tampering fails closed for both search and V1 reader.
  await writeFile(first.artifactPath, Buffer.from('tampered-sqlite-bytes'));
  await expect(
    readKnowledgeIndexArtifactV1(first.artifactPath, first.artifactSha256)
  ).rejects.toBeInstanceOf(KnowledgeIndexBuildErrorV1);
  expect(
    await searchKnowledgeIndexArtifact({
      artifactPath: first.artifactPath,
      expectedCommitSha: fixture.commitSha,
      expectedIndexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
      expectedSha256: first.artifactSha256,
      query: 'pricing',
    })
  ).toEqual([]);
});

test('governed search_knowledge and read_knowledge_doc enforce live ACL, readyAt, private agent isolation, and untrusted trust metadata', async () => {
  const fixture = await createGitKnowledgeFixture({
    'runbook.md': '# Team Runbook\nAlways run verification gate before release.\n',
  });
  const privateFixture = await createGitKnowledgeFixture({
    'private.md': '# Agent A Notes\nPrivate research strategy ALPHA-SECRET-99.\n',
  });

  const artifactRoot = path.join(fixture.root, 'indexes');
  const builder = new LocalKnowledgeIndexBuilderV1({ artifactRoot });
  const teamIndex = await builder.build({
    commitSha: fixture.commitSha,
    indexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    repositoryPath: fixture.repoPath,
    spaceId: 'space-team',
  });
  const agentAIndex = await builder.build({
    commitSha: privateFixture.commitSha,
    indexVersion: KNOWLEDGE_INDEX_VERSION_V2_FTS5,
    repositoryPath: privateFixture.repoPath,
    spaceId: 'space-agent-a',
  });

  const dbRoot = await mkdtemp(path.join(tmpdir(), 'tobe-fts5-acl-db-'));
  temporaryRoots.add(dbRoot);
  const databasePath = path.join(dbRoot, 'dev.db');
  await execFileAsync(
    process.execPath,
    ['scripts/bootstrap-local-db.mjs', '--app-data-root', dbRoot],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DAO_APP_DATA_ROOT: dbRoot,
        DATABASE_URL: `file:${databasePath}`,
      },
    }
  );
  const client = createClient({ url: `file:${databasePath}` });
  const queryDb = createRawQueryDb(client);

  try {
    const now = new Date('2026-08-22T10:00:00.000Z');
    const past = new Date('2026-08-22T09:00:00.000Z');
    const future = new Date('2099-01-01T00:00:00.000Z');

    await client.executeMultiple(`
      INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt")
      VALUES
        ('org-a', 'org-a', 'Org A', '${now.toISOString()}', '${now.toISOString()}'),
        ('org-b', 'org-b', 'Org B', '${now.toISOString()}', '${now.toISOString()}');

      INSERT INTO "Session" ("id", "organizationId", "title", "revision", "createdAt", "updatedAt")
      VALUES ('sess-a', 'org-a', 'Session A', 1, '${now.toISOString()}', '${now.toISOString()}');

      INSERT INTO "Document"
        ("id", "organizationId", "sessionId", "title", "content", "status",
         "currentVersion", "draftRevision", "revision", "createdAt", "updatedAt")
      VALUES
        ('proj-a', 'org-a', 'sess-a', 'Project A', '[]', 'draft', 1, 1, 1, '${now.toISOString()}', '${now.toISOString()}');

      INSERT INTO "Document"
        ("id", "organizationId", "sessionId", "projectId", "title", "content", "status",
         "currentVersion", "draftRevision", "revision", "createdAt", "updatedAt")
      VALUES
        ('doc-a', 'org-a', 'sess-a', 'proj-a', 'Child Doc A', '[]', 'draft', 1, 1, 1, '${now.toISOString()}', '${now.toISOString()}');
    `);

    await seedSpaceAndBinding(client, {
      agentId: null,
      artifactPath: teamIndex.artifactPath,
      artifactSha256: teamIndex.artifactSha256,
      bindingId: 'bind-team',
      commitSha: fixture.commitSha,
      now: past,
      organizationId: 'org-a',
      ownerAgentId: null,
      readPolicy: 'team',
      readyAt: past,
      scope: 'team',
      snapshotId: 'snap-team',
      spaceId: 'space-team',
      workspaceId: 'proj-a',
    });

    await seedSpaceAndBinding(client, {
      agentId: 'agent-a',
      artifactPath: agentAIndex.artifactPath,
      artifactSha256: agentAIndex.artifactSha256,
      bindingId: 'bind-agent-a',
      commitSha: privateFixture.commitSha,
      now: past,
      organizationId: 'org-a',
      ownerAgentId: 'agent-a',
      readPolicy: 'owner',
      readyAt: past,
      scope: 'agent',
      snapshotId: 'snap-agent-a',
      spaceId: 'space-agent-a',
      workspaceId: 'proj-a',
    });

    // Future readyAt snapshot must never leak.
    await seedSpaceAndBinding(client, {
      agentId: null,
      artifactPath: privateFixture.repoPath,
      artifactSha256: agentAIndex.artifactSha256,
      bindingId: 'bind-unready',
      commitSha: privateFixture.commitSha,
      now: past,
      organizationId: 'org-a',
      ownerAgentId: null,
      readPolicy: 'team',
      readyAt: future,
      scope: 'team',
      snapshotId: 'snap-unready',
      spaceId: 'space-unready',
      workspaceId: 'proj-a',
    });

    // Studio tool (agentId=null) sees team space ONLY, never agent-a's private space.
    const studioSearch = createSearchKnowledgeTool({
      organizationId: 'org-a',
      prisma: queryDb,
      resolveProjectId: async () => 'proj-a',
      workspaceId: 'doc-a',
    });
    const studioRead = createReadKnowledgeDocTool({
      organizationId: 'org-a',
      prisma: queryDb,
      resolveProjectId: async () => 'proj-a',
      workspaceId: 'doc-a',
    });

    expect(isGovernedAgentTool(studioSearch)).toBe(true);
    expect(isGovernedAgentTool(studioRead)).toBe(true);
    expect(studioSearch.writePolicy).toBe('read-only');
    expect(studioRead.writePolicy).toBe('read-only');

    const studioTeamResult = await studioSearch.execute('call-1', {
      query: 'verification gate',
    });
    expect(studioTeamResult.content[0]).toMatchObject({
      text: expect.stringContaining('runbook.md'),
      type: 'text',
    });
    expect(studioTeamResult.details).toMatchObject({
      trust: KNOWLEDGE_RETRIEVAL_TRUST_V1,
    });

    const studioPrivateResult = await studioSearch.execute('call-2', {
      query: 'ALPHA-SECRET-99',
    });
    expect(
      (studioPrivateResult.details as { hits: unknown[] }).hits
    ).toEqual([]);
    await expect(
      studioRead.execute('call-3', {
        path: 'private.md',
        spaceId: 'space-agent-a',
      })
    ).rejects.toThrow('not found or is not authorized');

    const studioTeamRead = await studioRead.execute('call-4', {
      path: 'runbook.md',
      spaceId: 'space-team',
    });
    expect(studioTeamRead.details).toMatchObject({
      path: 'runbook.md',
      spaceId: 'space-team',
      trust: KNOWLEDGE_RETRIEVAL_TRUST_V1,
    });
    expect(studioTeamRead.content[0]).toMatchObject({
      text: expect.stringContaining('Always run verification gate'),
    });

    // Room Agent A sees BOTH team space and its own private space.
    const agentASearch = createSearchKnowledgeTool({
      agentId: 'agent-a',
      organizationId: 'org-a',
      prisma: queryDb,
      resolveProjectId: async () => 'proj-a',
      workspaceId: 'proj-a',
    });
    const agentAResult = await agentASearch.execute('call-5', {
      query: 'ALPHA-SECRET-99',
    });
    expect(
      (agentAResult.details as { hits: Array<{ spaceId: string; path: string }> }).hits
    ).toEqual([
      expect.objectContaining({
        path: 'private.md',
        spaceId: 'space-agent-a',
      }),
    ]);

    // Room Agent B cannot see Agent A's private space.
    const agentBSearch = createSearchKnowledgeTool({
      agentId: 'agent-b',
      organizationId: 'org-a',
      prisma: queryDb,
      resolveProjectId: async () => 'proj-a',
      workspaceId: 'proj-a',
    });
    const agentBResult = await agentBSearch.execute('call-6', {
      query: 'ALPHA-SECRET-99',
    });
    expect(
      (agentBResult.details as { hits: unknown[] }).hits
    ).toEqual([]);

    // Cross-org caller cannot see org-a's team space.
    const crossOrgSearch = createSearchKnowledgeTool({
      organizationId: 'org-b',
      prisma: queryDb,
      resolveProjectId: async () => 'proj-a',
      workspaceId: 'proj-a',
    });
    const crossOrgResult = await crossOrgSearch.execute('call-7', {
      query: 'verification gate',
    });
    expect(
      (crossOrgResult.details as { hits: unknown[] }).hits
    ).toEqual([]);
  } finally {
    client.close();
  }
});

async function seedSpaceAndBinding(
  client: Client,
  input: {
    agentId: string | null;
    artifactPath: string;
    artifactSha256: string;
    bindingId: string;
    commitSha: string;
    now: Date;
    organizationId: string;
    ownerAgentId: string | null;
    readPolicy: string;
    readyAt: Date;
    scope: string;
    snapshotId: string;
    spaceId: string;
    workspaceId: string;
  }
) {
  const nowIso = input.now.toISOString();
  const readyIso = input.readyAt.toISOString();
  await client.execute({
    args: [
      input.spaceId,
      input.organizationId,
      input.scope,
      input.ownerAgentId,
      path.dirname(input.artifactPath),
      input.snapshotId,
      input.readPolicy,
      nowIso,
      nowIso,
    ],
    sql: `INSERT INTO "KnowledgeSpace"
      ("id", "organizationId", "scope", "ownerAgentId", "repoPath", "repoUrl",
       "defaultBranch", "credentialRef", "activeSnapshotId", "readPolicy", "writePolicy", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, NULL, 'main', NULL, ?, ?, 'review-only', ?, ?)`,
  });
  await client.execute({
    args: [
      `cr-${input.snapshotId}`,
      input.organizationId,
      input.spaceId,
      '0'.repeat(40),
      input.commitSha,
      input.commitSha,
      nowIso,
      nowIso,
      nowIso,
    ],
    sql: `INSERT INTO "KnowledgeChangeRequest"
      ("id", "organizationId", "jobId", "attemptId", "spaceId", "baseCommit", "headCommit",
       "branchName", "status", "diffSummary", "diffMetadataJson", "mergedCommit", "mergedAt",
       "revision", "createdAt", "updatedAt")
      VALUES (?, ?, 'job-1', 'attempt-1', ?, ?, ?, 'knowledge/branch', 'merged', '', '{}', ?, ?, 2, ?, ?)`,
  });
  await client.execute({
    args: [
      input.snapshotId,
      input.organizationId,
      input.spaceId,
      `cr-${input.snapshotId}`,
      input.commitSha,
      KNOWLEDGE_INDEX_VERSION_V2_FTS5,
      input.artifactPath,
      input.artifactSha256,
      readyIso,
      nowIso,
    ],
    sql: `INSERT INTO "KnowledgeSnapshot"
      ("id", "organizationId", "spaceId", "changeRequestId", "commitSha", "indexVersion",
       "artifactPath", "artifactSha256", "readyAt", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  });
  await client.execute({
    args: [
      input.bindingId,
      input.organizationId,
      input.workspaceId,
      input.agentId,
      input.spaceId,
      nowIso,
      nowIso,
    ],
    sql: `INSERT INTO "KnowledgeBinding"
      ("id", "organizationId", "workspaceId", "agentId", "spaceId", "mountPath", "access", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, '/', 'read', ?, ?)`,
  });
}

function createRawQueryDb(client: Client): KnowledgeQueryDb {
  return {
    async $queryRaw<T = unknown>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T> {
      let sql = strings[0] || '';
      const args: InValue[] = [];
      for (let index = 0; index < values.length; index += 1) {
        sql += `?${strings[index + 1] || ''}`;
        const value = values[index];
        args.push(value instanceof Date ? value.toISOString() : (value as InValue));
      }
      const result = await client.execute({ args, sql });
      return result.rows as T;
    },
  };
}

async function createGitKnowledgeFixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'tobe-fts5-knowledge-'));
  temporaryRoots.add(root);
  const repoPath = path.join(root, 'repo');
  await mkdir(repoPath, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: repoPath });
  await execFileAsync('git', ['checkout', '-b', 'main'], { cwd: repoPath });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  await execFileAsync('git', ['add', '.'], { cwd: repoPath });
  await execFileAsync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-m',
      'seed knowledge',
    ],
    { cwd: repoPath }
  );
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
  });
  return { commitSha: stdout.trim(), repoPath, root };
}
