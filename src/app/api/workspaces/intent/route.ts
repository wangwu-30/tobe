import { NextRequest, NextResponse } from 'next/server';

import { getSettingsFromHeaders } from '@/lib/ai/providers';
import { translate } from '@/lib/i18n/copy';
import {
  inferWorkspaceCreateIntent,
  type WorkspaceCreateIntentChoice,
} from '@/lib/workspace/create-intent';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const settings = getSettingsFromHeaders(req.headers);
  const language = settings.language || 'zh-CN';

  const intent = inferWorkspaceCreateIntent({
    constraints: typeof body.constraints === 'string' ? body.constraints : null,
    goal: typeof body.goal === 'string' ? body.goal : null,
    selectedIntent:
      body.selectedIntent === 'document' ||
      body.selectedIntent === 'web' ||
      body.selectedIntent === 'both' ||
      body.selectedIntent === 'other'
        ? (body.selectedIntent as WorkspaceCreateIntentChoice)
        : null,
    selectedIntentNote:
      typeof body.selectedIntentNote === 'string' ? body.selectedIntentNote : null,
    styleGuide: typeof body.styleGuide === 'string' ? body.styleGuide : null,
    workflowPlaybookId:
      typeof body.workflowPlaybookId === 'string' ? body.workflowPlaybookId : null,
  });

  if (intent) {
    return NextResponse.json({
      intent,
      status: 'resolved',
    });
  }

  return NextResponse.json({
    options: [
      {
        description: translate(language, 'goal.intentDocumentDescription'),
        detailPlaceholder: translate(language, 'goal.intentOptionalDetailPlaceholder'),
        id: 'document',
        title: translate(language, 'goal.document'),
      },
      {
        description: translate(language, 'goal.intentWebDescription'),
        detailPlaceholder: translate(language, 'goal.intentOptionalDetailPlaceholder'),
        id: 'web',
        title: translate(language, 'goal.webPage'),
      },
      {
        description: translate(language, 'goal.intentBothDescription'),
        detailPlaceholder: translate(language, 'goal.intentOptionalDetailPlaceholder'),
        id: 'both',
        title: translate(language, 'goal.intentBoth'),
      },
      {
        description: translate(language, 'goal.intentOtherDescription'),
        detailPlaceholder: translate(language, 'goal.intentOtherPlaceholder'),
        id: 'other',
        title: translate(language, 'goal.intentOther'),
      },
    ],
    prompt: translate(language, 'goal.intentClarifyPrompt'),
    status: 'clarify',
  });
}
