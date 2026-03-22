import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';

export const runtime = 'nodejs';

export const GET = defineRoute(async function GET(req: NextRequest) {
  if (process.env.DAO_E2E !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const mode = new URL(req.url).searchParams.get('mode');
  if (mode === 'throw') {
    throw new Error('Resilience debug route exploded.');
  }

  return NextResponse.json({ ok: true });
});
