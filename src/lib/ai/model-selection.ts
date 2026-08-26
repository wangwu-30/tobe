export const DEFAULT_MODEL_KEY = buildModelKey('openai-codex', 'gpt-5.4');

const LEGACY_DEFAULT_MODEL_KEY = buildModelKey(
  'openai-codex',
  'gpt-5.2-codex'
);

export function buildModelKey(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function parseModelKey(modelKey?: string | null) {
  const normalized = normalizeModelKey(modelKey) || DEFAULT_MODEL_KEY;
  const migrated =
    normalized === LEGACY_DEFAULT_MODEL_KEY ? DEFAULT_MODEL_KEY : normalized;
  const separatorIndex = migrated.indexOf('::');

  if (separatorIndex === -1) {
    return {
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
      key: DEFAULT_MODEL_KEY,
    };
  }

  return {
    providerId: migrated.slice(0, separatorIndex),
    modelId: migrated.slice(separatorIndex + 2),
    key: migrated,
  };
}

function normalizeModelKey(modelKey?: string | null) {
  const candidate = modelKey?.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.includes('::')) {
    return candidate;
  }

  if (candidate.startsWith('anthropic/')) {
    return buildModelKey('anthropic', candidate.slice('anthropic/'.length));
  }

  if (candidate.startsWith('openai/')) {
    return buildModelKey('openai', candidate.slice('openai/'.length));
  }

  if (candidate.startsWith('claude-')) {
    return buildModelKey('anthropic', candidate);
  }

  if (
    candidate.startsWith('gpt-') ||
    candidate.startsWith('o1') ||
    candidate.startsWith('codex-')
  ) {
    return buildModelKey('openai', candidate);
  }

  throw new Error(`Unrecognized model selection: ${candidate}`);
}
