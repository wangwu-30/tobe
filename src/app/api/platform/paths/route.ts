import { NextResponse } from 'next/server';
import { getPlatformPaths } from '@/lib/platform/paths';

export async function GET() {
  return NextResponse.json(getPlatformPaths());
}
