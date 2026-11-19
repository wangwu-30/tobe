import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { createClient } from '@libsql/client';

import type { Prisma, PrismaClient } from '@/generated/prisma/client';

import { chunkKnowledgeDocument } from './chunker';
import {
  isSqliteArtifactBytes,
  readKnowledgeIndexArtifactV1,
  type KnowledgeIndexDocumentV1,
} from './index-builder';

const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_HIT_LIMIT = 6;
const MAX_HIT_LIMIT = 24;
const DEFAULT_SNIPPET_CHARS = 1_200;
const MAX_SNIPPET_CHARS = 4_000;
const DEFAULT_READ_MAX_CHARS = 6_000;
const MAX_READ_CHARS = 12_000;
const MAX_LEGACY_JSON_DOCUMENTS = 512;

export const KNOWLEDGE_RETRIEVAL_TRUST_V1 = {
  level: 'untrusted',
  origin: 'retrieval',
  usage: 'data-only',
} as const;

export type KnowledgeRetrievalTrustV1 = typeof KNOWLEDGE_RETRIEVAL_TRUST_V1;

export type KnowledgeArtifactSearchHitV1 = {
  chunkIndex: number;
  contentSha256: string;
  endOffset: number;
  heading: string;
  path: string;
  score: number;
  snippet: string;
  startOffset: number;
};

export type KnowledgeArtifactDocumentReadV1 = {
  blobSha: string;
  byteLength: number;
  commitSha: string;
  content: string;
  contentSha256: string;
  hasMore: boolean;
  indexVersion: string;
  nextOffsetChars: number | null;
  offsetChars: number;
  path: string;
  totalChars: number;
};

export type BoundKnowledgeSearchHitV1 = KnowledgeArtifactSearchHitV1 & {
  bindingId: string;
  commitSha: string;
  indexVersion: string;
  mountPath: string;
  snapshotId: string;
  spaceId: string;
  trust: KnowledgeRetrievalTrustV1;
};

export type BoundKnowledgeDocumentReadV1 = KnowledgeArtifactDocumentReadV1 & {
  bindingId: string;
  mountPath: string;
  snapshotId: string;
  spaceId: string;
  trust: KnowledgeRetrievalTrustV1;
};

type KnowledgeBindingSnapshotRow = {
  artifactPath: string;
  artifactSha256: string;
  bindingId: string;
  bindingUpdatedAt: Date | string;
  commitSha: string;
  indexVersion: string;
  mountPath: string;
  readyAt: Date | string;
  snapshotId: string;
  spaceId: string;
  spaceUpdatedAt: Date | string;
};

export type KnowledgeQueryDb =
  | PrismaClient
  | Prisma.TransactionClient
  | {
      $queryRaw<T = unknown>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<T>;
    };

async function resolveQueryDb(db?: KnowledgeQueryDb): Promise<KnowledgeQueryDb> {
  if (db) return db;
  const { getPrismaClient } = await import('@/lib/db/prisma');
  return getPrismaClient();
}

/**
 * Searches a single verified knowledge snapshot artifact on disk.
 * For SQLite FTS5 artifacts, executes BM25 queries directly via SQLite without
 * loading the full repository into the Node heap. Legacy v1 JSON artifacts remain
 * supported via the verified JSON reader.
 */
export async function searchKnowledgeIndexArtifact(input: {
  artifactPath: string;
  expectedCommitSha: string;
  expectedIndexVersion: string;
  expectedSha256: string;
  limit?: number;
  maxArtifactBytes?: number;
  maxSnippetChars?: number;
  query: string;
}): Promise<KnowledgeArtifactSearchHitV1[]> {
  const limit = clampInteger(input.limit ?? DEFAULT_HIT_LIMIT, 1, MAX_HIT_LIMIT);
  const maxSnippetChars = clampInteger(
    input.maxSnippetChars ?? DEFAULT_SNIPPET_CHARS,
    120,
    MAX_SNIPPET_CHARS
  );
  const maxArtifactBytes = input.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;

  const verified = await verifyArtifactFile(
    input.artifactPath,
    input.expectedSha256,
    maxArtifactBytes
  );
  if (!verified.valid) return [];

  if (verified.isSqlite) {
    return searchSqliteFts5Artifact({
      artifactPath: input.artifactPath,
      expectedCommitSha: input.expectedCommitSha,
      expectedIndexVersion: input.expectedIndexVersion,
      limit,
      maxSnippetChars,
      query: input.query,
    });
  }

  return searchLegacyJsonArtifact({
    artifactPath: input.artifactPath,
    expectedCommitSha: input.expectedCommitSha,
    expectedIndexVersion: input.expectedIndexVersion,
    expectedSha256: input.expectedSha256,
    limit,
    maxSnippetChars,
    query: input.query,
  });
}

