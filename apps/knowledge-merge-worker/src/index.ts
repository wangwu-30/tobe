import process from 'node:process';

import { prisma } from '@/lib/db/prisma';
import { createTrustedKnowledgeMergeProcessV1 } from '@/agent/knowledge/trusted-merge-process';

const abortController = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => abortController.abort(signal));
}

async function main() {
  const organizationId = requiredEnvironment('DAO_KNOWLEDGE_ORGANIZATION_ID');
  const workerId =
    process.env.DAO_KNOWLEDGE_WORKER_ID?.trim() ||
    `knowledge-merge-${process.pid}`;
  const artifactRoot = requiredEnvironment('DAO_KNOWLEDGE_INDEX_ROOT');
  const pollIntervalMs = positiveEnvironment('DAO_KNOWLEDGE_POLL_INTERVAL_MS', 1_000);
  const leaseDurationMs = positiveEnvironment('DAO_KNOWLEDGE_LEASE_DURATION_MS', 30_000);
  const maxAttempts = positiveEnvironment('DAO_KNOWLEDGE_MAX_ATTEMPTS', 3);
  const runOnce = process.env.DAO_KNOWLEDGE_RUN_ONCE === '1';
  const worker = createTrustedKnowledgeMergeProcessV1({
    organizationId,
    workerId,
    artifactRoot,
    pollIntervalMs,
    leaseDurationMs,
    maxAttempts,
    ...(process.env.DAO_GIT_BINARY?.trim()
      ? { gitBinary: process.env.DAO_GIT_BINARY.trim() }
      : {}),
  });

  await worker.preflight();
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      type: 'ready',
      organizationId,
      workerId,
      pid: process.pid,
    })}\n`
  );
  try {
    if (runOnce) {
      const summary = await worker.runOnce();
      process.stdout.write(
        `${JSON.stringify({ ...summary, type: 'run-complete', workerId, pid: process.pid })}\n`
      );
      if (summary.status !== 'succeeded') process.exitCode = 1;
    } else {
      await worker.run(abortController.signal);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: 1,
      type: 'error',
      code: errorCode(error),
      message: error instanceof Error ? error.message : 'Knowledge merge worker failed.',
      pid: process.pid,
    })}\n`
  );
  process.exitCode = 1;
});

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error &&
    typeof error.code === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(error.code)) {
    return error.code;
  }
  if (error instanceof Error && /required/.test(error.message)) {
    return 'invalid-configuration';
  }
  return 'knowledge-merge-worker-failed';
}
