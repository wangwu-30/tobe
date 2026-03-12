import type { AppLanguage } from '@/lib/i18n/language';

export type AIErrorInfo = {
  detail: string;
  kind: 'auth' | 'empty' | 'generic' | 'network' | 'quota';
  message: string;
  retryable: boolean;
  showSettings: boolean;
  statusCode: number;
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  'openai-codex': 'OpenAI Codex',
  openai: 'OpenAI',
};

export function describeAIError(params: {
  language?: AppLanguage;
  modelId?: string | null;
  modelKey?: string | null;
  providerId?: string | null;
  rawMessage: string;
}) {
  const language = params.language || 'zh-CN';
  const detail =
    params.rawMessage.trim() ||
    (language === 'zh-CN' ? 'AI 请求失败。' : 'AI request failed.');
  const { modelId, providerId } = resolveModelDescriptor(params);
  const providerLabel =
    (providerId ? PROVIDER_LABELS[providerId] : null) ||
    providerId ||
    (language === 'zh-CN' ? 'AI provider' : 'AI provider');
  const modelLabel = modelId || (language === 'zh-CN' ? '当前模型' : 'the selected model');
  const retryHint = extractRetryHint(detail);
  const planHint = extractPlanHint(detail);
  const providerWithPlan = planHint
    ? `${providerLabel}${language === 'zh-CN' ? `（${planHint}）` : ` (${planHint})`}`
    : providerLabel;

  if (isQuotaError(detail)) {
    return {
      detail,
      kind: 'quota',
      message:
        language === 'zh-CN'
          ? `${providerWithPlan} 在 ${modelLabel} 上已触达使用限制。${
              retryHint ? `请在 ${retryHint} 后再试。` : ''
            }请到设置中断开或切换账户。`
          : `${providerWithPlan} has hit its usage limit for ${modelLabel}.${
              retryHint ? ` Try again in ${retryHint}.` : ''
            } Disconnect or switch account in Settings.`,
      retryable: true,
      showSettings: true,
      statusCode: 429,
    } satisfies AIErrorInfo;
  }

  if (isAuthError(detail)) {
    return {
      detail,
      kind: 'auth',
      message:
        language === 'zh-CN'
          ? `${providerLabel} 对 ${modelLabel} 的授权已失效。请到设置中重新连接或切换账户。`
          : `${providerLabel} is no longer authorized for ${modelLabel}. Reconnect or switch account in Settings.`,
      retryable: true,
      showSettings: true,
      statusCode: 401,
    } satisfies AIErrorInfo;
  }

  if (isEmptyReplyError(detail)) {
    return {
      detail,
      kind: 'empty',
      message:
        language === 'zh-CN'
          ? `${providerLabel} 在 ${modelLabel} 上结束了请求，但没有返回可见内容。先重试一次；如果还会出现，请到设置中切换模型或账户。`
          : `${providerLabel} finished ${modelLabel} without a visible reply. Retry once; if it repeats, switch model or account in Settings.`,
      retryable: true,
      showSettings: true,
      statusCode: 502,
    } satisfies AIErrorInfo;
  }

  if (isNetworkError(detail)) {
    return {
      detail,
      kind: 'network',
      message:
        language === 'zh-CN'
          ? `无法连接 ${providerLabel} 来运行 ${modelLabel}。请检查网络后重试。`
          : `Could not reach ${providerLabel} for ${modelLabel}. Check the network and retry.`,
      retryable: true,
      showSettings: false,
      statusCode: 503,
    } satisfies AIErrorInfo;
  }

  return {
    detail,
    kind: 'generic',
    message:
      language === 'zh-CN'
        ? `${providerLabel} 在运行 ${modelLabel} 时失败。先重试一次；如果持续出现，请检查设置。`
        : `${providerLabel} failed while running ${modelLabel}. Retry once or review Settings if it keeps happening.`,
    retryable: true,
    showSettings: true,
    statusCode: 500,
  } satisfies AIErrorInfo;
}

function resolveModelDescriptor(params: {
  modelId?: string | null;
  modelKey?: string | null;
  providerId?: string | null;
}) {
  if (params.modelKey) {
    const parsed = parseModelKey(params.modelKey);
    return {
      modelId: params.modelId || parsed.modelId,
      providerId: params.providerId || parsed.providerId,
    };
  }

  return {
    modelId: params.modelId || null,
    providerId: params.providerId || null,
  };
}

function parseModelKey(modelKey: string) {
  const separatorIndex = modelKey.indexOf('::');
  if (separatorIndex === -1) {
    return {
      modelId: modelKey,
      providerId: 'openai-codex',
    };
  }

  return {
    providerId: modelKey.slice(0, separatorIndex),
    modelId: modelKey.slice(separatorIndex + 2),
  };
}

function isQuotaError(message: string) {
  return /usage limit|insufficient[_\s-]*quota|billing|credits?|rate limit exceeded/i.test(
    message
  );
}

function isAuthError(message: string) {
  return /unauthori[sz]ed|invalid (api )?key|invalid token|token expired|forbidden|authentication/i.test(
    message
  );
}

function isNetworkError(message: string) {
  return /fetch failed|network|timed out|econn|enotfound|connection refused|service unavailable/i.test(
    message
  );
}

function isEmptyReplyError(message: string) {
  return /without a visible reply|did not return any visible content|no visible content/i.test(
    message
  );
}

function extractRetryHint(message: string) {
  const match = message.match(/~?\d+\s*(?:min|mins|minutes|hour|hours)/i);
  return match ? match[0] : null;
}

function extractPlanHint(message: string) {
  const match = message.match(/\(([^)]+plan)\)/i);
  return match?.[1] || null;
}
