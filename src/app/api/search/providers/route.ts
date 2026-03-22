import { NextRequest, NextResponse } from 'next/server';
import { getSearchProvidersFromHeaders } from '@/lib/search/catalog';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(req: NextRequest) {
  return NextResponse.json(getSearchProvidersFromHeaders(req.headers));
});