/**
 * Reads a bounded UTF-16 character window of a single document inside a verified
 * knowledge snapshot artifact (SQLite FTS5 or legacy v1 JSON).
 */
export async function readKnowledgeIndexDocument(input: {
  artifactPath: string;
  documentPath: string;
  expectedCommitSha: string;
  expectedIndexVersion: string;
  expectedSha256: string;
  maxArtifactBytes?: number;
  maxChars?: number;
  offsetChars?: number;
}): Promise<KnowledgeArtifactDocumentReadV1 | null> {
  const normalizedPath = normalizeDocumentPath(input.documentPath);
  if (!normalizedPath) return null;

  const offsetChars = Math.max(0, Math.floor(input.offsetChars ?? 0));
  const maxChars = clampInteger(
    input.maxChars ?? DEFAULT_READ_MAX_CHARS,
    200,
    MAX_READ_CHARS
  );
  const maxArtifactBytes = input.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;

  const verified = await verifyArtifactFile(
    input.artifactPath,
    input.expectedSha256,
    maxArtifactBytes
  );
  if (!verified.valid) return null;

  if (verified.isSqlite) {
    const client = createClient({ url: `file:${input.artifactPath}` });
    try {
      const meta = await readSqliteMetadata(client);
      if (
        meta.commitSha !== input.expectedCommitSha ||
        meta.indexVersion !== input.expectedIndexVersion
      ) {
        return null;
      }
      const result = await client.execute({
        args: [normalizedPath],
        sql: 'SELECT path, blob_sha, byte_length, content, content_sha256 FROM documents WHERE path = ? LIMIT 1',
      });
      const row = result.rows[0];
      if (!row) return null;
      const doc: KnowledgeIndexDocumentV1 = {
        blobSha: String(row.blob_sha),
        byteLength: Number(row.byte_length),
        content: String(row.content),
        contentSha256: String(row.content_sha256),
        path: String(row.path),
      };
      if (!verifyDocumentIntegrity(doc)) return null;
      return sliceDocumentWindow(
        doc,
        meta.commitSha,
        meta.indexVersion,
        offsetChars,
        maxChars
      );
    } finally {
      client.close();
    }
  }

  const artifact = await readKnowledgeIndexArtifactV1(
    input.artifactPath,
    input.expectedSha256
  );
  if (
    artifact.commitSha !== input.expectedCommitSha ||
    artifact.indexVersion !== input.expectedIndexVersion
  ) {
    return null;
  }
  const doc = artifact.documents.find((item) => item.path === normalizedPath);
  if (!doc || !verifyDocumentIntegrity(doc)) return null;
  return sliceDocumentWindow(
    doc,
    artifact.commitSha,
    artifact.indexVersion,
    offsetChars,
    maxChars
  );
}

/**
 * Live-ACL-verified search across all ready Git Knowledge snapshots bound to a
 * workspace/project (and optionally an agent's own private knowledge space).
 */
