'use client';

import * as React from 'react';
import { LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Settings } from '@/lib/ai/providers';
import {
  buildStoredCommentAgents,
  normalizeCommentAgents,
} from '@/lib/comments/agents';
import { AppShell } from '@/components/layout/app-shell';
import { formatStableDateTime } from '@/lib/time';
import {
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_BRAVE_SEARCH_ENDPOINT,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
  type SearchProviderInfo,
} from '@/lib/search/types';
import {
  getStoredAppLanguage,
  getStoredAISettings,
  getStoredAISettingsHeader,
  getStoredDefaultModelSelection,
  resolveStoredModelSelection,
  setStoredAppLanguage,
  setStoredAISettings,
} from '@/lib/client/ai-settings';
import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from '@/lib/i18n/language';
import { ModelPicker } from '@/components/ai/model-picker';
import {
  apiFetch,
  safeJsonParse,
  ZoneErrorBoundary,
} from '@/framework/resilience';

import type {
  CommentAgentConfigData,
  ModelCatalogData,
  ModelSelectionData,
  PlatformStatusData,
} from '@/types';

type ProviderKeyRow = {
  id: string;
  providerId: string;
  apiKey: string;
};

type OAuthStatus = {
  email: string | null;
  planType: string | null;
  providerId: string;
  savedAt: string | null;
};

const DEFAULT_SEARCH_PROVIDER = BRAVE_SEARCH_PROVIDER_ID;
const SEARCH_PROVIDER_IDS = new Set([
  BRAVE_SEARCH_PROVIDER_ID,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
]);
const OAUTH_CONNECTIONS = [
  {
    providerId: 'openai-codex',
    label: 'OpenAI Codex',
  },
];

