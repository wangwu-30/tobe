import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { safeJsonParse } from '@/framework/resilience/safe-data';

const execFileAsync = promisify(execFile);
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const INDEX_SCHEMA_VERSION = 1 as const;
const COMMON_GIT_ARGS = [
  '-c', `core.hooksPath=${devNull}`,
  '-c', 'core.fsmonitor=false',
  '-c', 'credential.helper=',
] as const;

export type KnowledgeIndexDocumentV1 = {
  path: string;
  blobSha: string;
  byteLength: number;
  content: string;
  contentSha256: string;
};

export type KnowledgeIndexArtifactV1 = {
  schemaVersion: typeof INDEX_SCHEMA_VERSION;
  indexVersion: string;
  commitSha: string;
  documents: readonly KnowledgeIndexDocumentV1[];
};

export type BuiltKnowledgeIndexV1 = {
  schemaVersion: 1;
  artifactPath: string;
  artifactSha256: string;
  readyAt: Date;
  documentCount: number;
};

export type KnowledgeIndexBuilderInputV1 = {
  repositoryPath: string;
  spaceId: string;
  commitSha: string;
  indexVersion: string;
};

export interface KnowledgeIndexBuilderPortV1 {
  build(input: KnowledgeIndexBuilderInputV1): Promise<BuiltKnowledgeIndexV1>;
}