export async function searchBoundKnowledgeForScope(input: {
  agentId?: string | null;
  bindingLimit?: number;
  limit?: number;
  maxArtifactBytes?: number;
  maxSnippetChars?: number;
  now?: Date;
  organizationId: string;
  prisma?: KnowledgeQueryDb;
  projectId?: string | null;
  query: string;
  spaceId?: string | null;
  workspaceId: string;
}): Promise<BoundKnowledgeSearchHitV1[]> {
  const db = await resolveQueryDb(input.prisma);
  const limit = clampInteger(input.limit ?? DEFAULT_HIT_LIMIT, 1, MAX_HIT_LIMIT);
  const bindings = await loadAuthorizedKnowledgeBindings(db, {
    agentId: input.agentId ?? null,
    bindingLimit: input.bindingLimit ?? 8,
    now: input.now ?? new Date(),
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    spaceId: input.spaceId ?? null,
    workspaceId: input.workspaceId,
  });

  const hits: BoundKnowledgeSearchHitV1[] = [];
  const seenSpaces = new Set<string>();
  for (const row of bindings) {
    if (seenSpaces.has(row.spaceId)) continue;
    seenSpaces.add(row.spaceId);

    let spaceHits: KnowledgeArtifactSearchHitV1[];
    try {
      spaceHits = await searchKnowledgeIndexArtifact({
        artifactPath: row.artifactPath,
        expectedCommitSha: row.commitSha,
        expectedIndexVersion: row.indexVersion,
        expectedSha256: row.artifactSha256,
        limit,
        maxArtifactBytes: input.maxArtifactBytes,
        maxSnippetChars: input.maxSnippetChars,
        query: input.query,
      });
    } catch {
      continue;
    }

    for (const hit of spaceHits) {
      hits.push({
        ...hit,
        bindingId: row.bindingId,
        commitSha: row.commitSha,
        indexVersion: row.indexVersion,
        mountPath: row.mountPath,
        snapshotId: row.snapshotId,
        spaceId: row.spaceId,
        trust: KNOWLEDGE_RETRIEVAL_TRUST_V1,
      });
    }
  }

  return hits
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.spaceId, right.spaceId) ||
        compareText(left.path, right.path) ||
        left.chunkIndex - right.chunkIndex
    )
    .slice(0, limit);
}

/**
 * Live-ACL-verified bounded read of a single document from an authorized,
 * ready Git Knowledge snapshot bound to the workspace/project.
 */
export async function readBoundKnowledgeDocumentForScope(input: {
  agentId?: string | null;
  documentPath: string;
  maxArtifactBytes?: number;
  maxChars?: number;
  now?: Date;
  offsetChars?: number;
  organizationId: string;
  prisma?: KnowledgeQueryDb;
  projectId?: string | null;
  spaceId: string;
  workspaceId: string;
}): Promise<BoundKnowledgeDocumentReadV1 | null> {
  const spaceId = input.spaceId.trim();
  if (!spaceId) return null;

  const db = await resolveQueryDb(input.prisma);
  const bindings = await loadAuthorizedKnowledgeBindings(db, {
    agentId: input.agentId ?? null,
    bindingLimit: 4,
    now: input.now ?? new Date(),
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    spaceId,
    workspaceId: input.workspaceId,
  });
  const binding = bindings[0];
  if (!binding) return null;

  const read = await readKnowledgeIndexDocument({
    artifactPath: binding.artifactPath,
    documentPath: input.documentPath,
    expectedCommitSha: binding.commitSha,
    expectedIndexVersion: binding.indexVersion,
    expectedSha256: binding.artifactSha256,
    maxArtifactBytes: input.maxArtifactBytes,
    maxChars: input.maxChars,
    offsetChars: input.offsetChars,
  });
  if (!read) return null;

  return {
    ...read,
    bindingId: binding.bindingId,
    mountPath: binding.mountPath,
    snapshotId: binding.snapshotId,
    spaceId: binding.spaceId,
    trust: KNOWLEDGE_RETRIEVAL_TRUST_V1,
  };
}

