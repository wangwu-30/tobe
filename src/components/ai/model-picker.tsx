'use client';

import * as React from 'react';
import type { ModelCatalogData, ModelSelectionData } from '@/types';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/components/providers/language-provider';

type ModelPickerVariant = 'compact' | 'stacked';

export function ModelPicker({
  allowUnconfiguredProviders = true,
  catalog,
  disabled = false,
  idPrefix,
  namePrefix = 'modelSelection',
  onChange,
  value,
  variant = 'stacked',
}: {
  allowUnconfiguredProviders?: boolean;
  catalog: ModelCatalogData | null;
  disabled?: boolean;
  idPrefix?: string;
  namePrefix?: string;
  onChange: (selection: ModelSelectionData) => void;
  value: ModelSelectionData | null;
  variant?: ModelPickerVariant;
}) {
  const t = useT();
  const generatedId = React.useId().replace(/:/g, '');
  const fieldIdPrefix = `${idPrefix || 'model-picker'}-${generatedId}`;
  const providerLabelId = `${fieldIdPrefix}-provider-label`;
  const providerTriggerId = `${fieldIdPrefix}-provider`;
  const modelLabelId = `${fieldIdPrefix}-model-label`;
  const modelTriggerId = `${fieldIdPrefix}-model`;
  const providerOptions = React.useMemo(() => catalog?.providers || [], [catalog?.providers]);
  const selectedProvider =
    providerOptions.find((provider) => provider.id === value?.providerId) ||
    providerOptions[0] ||
    null;
  const modelOptions = React.useMemo(() => selectedProvider?.models || [], [selectedProvider?.models]);
  const selectedModel =
    modelOptions.find((model) => model.id === value?.modelId) ||
    modelOptions[0] ||
    null;
  const layoutClassName =
    variant === 'compact'
      ? 'grid min-w-0 gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]'
      : 'grid min-w-0 gap-3 md:grid-cols-2';
  const triggerSize = variant === 'compact' ? 'sm' : 'default';

  const handleProviderChange = React.useCallback(
    (providerId: string) => {
      const nextProvider = providerOptions.find((provider) => provider.id === providerId);
      const nextModel = nextProvider?.models[0];
      if (!nextProvider || !nextModel) {
        return;
      }

      onChange({
        key: nextModel.key,
        modelId: nextModel.id,
        providerId: nextProvider.id,
      });
    },
    [onChange, providerOptions]
  );

  const handleModelChange = React.useCallback(
    (modelId: string) => {
      const nextModel = modelOptions.find((model) => model.id === modelId);
      if (!selectedProvider || !nextModel) {
        return;
      }

      onChange({
        key: nextModel.key,
        modelId: nextModel.id,
        providerId: selectedProvider.id,
      });
    },
    [modelOptions, onChange, selectedProvider]
  );

  return (
    <div className="min-w-0 space-y-2">
      <div className={layoutClassName}>
        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor={providerTriggerId} id={providerLabelId}>
            {t('settings.provider')}
          </Label>
          <Select
            autoComplete="off"
            disabled={disabled || providerOptions.length === 0}
            name={`${namePrefix}Provider`}
            value={selectedProvider?.id || ''}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger
              aria-labelledby={providerLabelId}
              className="w-full min-w-0"
              id={providerTriggerId}
              size={triggerSize}
            >
              <SelectValue placeholder={t('settings.selectModelProvider')} />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((provider) => (
                <SelectItem
                  key={provider.id}
                  value={provider.id}
                  disabled={!allowUnconfiguredProviders && !provider.configured}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{provider.label}</span>
                    {provider.configured ? (
                      <span className="text-[10px] text-muted-foreground">
                        {provider.authState === 'oauth_connected'
                          ? 'OAuth'
                          : 'API'}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor={modelTriggerId} id={modelLabelId}>
            {t('settings.model')}
          </Label>
          <Select
            autoComplete="off"
            disabled={disabled || modelOptions.length === 0}
            name={`${namePrefix}Model`}
            value={selectedModel?.id || ''}
            onValueChange={handleModelChange}
          >
            <SelectTrigger
              aria-labelledby={modelLabelId}
              className="w-full min-w-0"
              id={modelTriggerId}
              size={triggerSize}
            >
              <SelectValue placeholder={t('settings.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedProvider?.disabledReason ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {selectedProvider.disabledReason}
        </p>
      ) : null}
    </div>
  );
}
