import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AuthOperationOptions,
  Credential,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { ensurePlatformDirectories, getPlatformPaths } from '@/lib/platform/paths';
import {
  deleteCredentialEntry,
  modifyCredentialEntry,
  readCredentialMap,
} from '../../../scripts/oauth-credential-file.mjs';

function getOAuthPaths() {
  ensurePlatformDirectories();
  const { oauthDir } = getPlatformPaths();

  return {
    authStorePath: path.join(oauthDir, 'auth.json'),
    legacyOpenAICodexPath: path.join(oauthDir, 'openai-codex.json'),
  };
}

type OAuthProviderId =
  | 'anthropic'
  | 'openai-codex'
  | 'github-copilot'
  | 'google-gemini-cli'
  | 'google-antigravity';

type OAuthAuthMap = Record<string, Record<string, unknown>>;
type OAuthProviderSummary = {
  email: string | null;
  planType: string | null;
  providerId: string;
  savedAt: string | null;
};

class FileOAuthCredentialStore implements CredentialStore {
  private mutationChain = Promise.resolve();

  async read(providerId: string, options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    const auth = await readOAuthAuthMap();
    options?.signal?.throwIfAborted();
    const stored = normalizeCredential(auth[providerId]);
    if (stored || providerId !== 'openai-codex') {
      return stored;
    }

    const legacy = await readLegacyOpenAICodexCredentials();
    options?.signal?.throwIfAborted();
    return normalizeCredential(legacy);
  }

  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    const auth = await readOAuthAuthMap();
    const credentials = Object.entries(auth).flatMap(([providerId, value]) => {
      const credential = normalizeCredential(value);
      return credential ? [{ providerId, type: credential.type }] : [];
    });

    if (!credentials.some(({ providerId }) => providerId === 'openai-codex')) {
      const legacy = normalizeCredential(await readLegacyOpenAICodexCredentials());
      if (legacy) {
        credentials.push({ providerId: 'openai-codex', type: legacy.type });
      }
    }

    options?.signal?.throwIfAborted();
    return credentials;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ) {
    return this.enqueue(async () => {
      const { authStorePath } = getOAuthPaths();
      const persisted = await modifyCredentialEntry(
        authStorePath,
        providerId,
        async (stored: unknown) => {
          options?.signal?.throwIfAborted();
          let current = normalizeCredential(stored);
          if (!current && providerId === 'openai-codex') {
            current = normalizeCredential(await readLegacyOpenAICodexCredentials());
          }

          const next = await fn(current);
          options?.signal?.throwIfAborted();
          if (next === undefined) {
            return current as unknown as Record<string, unknown> | undefined;
          }

          return addCredentialMetadata(next, current) as unknown as Record<
            string,
            unknown
          >;
        },
        { signal: options?.signal }
      );
      options?.signal?.throwIfAborted();
      return normalizeCredential(persisted);
    });
  }

  delete(providerId: string, options?: AuthOperationOptions) {
    return this.enqueue(async () => {
      const { authStorePath } = getOAuthPaths();
      await deleteCredentialEntry(authStorePath, providerId, {
        afterDelete:
          providerId === 'openai-codex'
            ? removeLegacyOpenAICodexCredentials
            : undefined,
        signal: options?.signal,
      });
      options?.signal?.throwIfAborted();
    });
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const queued = this.mutationChain.catch(() => undefined).then(operation);
    this.mutationChain = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }
}

/** File-backed credentials shared by every pi-ai Models collection in this app. */
export const oauthCredentialStore: CredentialStore = new FileOAuthCredentialStore();

export async function getConfiguredOAuthProviders() {
  const auth = await readOAuthAuthMap();
  const providers = Object.entries(auth).flatMap(([providerId, credentials]) =>
    normalizeCredential(credentials)?.type === 'oauth'
      ? [summarizeOAuthProvider(providerId, credentials)]
      : []
  );

  if (!providers.find(provider => provider.providerId === 'openai-codex')) {
    const legacy = await readLegacyOpenAICodexCredentials();
    if (normalizeCredential(legacy)?.type === 'oauth' && legacy) {
      providers.push(summarizeOAuthProvider('openai-codex', legacy));
    }
  }

  return providers.sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export async function saveOAuthCredentials(
  providerId: OAuthProviderId,
  credentials: Record<string, unknown>
) {
  const credential = normalizeCredential({ type: 'oauth', ...credentials });
  if (credential?.type !== 'oauth') {
    throw new Error(`Invalid OAuth credentials for ${providerId}`);
  }
  await oauthCredentialStore.modify(providerId, async () => credential);
}

export async function removeOAuthCredentials(providerId: OAuthProviderId) {
  await oauthCredentialStore.delete(providerId);
}

async function readOAuthAuthMap(): Promise<OAuthAuthMap> {
  const { authStorePath } = getOAuthPaths();
  return readCredentialMap(authStorePath) as Promise<OAuthAuthMap>;
}

async function readLegacyOpenAICodexCredentials() {
  const { legacyOpenAICodexPath } = getOAuthPaths();

  try {
    const raw = await fs.readFile(legacyOpenAICodexPath, 'utf8');
    return asRecord(safeJsonParse<unknown>(raw, null));
  } catch {
    return null;
  }
}

async function removeLegacyOpenAICodexCredentials() {
  const { legacyOpenAICodexPath } = getOAuthPaths();
  try {
    await fs.unlink(legacyOpenAICodexPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function normalizeCredential(value: unknown): Credential | undefined {
  const credential = asRecord(value);
  if (!credential) {
    return undefined;
  }
  if (credential.type === 'api_key') {
    return credential as unknown as Credential;
  }

  const access = stringValue(credential.access) ?? stringValue(credential.accessToken);
  const refresh = stringValue(credential.refresh) ?? stringValue(credential.refreshToken);
  const expires = numberValue(credential.expires) ?? numberValue(credential.expiresAt);
  if (!access || refresh === undefined || expires === undefined) {
    return undefined;
  }

  return {
    ...credential,
    type: 'oauth',
    access,
    refresh,
    expires,
  } as OAuthCredential;
}

function addCredentialMetadata(next: Credential, current?: Credential) {
  if (next.type !== 'oauth') {
    return next;
  }
  return {
    ...next,
    savedAt:
      asString(next.savedAt) ||
      (current?.type === 'oauth' ? asString(current.savedAt) : '') ||
      new Date().toISOString(),
  };
}

function summarizeOAuthProvider(
  providerId: string,
  credentials: Record<string, unknown>
): OAuthProviderSummary {
  const claims = decodeJwtClaims(credentials.access) || decodeJwtClaims(credentials.accessToken);
  const profile = asRecord(claims?.['https://api.openai.com/profile']);
  const auth = asRecord(claims?.['https://api.openai.com/auth']);

  return {
    providerId,
    savedAt: asString(credentials.savedAt) || null,
    email: asString(profile?.email) || null,
    planType: asString(auth?.chatgpt_plan_type) || null,
  };
}

function decodeJwtClaims(token: unknown) {
  const value = asString(token);
  if (!value) {
    return null;
  }

  try {
    const parts = value.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');

    return safeJsonParse<Record<string, unknown> | null>(
      Buffer.from(payload, 'base64').toString('utf8'),
      null
    );
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }
  return undefined;
}