async function loadAuthorizedKnowledgeBindings(
  db: KnowledgeQueryDb,
  input: {
    agentId: string | null;
    bindingLimit: number;
    now: Date;
    organizationId: string;
    projectId: string | null;
    spaceId: string | null;
    workspaceId: string;
  }
): Promise<KnowledgeBindingSnapshotRow[]> {
  const scopeProjectId = input.projectId?.trim() || input.workspaceId;
  const requestedSpaceId = input.spaceId?.trim() || null;

  const rows = input.agentId
    ? await db.$queryRaw<KnowledgeBindingSnapshotRow[]>`
        SELECT
          binding."id" AS "bindingId",
          binding."mountPath" AS "mountPath",
          binding."updatedAt" AS "bindingUpdatedAt",
          space."id" AS "spaceId",
          space."updatedAt" AS "spaceUpdatedAt",
          snapshot."id" AS "snapshotId",
          snapshot."commitSha" AS "commitSha",
          snapshot."indexVersion" AS "indexVersion",
          snapshot."artifactPath" AS "artifactPath",
          snapshot."artifactSha256" AS "artifactSha256",
          snapshot."readyAt" AS "readyAt"
        FROM "KnowledgeBinding" AS binding
        INNER JOIN "Document" AS workspace
          ON workspace."id" = binding."workspaceId"
          AND workspace."organizationId" = binding."organizationId"
          AND workspace."deletedAt" IS NULL
        INNER JOIN "KnowledgeSpace" AS space
          ON space."id" = binding."spaceId"
          AND space."organizationId" = binding."organizationId"
        INNER JOIN "KnowledgeSnapshot" AS snapshot
          ON snapshot."id" = space."activeSnapshotId"
          AND snapshot."spaceId" = space."id"
          AND snapshot."organizationId" = space."organizationId"
        WHERE binding."organizationId" = ${input.organizationId}
          AND (
            workspace."id" = ${input.workspaceId}
            OR workspace."id" = ${scopeProjectId}
            OR workspace."projectId" = ${scopeProjectId}
          )
          AND binding."access" IN ('read', 'propose')
          AND snapshot."readyAt" <= ${input.now}
          AND (${requestedSpaceId} IS NULL OR space."id" = ${requestedSpaceId})
          AND (
            (
              space."scope" = 'team'
              AND space."ownerAgentId" IS NULL
              AND space."readPolicy" = 'team'
              AND binding."agentId" IS NULL
            )
            OR
            (
              space."scope" = 'agent'
              AND space."ownerAgentId" = ${input.agentId}
              AND space."readPolicy" = 'owner'
              AND binding."agentId" = ${input.agentId}
            )
          )
        ORDER BY
          CASE WHEN binding."agentId" IS NULL THEN 1 ELSE 0 END ASC,
          binding."id" ASC
        LIMIT ${input.bindingLimit}
      `
    : await db.$queryRaw<KnowledgeBindingSnapshotRow[]>`
        SELECT
          binding."id" AS "bindingId",
          binding."mountPath" AS "mountPath",
          binding."updatedAt" AS "bindingUpdatedAt",
          space."id" AS "spaceId",
          space."updatedAt" AS "spaceUpdatedAt",
          snapshot."id" AS "snapshotId",
          snapshot."commitSha" AS "commitSha",
          snapshot."indexVersion" AS "indexVersion",
          snapshot."artifactPath" AS "artifactPath",
          snapshot."artifactSha256" AS "artifactSha256",
          snapshot."readyAt" AS "readyAt"
        FROM "KnowledgeBinding" AS binding
        INNER JOIN "Document" AS workspace
          ON workspace."id" = binding."workspaceId"
          AND workspace."organizationId" = binding."organizationId"
          AND workspace."deletedAt" IS NULL
        INNER JOIN "KnowledgeSpace" AS space
          ON space."id" = binding."spaceId"
          AND space."organizationId" = binding."organizationId"
        INNER JOIN "KnowledgeSnapshot" AS snapshot
          ON snapshot."id" = space."activeSnapshotId"
          AND snapshot."spaceId" = space."id"
          AND snapshot."organizationId" = space."organizationId"
        WHERE binding."organizationId" = ${input.organizationId}
          AND (
            workspace."id" = ${input.workspaceId}
            OR workspace."id" = ${scopeProjectId}
            OR workspace."projectId" = ${scopeProjectId}
          )
          AND binding."access" IN ('read', 'propose')
          AND snapshot."readyAt" <= ${input.now}
          AND (${requestedSpaceId} IS NULL OR space."id" = ${requestedSpaceId})
          AND space."scope" = 'team'
          AND space."ownerAgentId" IS NULL
          AND space."readPolicy" = 'team'
          AND binding."agentId" IS NULL
        ORDER BY binding."id" ASC
        LIMIT ${input.bindingLimit}
      `;

  return rows.filter(
    (row) => path.isAbsolute(row.artifactPath) && SHA256.test(row.artifactSha256)
  );
}

