import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredOAuthProviders } from '@/lib/ai/auth-store';
import { getModelCatalog, getSettingsFromHeaders } from '@/lib/ai/providers';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(req: NextRequest) {
  const settings = getSettingsFromHeaders(req.headers);
  const oauthProviders = await getConfiguredOAuthProviders();
  const modelCatalog = getModelCatalog({
    oauthProviderIds: oauthProviders.map((provider) => provider.providerId),
    settings,
  });

  return NextResponse.json(modelCatalog);
});
