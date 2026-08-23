import fs from 'node:fs/promises';
import path from 'node:path';
import { getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { ensurePlatformDirectories, getPlatformPaths } from '@/lib/platform/paths';

function getOAuthPaths() {
  ensurePlatformDirectories();
  const { oauthDir } = getPlatformPaths();

  return {
    authStorePath: path.join(oauthDir, 'auth.json'),
    legacyOpenAICodexPath: path.join(oauthDir, 'openai-codex.json'),
    oauthDir,
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

export interface OAuthCredentialStore {
  getConfiguredProviders(): Promise<OAuthProviderSummary[]>;
  getProviderApiKey(providerId: OAuthProviderId): Promise<{
    apiKey: string;
    savedAt: string | null;
  } | null>;
  saveCredentials(
    providerId: OAuthProviderId,
    credentials: Record<string, unknown>
  ): Promise<void>;
}

export async function getOAuthApiKeyForProvider(providerId: OAuthProviderId) {
  const auth = await readOAuthAuthMap();
  if (!auth[providerId] && providerId === 'openai-codex') {
    const legacy = await readLegacyOpenAICodexCredentials();
    if (legacy) {
      auth[providerId] = legacy;
    }
  }

  if (!auth[providerId]) {
    return null;
  }

  const result = await getOAuthApiKey(providerId, auth as never);
  if (!result) {
    return null;
  }

  auth[providerId] = { type: 'oauth', ...result.newCredentials };
  await writeOAuthAuthMap(auth);

  return {
    apiKey: result.apiKey,
    savedAt: (auth[providerId]?.savedAt as string | undefined) || null,
  };
}

export async function getConfiguredOAuthProviders() {
  const auth = await readOAuthAuthMap();
  const providers = Object.entries(auth).map(([providerId, credentials]) =>
    summarizeOAuthProvider(providerId, credentials)
  );

  if (!providers.find(provider => provider.providerId === 'openai-codex')) {
    const legacy = await readLegacyOpenAICodexCredentials();
    if (legacy) {
      providers.push(summarizeOAuthProvider('openai-codex', legacy));
    }
  }

  return providers.sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export async function saveOAuthCredentials(
  providerId: OAuthProviderId,
  credentials: Record<string, unknown>
) {
  const auth = await readOAuthAuthMap();
  auth[providerId] = {
    type: 'oauth',
    ...credentials,
    savedAt: credentials.savedAt || new Date().toISOString(),
  };
  await writeOAuthAuthMap(auth);
}

export async function removeOAuthCredentials(providerId: OAuthProviderId) {
  const auth = await readOAuthAuthMap();
  delete auth[providerId];
  await writeOAuthAuthMap(auth);

  if (providerId === 'openai-codex') {
    const { legacyOpenAICodexPath } = getOAuthPaths();
    try {
      await fs.unlink(legacyOpenAICodexPath);
    } catch {
      // Ignore missing legacy credential files.
    }
  }
}

async function readOAuthAuthMap(): Promise<OAuthAuthMap> {
  const { authStorePath } = getOAuthPaths();

  try {
    const raw = await fs.readFile(authStorePath, 'utf8');
    return safeJsonParse<OAuthAuthMap>(raw, {});
  } catch {
    return {};
  }
}

async function writeOAuthAuthMap(auth: OAuthAuthMap) {
  const { authStorePath, oauthDir } = getOAuthPaths();
  await fs.mkdir(oauthDir, { recursive: true });
  await fs.writeFile(authStorePath, JSON.stringify(auth, null, 2));
}

async function readLegacyOpenAICodexCredentials() {
  const { legacyOpenAICodexPath } = getOAuthPaths();

  try {
    const raw = await fs.readFile(legacyOpenAICodexPath, 'utf8');
    const credentials = safeJsonParse<Record<string, unknown> | null>(raw, null);
    if (!credentials) {
      return null;
    }
    return {
      type: 'oauth',
      ...credentials,
    };
  } catch {
    return null;
  }
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

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