async function searchSqliteFts5Artifact(input: {
  artifactPath: string;
  expectedCommitSha: string;
  expectedIndexVersion: string;
  limit: number;
  maxSnippetChars: number;
  query: string;
}): Promise<KnowledgeArtifactSearchHitV1[]> {
  const client = createClient({ url: `file:${input.artifactPath}` });
  try {
    const meta = await readSqliteMetadata(client);
    if (
      meta.commitSha !== input.expectedCommitSha ||
      meta.indexVersion !== input.expectedIndexVersion
    ) {
      return [];
    }

    const terms = extractSearchTerms(input.query);
    const ftsTokens = buildFtsUnicodeTokens(terms);
    const trigramTokens = buildTrigramTokens(input.query, terms);
    const shortCjkTerms = extractShortCjkTerms(input.query);
    const merged = new Map<string, KnowledgeArtifactSearchHitV1>();
    const candidateLimit = Math.min(48, input.limit * 4);

    if (ftsTokens.length > 0) {
      const matchQuery = ftsTokens.map(quoteFtsToken).join(' OR ');
      const result = await client.execute({
        args: [matchQuery, candidateLimit],
        sql: `
          SELECT
            c.path AS path,
            c.heading AS heading,
            c.chunk_index AS chunk_index,
            c.start_offset AS start_offset,
            c.end_offset AS end_offset,
            c.content AS content,
            d.content_sha256 AS content_sha256,
            bm25(chunks_fts, 2.0, 1.5, 1.0) AS rank_value
          FROM chunks_fts
          JOIN chunks c ON c.id = chunks_fts.rowid
          JOIN documents d ON d.id = c.document_id
          WHERE chunks_fts MATCH ?
          ORDER BY rank_value ASC, c.path ASC, c.chunk_index ASC
          LIMIT ?
        `,
      });
      for (const row of result.rows) {
        mergeSqliteHit(merged, row, bm25RankToScore(Number(row.rank_value)) + 1.0, input.maxSnippetChars, terms);
      }
    }

    if (trigramTokens.length > 0) {
      const matchQuery = trigramTokens.map(quoteFtsToken).join(' OR ');
      const result = await client.execute({
        args: [matchQuery, candidateLimit],
        sql: `
          SELECT
            c.path AS path,
            c.heading AS heading,
            c.chunk_index AS chunk_index,
            c.start_offset AS start_offset,
            c.end_offset AS end_offset,
            c.content AS content,
            d.content_sha256 AS content_sha256,
            bm25(chunks_trigram, 2.0, 1.5, 1.0) AS rank_value
          FROM chunks_trigram
          JOIN chunks c ON c.id = chunks_trigram.rowid
          JOIN documents d ON d.id = c.document_id
          WHERE chunks_trigram MATCH ?
          ORDER BY rank_value ASC, c.path ASC, c.chunk_index ASC
          LIMIT ?
        `,
      });
      for (const row of result.rows) {
        mergeSqliteHit(merged, row, bm25RankToScore(Number(row.rank_value)) + 0.8, input.maxSnippetChars, terms);
      }
    }

    // FTS5 trigram requires >= 3 characters, so 2-character CJK queries fall back
    // to deterministic bounded substring matching on chunks.
    if (shortCjkTerms.length > 0 && merged.size < input.limit) {
      for (const term of shortCjkTerms.slice(0, 6)) {
        const result = await client.execute({
          args: [term, term, term, candidateLimit],
          sql: `
            SELECT
              c.path AS path,
              c.heading AS heading,
              c.chunk_index AS chunk_index,
              c.start_offset AS start_offset,
              c.end_offset AS end_offset,
              c.content AS content,
              d.content_sha256 AS content_sha256
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE INSTR(c.content, ?) > 0
               OR INSTR(c.heading, ?) > 0
               OR INSTR(c.path, ?) > 0
            ORDER BY c.path ASC, c.chunk_index ASC
            LIMIT ?
          `,
        });
        for (const row of result.rows) {
          const text = `${String(row.path)}\n${String(row.heading)}\n${String(row.content)}`;
          mergeSqliteHit(
            merged,
            row,
            lexicalScore(text, terms) + 0.5,
            input.maxSnippetChars,
            terms
          );
        }
      }
    }

    if (merged.size === 0 && terms.length === 0) {
      const result = await client.execute({
        args: [input.limit],
        sql: `
          SELECT
            c.path AS path,
            c.heading AS heading,
            c.chunk_index AS chunk_index,
            c.start_offset AS start_offset,
            c.end_offset AS end_offset,
            c.content AS content,
            d.content_sha256 AS content_sha256
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
          ORDER BY c.path ASC, c.chunk_index ASC
          LIMIT ?
        `,
      });
      for (const row of result.rows) {
        mergeSqliteHit(merged, row, 0, input.maxSnippetChars, terms);
      }
    }

    return [...merged.values()]
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareText(left.path, right.path) ||
          left.chunkIndex - right.chunkIndex
      )
      .slice(0, input.limit);
  } finally {
    client.close();
  }
}

