import { NextResponse } from 'next/server';
import { getPlatformPaths } from '@/lib/platform/paths';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET() {
  return NextResponse.json(getPlatformPaths());
});
