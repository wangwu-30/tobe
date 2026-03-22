import { NextRequest, NextResponse } from 'next/server';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const providerId =
    typeof body?.providerId === 'string' && body.providerId.trim()
      ? body.providerId.trim()
      : null;
  const maxResults =
    typeof body?.maxResults === 'number' &&
    Number.isFinite(body.maxResults) &&
    body.maxResults > 0
      ? Math.floor(body.maxResults)
      : undefined;

  if (!query) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  try {
    const provider = await getSearchProviderFromHeaders(req.headers, providerId);
    const result = await provider.search({ query, maxResults });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SearchProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details ?? null,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Search query failed',
      },
      { status: 500 }
    );
  }
});
