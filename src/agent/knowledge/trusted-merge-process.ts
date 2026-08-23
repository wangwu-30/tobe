import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';

import { prisma } from '@/lib/db/prisma';

import { LocalKnowledgeIndexBuilderV1 } from './index-builder';
import { LocalTrustedKnowledgeGitPortV1 } from './trusted-merge';
import { TrustedKnowledgeMergeWorkerV1 } from './trusted-merge-worker';

export type TrustedKnowledgeMergeProcessConfigV1 = {
  organizationId: string;
  workerId: string;
  artifactRoot: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  batchSize?: number;
  maxAttempts?: number;
  gitBinary?: string;
};

export interface TrustedKnowledgeMergeProcessV1 {
  preflight(): Promise<void>;
  run(signal?: AbortSignal): Promise<void>;
  runOnce(): Promise<KnowledgeMergeRunSummaryV1>;
}

export type KnowledgeMergeRunSummaryV1 = {
  schemaVersion: 1;
  status: 'succeeded' | 'incomplete';
  processed: number;
  succeeded: number;
  conflicted: number;
  failed: number;
  unhandled: number;
  remaining: number;
};

const execFileAsync = promisify(execFile);

export function createTrustedKnowledgeMergeProcessV1(
  config: TrustedKnowledgeMergeProcessConfigV1
): TrustedKnowledgeMergeProcessV1 {
  validateConfig(config);
  const git = new LocalTrustedKnowledgeGitPortV1({ gitBinary: config.gitBinary });
  const indexBuilder = new LocalKnowledgeIndexBuilderV1({
    artifactRoot: config.artifactRoot,
    gitBinary: config.gitBinary,
  });
  const worker = new TrustedKnowledgeMergeWorkerV1(
    {
      organizationId: config.organizationId,
      workerId: config.workerId,
      leaseDurationMs: config.leaseDurationMs,
      batchSize: config.batchSize,
      maxAttempts: config.maxAttempts,
    },
    { git, indexBuilder }
  );

  return {
    async preflight() {
      await Promise.all([
        preflightDatabase(),
        preflightGit(config.gitBinary),
        preflightArtifactRoot(config.artifactRoot),
      ]);
    },
    async run(signal) {
      while (!signal?.aborted) {
        await worker.runOnce();
        if (signal?.aborted) break;
        await wait(config.pollIntervalMs, undefined, { signal }).catch((error) => {
          if (!signal?.aborted) throw error;
        });
      }
    },
    async runOnce() {
      const results = await worker.runOnce();
      return summarize(
        results,
        await countUnresolvedOperations(config.organizationId)
      );
    },
  };
}

function validateConfig(config: TrustedKnowledgeMergeProcessConfigV1): void {
  for (const [field, value] of [
    ['organizationId', config.organizationId],
    ['workerId', config.workerId],
    ['artifactRoot', config.artifactRoot],
  ] as const) {
    if (!value.trim()) throw new Error(`${field} is required.`);
  }
  for (const [field, value] of [
    ['pollIntervalMs', config.pollIntervalMs],
    ['leaseDurationMs', config.leaseDurationMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${field} must be a positive integer.`);
    }
  }
  if (!path.isAbsolute(config.artifactRoot)) {
    throw new Error('artifactRoot must be an absolute path.');
  }
  if (config.maxAttempts !== undefined &&
    (!Number.isSafeInteger(config.maxAttempts) || config.maxAttempts < 1)) {
    throw new Error('maxAttempts must be a positive integer.');
  }
}

function summarize(
  results: Awaited<ReturnType<TrustedKnowledgeMergeWorkerV1['runOnce']>>,
  remaining: number
): KnowledgeMergeRunSummaryV1 {
  const counts = { succeeded: 0, conflicted: 0, failed: 0, unhandled: 0 };
  for (const result of results) counts[result.status] += 1;
  return {
    schemaVersion: 1,
    status: counts.failed === 0 && counts.unhandled === 0 && remaining === 0
      ? 'succeeded'
      : 'incomplete',
    processed: results.length,
    ...counts,
    remaining,
  };
}

async function countUnresolvedOperations(organizationId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    SELECT COUNT(*) AS "count"
    FROM "KnowledgeMergeOperation"
    WHERE "organizationId" = ${organizationId}
      AND "status" IN ('queued', 'running', 'failed')
  `;
  const count = Number(rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Knowledge merge operation count is invalid.');
  }
  return count;
}

async function preflightDatabase(): Promise<void> {
  await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS "ok"`;
  const requiredTables = [
    'KnowledgeSpace',
    'KnowledgeSnapshot',
    'KnowledgeChangeRequest',
    'KnowledgeMergeOperation',
  ];
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name" FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" IN (${requiredTables[0]}, ${requiredTables[1]}, ${requiredTables[2]}, ${requiredTables[3]})
  `;
  const names = new Set(rows.map((row) => row.name));
  if (requiredTables.some((table) => !names.has(table))) {
    throw new Error('Knowledge merge database schema is not ready.');
  }
}

async function preflightGit(gitBinary = 'git'): Promise<void> {
  try {
    await execFileAsync(gitBinary, ['--version'], { windowsHide: true });
  } catch {
    throw new Error('Configured Git executable is unavailable.');
  }
}

async function preflightArtifactRoot(artifactRoot: string): Promise<void> {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await access(artifactRoot, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  const probeDirectory = await mkdtemp(
    path.join(artifactRoot, `.knowledge-preflight-${randomUUID()}-`)
  );
  try {
    await writeFile(path.join(probeDirectory, 'probe'), 'ready\n', { flag: 'wx' });
  } finally {
    await rm(probeDirectory, { recursive: true, force: true });
  }
}
