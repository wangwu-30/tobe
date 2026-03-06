'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Save, Plus, Trash2, X } from 'lucide-react';
import type { CustomProvider, Settings } from '@/lib/ai/providers';
import { getAvailableModels } from '@/lib/ai/providers';

const defaultSettings: Settings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  defaultModel: 'claude-sonnet-4-20250514',
  customProviders: [],
};

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = React.useState<Settings>(defaultSettings);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem('ai-settings');
    if (stored) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(stored) });
      } catch {
        // ignore
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('ai-settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateField = <K extends keyof Settings>(field: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const addProvider = () => {
    const id = `provider-${Date.now()}`;
    const newProvider: CustomProvider = {
      id,
      name: '',
      baseURL: '',
      apiKey: '',
      models: [{ id: '', name: '' }],
    };
    updateField('customProviders', [...(settings.customProviders || []), newProvider]);
  };

  const updateProvider = (id: string, updates: Partial<CustomProvider>) => {
    updateField(
      'customProviders',
      (settings.customProviders || []).map(p =>
        p.id === id ? { ...p, ...updates } : p
      )
    );
  };

  const removeProvider = (id: string) => {
    updateField(
      'customProviders',
      (settings.customProviders || []).filter(p => p.id !== id)
    );
  };

  const addModelToProvider = (providerId: string) => {
    const provider = settings.customProviders?.find(p => p.id === providerId);
    if (!provider) return;
    updateProvider(providerId, {
      models: [...provider.models, { id: '', name: '' }],
    });
  };

  const updateModelInProvider = (
    providerId: string,
    modelIndex: number,
    updates: Partial<{ id: string; name: string }>
  ) => {
    const provider = settings.customProviders?.find(p => p.id === providerId);
    if (!provider) return;
    const models = provider.models.map((m, i) =>
      i === modelIndex ? { ...m, ...updates } : m
    );
    updateProvider(providerId, { models });
  };

  const removeModelFromProvider = (providerId: string, modelIndex: number) => {
    const provider = settings.customProviders?.find(p => p.id === providerId);
    if (!provider) return;
    updateProvider(providerId, {
      models: provider.models.filter((_, i) => i !== modelIndex),
    });
  };

  const allModels = getAvailableModels(settings);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-bold">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Default Model */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">Default Model</h2>
          <Select
            value={settings.defaultModel}
            onValueChange={(v) => updateField('defaultModel', v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allModels.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">[{m.provider}]</span>
                    {m.name || m.id}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        {/* Anthropic */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">Anthropic</h2>
          <div className="space-y-2">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={settings.anthropicApiKey || ''}
              onChange={(e) => updateField('anthropicApiKey', e.target.value)}
              placeholder="sk-ant-..."
            />
          </div>
        </Card>

        {/* OpenAI */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">OpenAI</h2>
          <div className="space-y-2">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={settings.openaiApiKey || ''}
              onChange={(e) => updateField('openaiApiKey', e.target.value)}
              placeholder="sk-..."
            />
          </div>
        </Card>

        {/* Custom Providers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Custom Providers (OpenAI-compatible)</h2>
            <Button size="sm" variant="outline" onClick={addProvider} className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Add Provider
            </Button>
          </div>

          {(settings.customProviders || []).map(provider => (
            <Card key={provider.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Provider Name</Label>
                    <Input
                      value={provider.name}
                      onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                      placeholder="e.g. Ollama, vLLM, DeepSeek"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Base URL</Label>
                    <Input
                      value={provider.baseURL}
                      onChange={(e) => updateProvider(provider.id, { baseURL: e.target.value })}
                      placeholder="http://localhost:11434/v1"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 ml-2 text-muted-foreground hover:text-destructive"
                  onClick={() => removeProvider(provider.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">API Key (optional)</Label>
                <Input
                  type="password"
                  value={provider.apiKey}
                  onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                  placeholder="Leave empty if not required"
                  className="h-8 text-sm"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Models</Label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2"
                    onClick={() => addModelToProvider(provider.id)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Model
                  </Button>
                </div>

                {provider.models.map((model, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={model.id}
                      onChange={(e) =>
                        updateModelInProvider(provider.id, idx, { id: e.target.value })
                      }
                      placeholder="Model ID (e.g. llama3.1:70b)"
                      className="h-7 text-xs flex-1"
                    />
                    <Input
                      value={model.name}
                      onChange={(e) =>
                        updateModelInProvider(provider.id, idx, { name: e.target.value })
                      }
                      placeholder="Display name"
                      className="h-7 text-xs flex-1"
                    />
                    {provider.models.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => removeModelFromProvider(provider.id, idx)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}

          {(settings.customProviders || []).length === 0 && (
            <Card className="p-6 text-center text-muted-foreground text-xs">
              <p>No custom providers configured.</p>
              <p className="mt-1 opacity-70">
                Add providers like Ollama, vLLM, Together AI, Groq, DeepSeek, etc.
              </p>
            </Card>
          )}
        </div>

        <Button onClick={handleSave} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>
      </main>
    </div>
  );
}