async function searchLegacyJsonArtifact(input: {
  artifactPath: string;
  expectedCommitSha: string;
  expectedIndexVersion: string;
  expectedSha256: string;
  limit: number;
  maxSnippetChars: number;
  query: string;
}): Promise<KnowledgeArtifactSearchHitV1[]> {
  const artifact = await readKnowledgeIndexArtifactV1(
    input.artifactPath,
    input.expectedSha256
  );
  if (
    artifact.commitSha !== input.expectedCommitSha ||
    artifact.indexVersion !== input.expectedIndexVersion
  ) {
    return [];
  }

  const terms = extractSearchTerms(input.query);
  const hits: KnowledgeArtifactSearchHitV1[] = [];
  for (const doc of artifact.documents.slice(0, MAX_LEGACY_JSON_DOCUMENTS)) {
    if (!verifyDocumentIntegrity(doc)) continue;
    const chunks = chunkKnowledgeDocument({
      content: doc.content,
      maxChunkChars: input.maxSnippetChars,
      path: doc.path,
    });
    for (const chunk of chunks) {
      const score = lexicalScore(
        `${doc.path}\n${chunk.heading}\n${chunk.content}`,
        terms
      );
      if (terms.length > 0 && score <= 0) continue;
      hits.push({
        chunkIndex: chunk.chunkIndex,
        contentSha256: doc.contentSha256,
        endOffset: chunk.endOffset,
        heading: chunk.heading,
        path: doc.path,
        score,
        snippet: clipSnippet(chunk.content, terms, input.maxSnippetChars),
        startOffset: chunk.startOffset,
      });
    }
  }

  return hits
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.path, right.path) ||
        left.chunkIndex - right.chunkIndex
    )
    .slice(0, input.limit);
}

function mergeSqliteHit(
  merged: Map<string, KnowledgeArtifactSearchHitV1>,
  row: Record<string, unknown>,
  score: number,
  maxSnippetChars: number,
  terms: readonly string[]
) {
  const docPath = String(row.path);
  const chunkIndex = Number(row.chunk_index);
  const key = `${docPath}#${chunkIndex}`;
  const content = String(row.content);
  const existing = merged.get(key);
  if (existing) {
    existing.score = Math.max(existing.score, score);
    return;
  }
  merged.set(key, {
    chunkIndex,
    contentSha256: String(row.content_sha256),
    endOffset: Number(row.end_offset),
    heading: String(row.heading),
    path: docPath,
    score,
    snippet: clipSnippet(content, terms, maxSnippetChars),
    startOffset: Number(row.start_offset),
  });
}

async function readSqliteMetadata(
  client: ReturnType<typeof createClient>
): Promise<{ commitSha: string; indexVersion: string }> {
  const result = await client.execute('SELECT key, value FROM metadata');
  const map = new Map(
    result.rows.map((row) => [String(row.key), String(row.value)])
  );
  return {
    commitSha: map.get('commitSha') ?? '',
    indexVersion: map.get('indexVersion') ?? '',
  };
}

async function verifyArtifactFile(
  artifactPath: string,
  expectedSha256: string,
  maxBytes: number
): Promise<{ isSqlite: boolean; valid: boolean }> {
  if (!path.isAbsolute(artifactPath) || !SHA256.test(expectedSha256)) {
    return { isSqlite: false, valid: false };
  }
  try {
    const metadata = await stat(artifactPath);
    if (!metadata.isFile() || metadata.size > maxBytes) {
      return { isSqlite: false, valid: false };
    }
    const { digest, header } = await hashFileStreaming(artifactPath);
    if (digest !== expectedSha256) {
      return { isSqlite: false, valid: false };
    }
    return { isSqlite: isSqliteArtifactBytes(header), valid: true };
  } catch {
    return { isSqlite: false, valid: false };
  }
}

