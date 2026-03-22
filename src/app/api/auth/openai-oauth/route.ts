import { NextResponse } from 'next/server';
import {
  getConfiguredOAuthProviders,
  removeOAuthCredentials,
} from '@/lib/ai/auth-store';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET() {
  const providers = await getConfiguredOAuthProviders();
  const openaiCodex = providers.find(provider => provider.providerId === 'openai-codex');

  return NextResponse.json({
    providers,
    openaiCodexConfigured: Boolean(openaiCodex),
    savedAt: openaiCodex?.savedAt || null,
  });
});

export const DELETE = defineRoute(async function DELETE() {
  await removeOAuthCredentials('openai-codex');
  const providers = await getConfiguredOAuthProviders();

  return NextResponse.json({
    providers,
    removed: true,
  });
});