export type LocalKnowledgeIndexBuilderConfigV1 = {
  artifactRoot: string;
  gitBinary?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

export class KnowledgeIndexBuildErrorV1 extends Error {
  constructor(readonly code: 'invalid-input' | 'invalid-repository' | 'git-failed' | 'index-too-large' | 'write-failed') {
    super(`Knowledge index build failed (${code}).`);
    this.name = 'KnowledgeIndexBuildErrorV1';
  }
}

/** Builds a byte-stable JSON artifact from one immutable Git tree. */
export class LocalKnowledgeIndexBuilderV1 implements KnowledgeIndexBuilderPortV1 {
  private readonly artifactRoot: string;
  private readonly gitBinary: string;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;

  constructor(config: LocalKnowledgeIndexBuilderConfigV1) {
    if (!path.isAbsolute(config.artifactRoot) || /[\r\n\0]/.test(config.artifactRoot)) {
      throw new KnowledgeIndexBuildErrorV1('invalid-input');
    }
    this.artifactRoot = path.resolve(config.artifactRoot);
    this.gitBinary = config.gitBinary?.trim() || 'git';
    this.maxFileBytes = positive(config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    this.maxTotalBytes = positive(config.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
  }

  async build(input: KnowledgeIndexBuilderInputV1): Promise<BuiltKnowledgeIndexV1> {
    validateInput(input);
    const repositoryPath = await this.repositoryRoot(input.repositoryPath);
    const commitSha = (await this.git(repositoryPath, [
      'rev-parse', '--verify', '--end-of-options', `${input.commitSha}^{commit}`,
    ])).toString('utf8').trim().toLowerCase();
    if (commitSha !== input.commitSha) {
      throw new KnowledgeIndexBuildErrorV1('invalid-input');
    }

    const listing = await this.git(repositoryPath, [
      'ls-tree', '-r', '-z', '--full-tree', commitSha, '--',
    ]);
    const entries = parseTree(listing).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    );
    const documents: KnowledgeIndexDocumentV1[] = [];
    let totalBytes = 0;
    for (const entry of entries) {
      const content = await this.git(repositoryPath, ['cat-file', 'blob', entry.blobSha]);
      if (content.length > this.maxFileBytes) continue;
      totalBytes += content.length;
      if (totalBytes > this.maxTotalBytes) {
        throw new KnowledgeIndexBuildErrorV1('index-too-large');
      }
      if (!isUtf8Text(content)) continue;
      documents.push({
        path: entry.path,
        blobSha: entry.blobSha,
        byteLength: content.length,
        content: content.toString('utf8'),
        contentSha256: createHash('sha256').update(content).digest('hex'),
      });
    }

    const artifact: KnowledgeIndexArtifactV1 = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      indexVersion: input.indexVersion,
      commitSha,
      documents,
    };
    const bytes = Buffer.from(stableSerialize(artifact) + '\n', 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const directory = path.join(this.artifactRoot, safeComponent(input.spaceId));
    const finalPath = path.join(
      directory,
      `${safeComponent(input.indexVersion)}-${commitSha}-${digest}.json`
    );
    const temporaryPath = path.join(directory, `.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const existing = await verifyExisting(finalPath, digest);
      if (!existing) {
        await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, finalPath);
      }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error instanceof KnowledgeIndexBuildErrorV1
        ? error
        : new KnowledgeIndexBuildErrorV1('write-failed');
    }
    return {
      schemaVersion: 1,
      artifactPath: finalPath,
      artifactSha256: digest,
      readyAt: new Date(),
      documentCount: documents.length,
    };
  }

  private async git(cwd: string, args: readonly string[]): Promise<Buffer> {
    try {
      const result = await execFileAsync(this.gitBinary, [...COMMON_GIT_ARGS, ...args], {
        cwd, encoding: 'buffer', maxBuffer: this.maxTotalBytes + this.maxFileBytes,
        env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C', LANG: 'C' },
      });
      return result.stdout;
    } catch {
      throw new KnowledgeIndexBuildErrorV1('git-failed');
    }
  }

  private async repositoryRoot(candidate: string): Promise<string> {
    try {
      const physical = await realpath(candidate);
      if (!(await stat(physical)).isDirectory()) throw new Error('not-directory');
      const top = path.resolve(
        (await this.git(physical, ['rev-parse', '--show-toplevel']))
          .toString('utf8')
          .trim()
      );
      if (top !== physical) throw new Error('not-root');
      return physical;
    } catch {
      throw new KnowledgeIndexBuildErrorV1('invalid-repository');
    }
  }
}

export async function readKnowledgeIndexArtifactV1(
  artifactPath: string,
  expectedSha256: string
): Promise<KnowledgeIndexArtifactV1> {
  const bytes = await readFile(artifactPath);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256) {
    throw new KnowledgeIndexBuildErrorV1('write-failed');
  }
  const parsed = safeJsonParse<unknown>(bytes.toString('utf8'), null);
  if (!isArtifact(parsed)) throw new KnowledgeIndexBuildErrorV1('write-failed');
  return parsed;
}

function parseTree(value: Buffer): Array<{ path: string; blobSha: string }> {
  return value.toString('utf8').split('\0').filter(Boolean).flatMap((entry) => {
    const match = entry.match(/^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) return [];
    return [{ blobSha: match[2], path: match[3] }];
  });
}

function isUtf8Text(value: Buffer): boolean {
  if (value.includes(0)) return false;
  return !value.toString('utf8').includes('�');
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortJson(child)])
  );
}

async function verifyExisting(filePath: string, digest: string): Promise<boolean> {
  try {
    const bytes = await readFile(filePath);
    if (createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw new KnowledgeIndexBuildErrorV1('write-failed');
    }
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function validateInput(input: KnowledgeIndexBuilderInputV1): void {
  if (
    !path.isAbsolute(input.repositoryPath) ||
    /[\r\n\0]/.test(input.repositoryPath) ||
    !input.spaceId.trim() ||
    !input.indexVersion.trim() ||
    !OBJECT_ID.test(input.commitSha)
  ) {
    throw new KnowledgeIndexBuildErrorV1('invalid-input');
  }
}

function safeComponent(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new KnowledgeIndexBuildErrorV1('invalid-input');
  }
  return value;
}

function isArtifact(value: unknown): value is KnowledgeIndexArtifactV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.indexVersion === 'string' &&
    typeof record.commitSha === 'string' && Array.isArray(record.documents) &&
    record.documents.every((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const item = entry as Record<string, unknown>;
      return typeof item.path === 'string' && typeof item.blobSha === 'string' &&
        typeof item.byteLength === 'number' && typeof item.content === 'string' &&
        typeof item.contentSha256 === 'string';
    });
}
