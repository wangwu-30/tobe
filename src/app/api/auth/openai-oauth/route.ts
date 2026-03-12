import { NextResponse } from 'next/server';
import {
  getConfiguredOAuthProviders,
  removeOAuthCredentials,
} from '@/lib/ai/auth-store';

export async function GET() {
  const providers = await getConfiguredOAuthProviders();
  const openaiCodex = providers.find(provider => provider.providerId === 'openai-codex');

  return NextResponse.json({
    providers,
    openaiCodexConfigured: Boolean(openaiCodex),
    savedAt: openaiCodex?.savedAt || null,
  });
}

export async function DELETE() {
  await removeOAuthCredentials('openai-codex');
  const providers = await getConfiguredOAuthProviders();

  return NextResponse.json({
    providers,
    removed: true,
  });
}
