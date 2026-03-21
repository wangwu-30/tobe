import { NextRequest } from 'next/server';
import { handleLightChatRunRequest } from '@/lib/ai/agent-run-route';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  return handleLightChatRunRequest(req);
}