function hashFileStreaming(
  filePath: string
): Promise<{ digest: string; header: Buffer }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      if (headerBytes < 16) {
        const needed = 16 - headerBytes;
        headerChunks.push(buffer.subarray(0, needed));
        headerBytes += Math.min(needed, buffer.length);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve({
        digest: hash.digest('hex'),
        header: Buffer.concat(headerChunks),
      });
    });
  });
}

function sliceDocumentWindow(
  doc: KnowledgeIndexDocumentV1,
  commitSha: string,
  indexVersion: string,
  offsetChars: number,
  maxChars: number
): KnowledgeArtifactDocumentReadV1 {
  const totalChars = doc.content.length;
  const clampedOffset = Math.min(offsetChars, totalChars);
  const end = Math.min(totalChars, clampedOffset + maxChars);
  const hasMore = end < totalChars;
  return {
    blobSha: doc.blobSha,
    byteLength: doc.byteLength,
    commitSha,
    content: doc.content.slice(clampedOffset, end),
    contentSha256: doc.contentSha256,
    hasMore,
    indexVersion,
    nextOffsetChars: hasMore ? end : null,
    offsetChars: clampedOffset,
    path: doc.path,
    totalChars,
  };
}

function verifyDocumentIntegrity(document: KnowledgeIndexDocumentV1): boolean {
  return (
    document.path.trim().length > 0 &&
    document.path.length <= 4_096 &&
    /^[a-f0-9]{40,64}$/.test(document.blobSha) &&
    SHA256.test(document.contentSha256) &&
    document.contentSha256 ===
      createHash('sha256').update(document.content, 'utf8').digest('hex') &&
    document.byteLength === Buffer.byteLength(document.content, 'utf8')
  );
}

function normalizeDocumentPath(value: string): string | null {
  const normalized = value.trim().replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.length > 4_096 ||
    normalized.includes('\0') ||
    normalized.includes('..')
  ) {
    return null;
  }
  return normalized;
}

function extractSearchTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  const cjkRuns = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const terms = [...words];
  for (const run of cjkRuns) {
    terms.push(run);
    for (let index = 0; index + 1 < run.length; index += 1) {
      terms.push(run.slice(index, index + 2));
    }
  }
  return [...new Set(terms)]
    .sort((left, right) => right.length - left.length || compareText(left, right))
    .slice(0, 16);
}

function buildFtsUnicodeTokens(terms: readonly string[]): string[] {
  return terms
    .filter((term) => /[a-z0-9]/i.test(term) && !/[\p{Script=Han}]/u.test(term))
    .map((term) => term.replace(/[^a-z0-9_-]+/gi, ''))
    .filter((term) => term.length >= 2)
    .slice(0, 10);
}

function buildTrigramTokens(query: string, terms: readonly string[]): string[] {
  const normalized = query.normalize('NFKC');
  const cjkRuns = normalized.match(/[\p{Script=Han}]{3,}/gu) ?? [];
  const longTerms = terms.filter((term) => term.length >= 3);
  return [...new Set([...cjkRuns, ...longTerms])]
    .map((token) => token.replace(/"/g, '').trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
}

function extractShortCjkTerms(query: string): string[] {
  const normalized = query.normalize('NFKC');
  const runs = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const results: string[] = [];
  for (const run of runs) {
    if (run.length === 2) {
      results.push(run);
    } else {
      for (let index = 0; index + 1 < run.length; index += 1) {
        results.push(run.slice(index, index + 2));
      }
    }
  }
  return [...new Set(results)].slice(0, 8);
}

function quoteFtsToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function bm25RankToScore(rankValue: number): number {
  if (!Number.isFinite(rankValue)) return 0;
  // SQLite bm25() returns more negative values for stronger matches; invert
  // into a positive bounded score so higher always means more relevant.
  return 1 / (1 + Math.exp(rankValue));
}

function lexicalScore(value: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) {
      score += 1 + Math.min(term.length, 16) / 16;
    }
  }
  return score;
}

function clipSnippet(
  value: string,
  terms: readonly string[],
  maxChars: number
): string {
  if (value.length <= maxChars) return value;
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const matches = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0);
  const anchor = matches.length > 0 ? Math.min(...matches) : 0;
  const start = Math.max(
    0,
    Math.min(value.length - maxChars, anchor - Math.floor(maxChars / 4))
  );
  return value.slice(start, start + maxChars);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
