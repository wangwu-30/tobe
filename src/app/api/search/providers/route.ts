import { NextRequest, NextResponse } from 'next/server';
import { getSearchProvidersFromHeaders } from '@/lib/search/catalog';

export async function GET(req: NextRequest) {
  return NextResponse.json(getSearchProvidersFromHeaders(req.headers));
}