export default function SettingsPage() {
  const t = useT();
  const language = useAppLanguage();
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalogData | null>(null);
  const [availableSearchProviders, setAvailableSearchProviders] = React.useState<
    SearchProviderInfo[]
  >([]);
  const [defaultModelSelection, setDefaultModelSelection] =
    React.useState<ModelSelectionData | null>(getStoredDefaultModelSelection);
  const [appLanguage, setAppLanguage] = React.useState<AppLanguage>(getStoredAppLanguage);
  const [commentAgents, setCommentAgents] = React.useState<CommentAgentConfigData[]>(() =>
    normalizeCommentAgents(getStoredAISettings().commentAgents, getStoredAppLanguage())
  );
  const [searchProviderId, setSearchProviderId] = React.useState(DEFAULT_SEARCH_PROVIDER);
  const [searchProviderApiKeys, setSearchProviderApiKeys] = React.useState<
    Record<string, string>
  >({});
  const [searchProviderEndpoints, setSearchProviderEndpoints] = React.useState<
    Record<string, string>
  >({});
  const [providerKeyRows, setProviderKeyRows] = React.useState<ProviderKeyRow[]>([]);
  const [oauthProviders, setOauthProviders] = React.useState<OAuthStatus[]>([]);
  const [selectedOAuthProviderId, setSelectedOAuthProviderId] = React.useState(
    OAUTH_CONNECTIONS[0]?.providerId || ''
  );
  const [platformStatus, setPlatformStatus] = React.useState<PlatformStatusData | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = React.useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = React.useState<string | null>(null);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = React.useState(false);
  const [oauthNotice, setOauthNotice] = React.useState<string | null>(null);
  const [oauthError, setOauthError] = React.useState<string | null>(null);
  const [isConnectingProviderId, setIsConnectingProviderId] = React.useState<string | null>(null);
  const [isDisconnectingProviderId, setIsDisconnectingProviderId] = React.useState<
    string | null
  >(null);
  const [isLoadingSearchProviders, setIsLoadingSearchProviders] = React.useState(false);
  const [searchProvidersError, setSearchProvidersError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAppLanguage(language);
  }, [language]);

  React.useEffect(() => {
    setCommentAgents((current) =>
      normalizeCommentAgents(buildStoredCommentAgents(current), language)
    );
  }, [language]);

  React.useEffect(() => {
    const stored = localStorage.getItem('ai-settings');
    if (stored) {
      const parsed = safeJsonParse<Record<string, unknown> | null>(stored, null);
      if (parsed) {
        if (typeof parsed.defaultModel === 'string') {
          setDefaultModelSelection(resolveStoredModelSelection(null, null, parsed.defaultModel));
        }
        if (typeof parsed.language === 'string') {
          setAppLanguage(getStoredAppLanguage());
        }
        setCommentAgents(
          normalizeCommentAgents(parsed.commentAgents, getStoredAppLanguage())
        );
        if (
          typeof parsed.searchProviderId === 'string' &&
          parsed.searchProviderId.trim()
        ) {
          setSearchProviderId(parsed.searchProviderId.trim());
        } else if (
          parsed.search &&
          typeof parsed.search === 'object' &&
          typeof (parsed.search as Record<string, unknown>).providerId === 'string'
        ) {
          setSearchProviderId(
            ((parsed.search as Record<string, unknown>).providerId as string).trim()
          );
        }

        const storedProviderApiKeys = {
          ...(typeof parsed.anthropicApiKey === 'string' && parsed.anthropicApiKey
            ? { anthropic: parsed.anthropicApiKey }
            : {}),
          ...(typeof parsed.openaiApiKey === 'string' && parsed.openaiApiKey
            ? { openai: parsed.openaiApiKey }
            : {}),
          ...readStringMap(parsed.providerApiKeys),
        };
        const currentSearchProviderId = getStoredSearchProviderId(parsed);
        const nextSearchProviderApiKeys = {
          ...pickSearchProviderEntries(storedProviderApiKeys),
          ...readStringMap(parsed.searchProviderApiKeys),
        };
        const nextSearchProviderEndpoints = readStringMap(parsed.searchProviderEndpoints);
        const searchConfig = asRecord(parsed.search);
        const searchProviders = asRecord(searchConfig.providers);

        for (const [providerId, value] of Object.entries(searchProviders)) {
          const config = asRecord(value);
          const apiKey = asString(config.apiKey);
          const endpoint = asString(config.endpoint);

          if (apiKey) {
            nextSearchProviderApiKeys[providerId] = apiKey;
          }

          if (endpoint) {
            nextSearchProviderEndpoints[providerId] = endpoint;
          }
        }

        const topLevelSearchApiKey =
          asString(parsed.searchApiKey) || asString(searchConfig.apiKey);
        if (topLevelSearchApiKey) {
          nextSearchProviderApiKeys[currentSearchProviderId] = topLevelSearchApiKey;
        }

        const topLevelSearchEndpoint =
          asString(parsed.searchEndpoint) || asString(searchConfig.endpoint);
        if (topLevelSearchEndpoint) {
          nextSearchProviderEndpoints[currentSearchProviderId] = topLevelSearchEndpoint;
        }

        setSearchProviderApiKeys(nextSearchProviderApiKeys);
        setSearchProviderEndpoints(nextSearchProviderEndpoints);

        setProviderKeyRows(
          Object.entries(stripSearchProviderEntries(storedProviderApiKeys)).map(
            ([providerId, apiKey], index) => ({
              id: `provider-${index}-${providerId}`,
              providerId,
              apiKey,
            })
          )
        );
      }
    }
  }, []);

  const loadModels = React.useCallback(async () => {
    const response = await apiFetch('/api/ai/models', {
      headers: getStoredAISettingsHeader(),
    });
    if (!response.ok) return;

    const data = (await response.json()) as ModelCatalogData;
    setModelCatalog(data);
    setDefaultModelSelection((current) =>
      resolveStoredModelSelection(data, current, data.defaultModelKey)
    );
  }, []);

  const loadOAuthStatus = React.useCallback(async () => {
    const response = await apiFetch('/api/auth/openai-oauth');
    if (!response.ok) return;

    const data = await response.json();
    setOauthProviders(data.providers || []);
  }, []);

  React.useEffect(() => {
    const loadSearchProviders = async () => {
      setIsLoadingSearchProviders(true);
      setSearchProvidersError(null);

      try {
        const response = await apiFetch('/api/search/providers', {
          headers: getStoredAISettingsHeader(),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || t('settings.searchProvidersLoadFailed'));
        }

        setAvailableSearchProviders(data?.providers || []);
        if (typeof data?.selectedProviderId === 'string' && data.selectedProviderId.trim()) {
          setSearchProviderId((current) => current || data.selectedProviderId);
        }
      } catch (error) {
        setSearchProvidersError(
          error instanceof Error ? error.message : t('settings.searchProvidersLoadFailed')
        );
      } finally {
        setIsLoadingSearchProviders(false);
      }
    };

    const loadPlatformStatus = async () => {
      const desktopGetStatus = window.daoDesktop?.platform?.getStatus;
      if (desktopGetStatus) {
        setPlatformStatus(await desktopGetStatus() as PlatformStatusData);
        return;
      }

      const response = await apiFetch('/api/platform/status');
      if (!response.ok) return;

      setPlatformStatus(await response.json());
    };

    void loadModels();
    void loadOAuthStatus();
    void loadSearchProviders();
    void loadPlatformStatus();
  }, [loadModels, loadOAuthStatus, t]);

  const providerOptions = React.useMemo(
    () =>
      (modelCatalog?.providers || []).map((provider) => ({
        label: provider.label,
        providerId: provider.id,
      })),
    [modelCatalog]
  );

  const selectedSearchProvider = React.useMemo(
    () =>
      availableSearchProviders.find((provider) => provider.id === searchProviderId) || null,
    [availableSearchProviders, searchProviderId]
  );
  const selectedOAuthConnection = React.useMemo(
    () =>
      OAUTH_CONNECTIONS.find((provider) => provider.providerId === selectedOAuthProviderId) ||
      OAUTH_CONNECTIONS[0] ||
      null,
    [selectedOAuthProviderId]
  );
  const selectedOAuthStatus = React.useMemo(
    () =>
      oauthProviders.find((item) => item.providerId === selectedOAuthConnection?.providerId) ||
      null,
    [oauthProviders, selectedOAuthConnection?.providerId]
  );
  const selectedSearchProviderApiKey = searchProviderApiKeys[searchProviderId] || '';
  const selectedSearchProviderEndpoint =
    searchProviderEndpoints[searchProviderId] ||
    (searchProviderId === BRAVE_SEARCH_PROVIDER_ID ? DEFAULT_BRAVE_SEARCH_ENDPOINT : '');
  const isSearchApiConfigured = Boolean(selectedSearchProviderApiKey.trim());

  const handleSave = () => {
    const modelProviderApiKeys = providerKeyRows.reduce<Record<string, string>>((acc, row) => {
      if (row.providerId.trim() && row.apiKey.trim()) {
        acc[row.providerId.trim()] = row.apiKey.trim();
      }
      return acc;
    }, {});
    const normalizedSearchProviderApiKeys = normalizeStoredMap(searchProviderApiKeys);
    const normalizedSearchProviderEndpoints = normalizeStoredMap(searchProviderEndpoints);
    const searchProviders = buildSearchProviderSettings(
      normalizedSearchProviderApiKeys,
      normalizedSearchProviderEndpoints
    );

    const settings: Settings = {
      defaultModel: defaultModelSelection?.key,
      language: appLanguage,
      commentAgents: buildStoredCommentAgents(commentAgents),
      providerApiKeys: modelProviderApiKeys,
      search: {
        ...(normalizedSearchProviderApiKeys[searchProviderId]
          ? { apiKey: normalizedSearchProviderApiKeys[searchProviderId] }
          : {}),
        ...(normalizedSearchProviderEndpoints[searchProviderId]
          ? { endpoint: normalizedSearchProviderEndpoints[searchProviderId] }
          : {}),
        providerId: searchProviderId,
        ...(Object.keys(searchProviders).length > 0 ? { providers: searchProviders } : {}),
      },
      ...(normalizedSearchProviderApiKeys[searchProviderId]
        ? { searchApiKey: normalizedSearchProviderApiKeys[searchProviderId] }
        : {}),
      ...(normalizedSearchProviderEndpoints[searchProviderId]
        ? { searchEndpoint: normalizedSearchProviderEndpoints[searchProviderId] }
        : {}),
      searchProviderId,
      searchProviderApiKeys: normalizedSearchProviderApiKeys,
      searchProviderEndpoints: normalizedSearchProviderEndpoints,
    };

    setStoredAISettings(settings);
    void loadModels();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAppLanguageChange = React.useCallback((value: string) => {
    const nextLanguage = value as AppLanguage;
    setAppLanguage(nextLanguage);
    setStoredAppLanguage(nextLanguage);
  }, []);

  const addProviderKey = () => {
    setProviderKeyRows(rows => [
      ...rows,
      {
        id: `provider-${Date.now()}`,
        providerId: providerOptions[0]?.providerId || '',
        apiKey: '',
      },
    ]);
  };

  const updateProviderKey = (rowId: string, updates: Partial<ProviderKeyRow>) => {
    setProviderKeyRows(rows =>
      rows.map(row => (row.id === rowId ? { ...row, ...updates } : row))
    );
  };

  const removeProviderKey = (rowId: string) => {
    setProviderKeyRows(rows => rows.filter(row => row.id !== rowId));
  };

  const addCommentAgent = () => {
    const agentId = `agent-${Date.now().toString(36)}`;
    setCommentAgents((current) => [
      ...current,
      {
        id: agentId,
        handle: `@${agentId}`,
        name: '新角色',
        systemPrompt: '',
        enabled: true,
        builtin: false,
      },
    ]);
  };

  const updateCommentAgent = (
    agentId: string,
    updates: Partial<CommentAgentConfigData>
  ) => {
    setCommentAgents((current) =>
      current.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              ...updates,
            }
          : agent
      )
    );
  };

  const removeCommentAgent = (agentId: string) => {
    setCommentAgents((current) =>
      current.filter((agent) => agent.id !== agentId || agent.builtin)
    );
  };

  const handleConnectOAuth = async (providerId: string) => {
    setOauthError(null);
    setOauthNotice(null);

    const oauthLogin = window.daoDesktop?.oauthLogin;
    if (!oauthLogin) {
      setOauthError(t('settings.oauthLoginUnavailable'));
      return;
    }

    setIsConnectingProviderId(providerId);
    try {
      setOauthNotice(
        t('settings.oauthOpening', { provider: providerLabel(providerId) })
      );
      const result = await oauthLogin(providerId);
      await loadOAuthStatus();
      setOauthNotice(
        result?.savedAt
          ? t('settings.connectedAt', {
              provider: providerLabel(providerId),
              savedAt: formatStableDateTime(result.savedAt),
            })
          : t('settings.connectedNow', { provider: providerLabel(providerId) })
      );
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : t('settings.oauthLoginFailed'));
    } finally {
      setIsConnectingProviderId(null);
    }
  };

  const handleDisconnectOAuth = async (providerId: string) => {
    if (!window.confirm(t('settings.oauthDisconnectConfirm', { provider: providerLabel(providerId) }))) {
      return;
    }

    setOauthError(null);
    setOauthNotice(null);
    setIsDisconnectingProviderId(providerId);

    try {
      const response = await apiFetch('/api/auth/openai-oauth', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t('settings.oauthDisconnectFailed'));
      }

      await loadOAuthStatus();
      setOauthNotice(t('settings.notConnectedYet'));
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : t('settings.oauthDisconnectFailed'));
    } finally {
      setIsDisconnectingProviderId(null);
    }
  };

  const handleOpenLogs = async () => {
    setDiagnosticsError(null);
    setDiagnosticsNotice(null);

    try {
      const openLogsDirectory = window.daoDesktop?.diagnostics?.openLogsDirectory;
      await openLogsDirectory?.();
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : t('settings.exportDiagnosticsFailed'));
    }
  };

  const handleExportDiagnostics = async () => {
    setDiagnosticsError(null);
    setDiagnosticsNotice(null);
    setIsExportingDiagnostics(true);

    try {
      const exportBundle = window.daoDesktop?.diagnostics?.exportBundle;
      const result = await exportBundle?.();
      if (result?.path) {
        setDiagnosticsNotice(
          t('settings.exportDiagnosticsSaved', { path: result.path })
        );
      }
    } catch (error) {
      setDiagnosticsError(
        error instanceof Error ? error.message : t('settings.exportDiagnosticsFailed')
      );
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

  const handleCopyDeviceId = async () => {
    setDiagnosticsError(null);
    setDiagnosticsNotice(null);

    try {
      await navigator.clipboard.writeText(platformStatus?.deviceId || '');
      setDiagnosticsNotice(t('settings.copyDeviceIdSuccess'));
    } catch {
      setDiagnosticsError(t('settings.copyDeviceIdFailed'));
    }
  };

  return (
    <AppShell
      title={t('settings.title')}
      subtitle={t('settings.modelsSearchProviders')}
    >
      <main className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 py-8 space-y-6">
        <SettingsBoundary zone="language">
          <Card className="p-6 space-y-4" data-testid="settings-language-card">
            <h2 className="text-sm font-semibold">{t('settings.languageSection')}</h2>
            <Select value={appLanguage} onValueChange={handleAppLanguageChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('settings.selectLanguage')} />
              </SelectTrigger>
              <SelectContent>
                {APP_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === 'zh-CN'
                      ? t('settings.languageSimplifiedChinese')
                      : t('settings.languageEnglish')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('settings.languageDescription')}
            </p>
          </Card>
        </SettingsBoundary>

        <SettingsBoundary zone="default-model">
          <Card className="p-6 space-y-4" data-testid="settings-default-model-card">
            <h2 className="text-sm font-semibold">{t('settings.defaultModel')}</h2>
            <ModelPicker
              catalog={modelCatalog}
              value={defaultModelSelection}
              onChange={setDefaultModelSelection}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.defaultModelDescription')}
            </p>
          </Card>
        </SettingsBoundary>

        <SettingsBoundary zone="oauth">
          <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">{t('settings.oauthConnections')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('settings.oauthDescription')}
          </p>
          <div className="space-y-2">
            <Label className="text-xs">{t('settings.provider')}</Label>
            <Select value={selectedOAuthProviderId} onValueChange={setSelectedOAuthProviderId}>
              <SelectTrigger>
                <SelectValue placeholder={t('settings.provider')} />
              </SelectTrigger>
              <SelectContent>
                {OAUTH_CONNECTIONS.map((connection) => (
                  <SelectItem key={connection.providerId} value={connection.providerId}>
                    {connection.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedOAuthConnection ? (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{selectedOAuthConnection.label}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('settings.openaiCodexDescription')}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {selectedOAuthStatus?.savedAt
                    ? t('settings.connectedShort', {
                        savedAt: formatStableDateTime(selectedOAuthStatus.savedAt),
                      })
                    : t('settings.notConnectedYet')}
                </div>
                {selectedOAuthStatus?.email ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedOAuthStatus.email}
                    {selectedOAuthStatus.planType ? ` · ${selectedOAuthStatus.planType}` : ''}
                  </div>
                ) : null}
              </div>

              {platformStatus?.isDesktop ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant={selectedOAuthStatus?.savedAt ? 'outline' : 'default'}
                    className="h-8"
                    onClick={() => void handleConnectOAuth(selectedOAuthConnection.providerId)}
                    disabled={
                      isConnectingProviderId === selectedOAuthConnection.providerId ||
                      isDisconnectingProviderId === selectedOAuthConnection.providerId
                    }
                  >
                    {isConnectingProviderId === selectedOAuthConnection.providerId ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {t('settings.waiting')}
                      </>
                    ) : selectedOAuthStatus?.savedAt ? (
                      t('settings.reconnectInBrowser')
                    ) : (
                      t('settings.connectInBrowser')
                    )}
                  </Button>
                  {selectedOAuthStatus?.savedAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => void handleDisconnectOAuth(selectedOAuthConnection.providerId)}
                      disabled={isDisconnectingProviderId === selectedOAuthConnection.providerId}
                    >
                      {isDisconnectingProviderId === selectedOAuthConnection.providerId ? (
                        <>
                          <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {t('settings.disconnecting')}
                        </>
                      ) : (
                        t('settings.disconnect')
                      )}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled
                >
                  {t('settings.desktopRequired')}
                </Button>
              )}
            </div>
          ) : null}

          {oauthNotice ? (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
              {oauthNotice}
            </div>
          ) : null}
          {oauthError ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {oauthError}
            </div>
          ) : null}

          <div className="rounded-md border border-border px-3 py-3 text-xs text-muted-foreground">
            {t('settings.credentialsNote', {
              oauthDir: platformStatus?.paths.oauthDir || '.oauth',
            })}
          </div>
          </Card>
        </SettingsBoundary>

        <SettingsBoundary zone="search">
          <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">{t('settings.webSearch')}</h2>
          <div className="space-y-2">
            <Label className="text-xs">{t('settings.defaultSearchProvider')}</Label>
            <Select
              value={searchProviderId}
              onValueChange={setSearchProviderId}
              disabled={isLoadingSearchProviders || availableSearchProviders.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isLoadingSearchProviders
                      ? t('common.loading')
                      : t('settings.selectSearchProvider')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableSearchProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.searchDescription')}
          </p>
          {searchProvidersError ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {searchProvidersError}
            </div>
          ) : null}
          <div className="rounded-xl border border-border px-4 py-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {selectedSearchProvider?.label || searchProviderId}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {selectedSearchProvider?.description || t('settings.searchProviderConfigDescription')}
                </div>
              </div>
              <div className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {isSearchApiConfigured
                  ? t('settings.searchProviderModeApi')
                  : t('settings.searchProviderModeNeedsApiKey')}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">
                  {t('settings.searchProviderApiKey', {
                    provider: selectedSearchProvider?.label || searchProviderId,
                  })}
                </Label>
                <Input
                  type="password"
                  value={selectedSearchProviderApiKey}
                  onChange={(event) =>
                    setSearchProviderApiKeys((current) => ({
                      ...current,
                      [searchProviderId]: event.target.value,
                    }))
                  }
                  placeholder={t('settings.apiKeyPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">{t('settings.searchEndpoint')}</Label>
                <Input
                  value={selectedSearchProviderEndpoint}
                  onChange={(event) =>
                    setSearchProviderEndpoints((current) => ({
                      ...current,
                      [searchProviderId]: event.target.value,
                    }))
                  }
                  placeholder={t('settings.searchEndpointPlaceholder')}
                />
              </div>
            </div>

            <p className="text-xs leading-5 text-muted-foreground">
              {searchProviderId === BRAVE_SEARCH_PROVIDER_ID
                ? isSearchApiConfigured
                  ? t('settings.searchProviderConfigDescriptionBraveApi')
                  : t('settings.searchProviderConfigDescriptionNeedsApiKey')
                : isSearchApiConfigured
                  ? t('settings.searchProviderConfigDescription')
                  : t('settings.searchProviderConfigDescriptionNeedsApiKey')}
            </p>
          </div>
          </Card>
        </SettingsBoundary>

        <SettingsBoundary zone="provider-api-keys">
          <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('settings.providerApiKeys')}</h2>
            <Button size="sm" variant="outline" onClick={addProviderKey} className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              {t('settings.addProvider')}
            </Button>
          </div>

          {providerKeyRows.length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">
              {t('settings.providerKeysEmpty')}
            </Card>
          )}

          {providerKeyRows.map(row => (
            <Card key={row.id} className="p-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
                <div className="space-y-2">
                  <Label className="text-xs">{t('settings.provider')}</Label>
                  <Select
                    value={row.providerId}
                    onValueChange={(value) => updateProviderKey(row.id, { providerId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('settings.provider')} />
                    </SelectTrigger>
                    <SelectContent>
                      {providerOptions.map(option => (
                        <SelectItem key={option.providerId} value={option.providerId}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">{t('settings.apiKey')}</Label>
                  <Input
                    type="password"
                    value={row.apiKey}
                    onChange={(event) =>
                      updateProviderKey(row.id, { apiKey: event.target.value })
                    }
                    placeholder={t('settings.apiKeyPlaceholder')}
                  />
                </div>

                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeProviderKey(row.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          </div>
        </SettingsBoundary>

        <SettingsBoundary zone="comment-agents">
          <Card className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Comment Agents</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                评论区里输入 `@角色` 时，会从这里读取角色定义。内置 `@assistant`
                始终可用；自定义角色仅保存在当前设备。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={addCommentAgent}
              data-testid="comment-agent-add"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增角色
            </Button>
          </div>

          <div className="space-y-3">
            {commentAgents.map((agent) => (
              <div
                key={agent.id}
                data-testid={`comment-agent-card-${agent.id}`}
                className="space-y-4 rounded-2xl border border-border/70 bg-muted/15 px-4 py-4"
              >
                <div className="grid gap-4 md:grid-cols-[1fr_180px_auto]">
                  <div className="space-y-2">
                    <Label className="text-xs">角色名称</Label>
                    <Input
                      aria-label="角色名称"
                      value={agent.name}
                      onChange={(event) =>
                        updateCommentAgent(agent.id, { name: event.target.value })
                      }
                      disabled={agent.builtin}
                      placeholder="例如：审校、写手、结构顾问"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">@句柄</Label>
                    <Input
                      aria-label="@句柄"
                      value={agent.handle}
                      onChange={(event) =>
                        updateCommentAgent(agent.id, { handle: event.target.value })
                      }
                      disabled={agent.builtin}
                      placeholder="@assistant"
                    />
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    {!agent.builtin ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCommentAgent(agent.id)}
                        data-testid={`comment-agent-delete-${agent.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label className="text-xs">角色提示词</Label>
                    <Textarea
                      aria-label="角色提示词"
                      value={agent.systemPrompt}
                      onChange={(event) =>
                        updateCommentAgent(agent.id, { systemPrompt: event.target.value })
                      }
                      disabled={agent.builtin}
                      placeholder="说明这个角色在评论线程中应该怎样回复。"
                      className="min-h-[104px]"
                    />
                  </div>
                  <div className="flex items-start justify-end">
                    <Button
                      type="button"
                      variant={agent.enabled ? 'secondary' : 'outline'}
                      className="h-8"
                      onClick={() =>
                        updateCommentAgent(agent.id, { enabled: !agent.enabled })
                      }
                      data-testid={`comment-agent-toggle-${agent.id}`}
                      disabled={agent.builtin}
                    >
                      {agent.builtin
                        ? '内置'
                        : agent.enabled
                          ? '已启用'
                          : '已停用'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </Card>
        </SettingsBoundary>

        <SettingsBoundary zone="advanced-tools">
          <details className="rounded-3xl border border-border/70 bg-muted/15">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4">
            <div>
              <div className="text-sm font-semibold">{t('settings.advancedTools')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('settings.advancedToolsDescription')}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('settings.expandAdvanced')}
            </div>
          </summary>

          <div className="space-y-6 border-t border-border/70 px-6 py-6">
            <div className="space-y-4">
              <h2 className="text-sm font-semibold">{t('settings.platformRuntime')}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border px-3 py-3 text-sm">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {t('settings.mode')}
                  </div>
                  <div className="mt-1 font-medium">
                    {platformStatus?.isDesktop
                      ? t('settings.runtimeDesktop')
                      : t('settings.runtimeWeb')}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings.platformVersion')}: {platformStatus?.appVersion || '0.1.0'}
                    {platformStatus?.channel ? ` · ${platformStatus.channel}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings.device', {
                      deviceId: platformStatus?.deviceId || 'local-device',
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-border px-3 py-3 text-sm">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {t('settings.storageRoot')}
                  </div>
                  <div className="mt-1 break-all font-medium">
                    {platformStatus?.paths.appDataRoot || t('common.loading')}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings.database', {
                      path: platformStatus?.paths.dbFilePath || t('common.loading'),
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border px-3 py-3 text-xs text-muted-foreground">
                {t('settings.oauthPath', {
                  path: platformStatus?.paths.oauthDir || t('common.loading'),
                })}
                <br />
                {t('settings.mirror', {
                  path: platformStatus?.paths.workspaceMirrorRoot || t('common.loading'),
                })}
                <br />
                {t('settings.logs', {
                  path: platformStatus?.paths.logsRoot || t('common.loading'),
                })}
              </div>
            </div>

            {platformStatus?.diagnosticsEnabled ? (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold">{t('settings.diagnostics')}</h2>
                <p className="text-xs text-muted-foreground">
                  {t('settings.diagnosticsDescription')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8"
                    onClick={() => void handleOpenLogs()}
                  >
                    {t('settings.openLogs')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8"
                    onClick={() => void handleCopyDeviceId()}
                  >
                    {t('settings.copyDeviceId')}
                  </Button>
                  <Button
                    type="button"
                    className="h-8"
                    disabled={isExportingDiagnostics}
                    onClick={() => void handleExportDiagnostics()}
                  >
                    {isExportingDiagnostics ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {t('settings.waiting')}
                      </>
                    ) : (
                      t('settings.exportDiagnostics')
                    )}
                  </Button>
                </div>
                {diagnosticsNotice ? (
                  <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    {diagnosticsNotice}
                  </div>
                ) : null}
                {diagnosticsError ? (
                  <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {diagnosticsError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          </details>
        </SettingsBoundary>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            {t('common.save')}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">{t('common.saved')}</span>}
        </div>
      </main>
    </AppShell>
  );
}

function providerLabel(providerId: string) {
  return OAUTH_CONNECTIONS.find((provider) => provider.providerId === providerId)?.label || providerId;
}

function SettingsBoundary({
  children,
  zone,
}: {
  children: React.ReactNode;
  zone: string;
}) {
  return (
    <ZoneErrorBoundary level="recoverable" zone={`settings-${zone}`}>
      {children}
    </ZoneErrorBoundary>
  );
}

function normalizeStoredMap(input: Record<string, string>) {
  return Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();

    if (normalizedKey && normalizedValue) {
      acc[normalizedKey] = normalizedValue;
    }

    return acc;
  }, {});
}

function buildSearchProviderSettings(
  apiKeys: Record<string, string>,
  endpoints: Record<string, string>
) {
  const providerIds = new Set([...Object.keys(apiKeys), ...Object.keys(endpoints)]);
  const providers: Record<string, { apiKey?: string; endpoint?: string }> = {};

  for (const providerId of providerIds) {
    const apiKey = apiKeys[providerId];
    const endpoint = endpoints[providerId];

    if (!apiKey && !endpoint) {
      continue;
    }

    providers[providerId] = {
      ...(apiKey ? { apiKey } : {}),
      ...(endpoint ? { endpoint } : {}),
    };
  }

  return providers;
}

function readStringMap(value: unknown) {
  const raw = asRecord(value);
  return Object.entries(raw).reduce<Record<string, string>>((acc, [key, entryValue]) => {
    const normalized = asString(entryValue);
    if (normalized) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}

function pickSearchProviderEntries(entries: Record<string, string>) {
  return Object.entries(entries).reduce<Record<string, string>>((acc, [key, value]) => {
    if (SEARCH_PROVIDER_IDS.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function stripSearchProviderEntries(entries: Record<string, string>) {
  return Object.entries(entries).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!SEARCH_PROVIDER_IDS.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function getStoredSearchProviderId(parsed: Record<string, unknown>) {
  const search = asRecord(parsed.search);
  return (
    asString(parsed.searchProviderId) ||
    asString(search.providerId) ||
    DEFAULT_SEARCH_PROVIDER
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
