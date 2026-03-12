import { NextRequest, NextResponse } from 'next/server';
import { describeAIError } from '@/lib/ai/error-utils';
import { buildSuggestionContext } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

export async function POST(req: NextRequest) {
  let modelKey: string | null = null;
  let language: 'zh-CN' | 'en-US' | undefined;

  try {
    const actor = await getPlatformContextFromHeaders(req.headers);
    const {
      wikiContent,
      documentContent,
      anchorText,
      threadDiscussion,
      wikiId,
      documentId,
      model: modelOverride,
    } = await req.json();

    const systemPrompt = await buildSuggestionContext({
      anchorText,
      organizationId: actor.organizationId,
      threadDiscussion,
      wikiContent: wikiContent || documentContent,
      wikiId: wikiId || documentId,
    });

    const selection = getSelectedModelFromHeaders(req.headers, modelOverride);
    const { model, settings } = selection;
    modelKey = selection.modelKey;
    language = settings.language;

    const message = await completeWithPi({
      model,
      settings,
      context: {
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Generate the replacement text for "${anchorText}". Return only the replacement text.`,
            timestamp: Date.now(),
          },
        ],
      },
    });

    return NextResponse.json({ suggestion: extractTextContent(message).trim() });
  } catch (error) {
    const info = describeAIError({
      language,
      modelKey,
      rawMessage: error instanceof Error ? error.message : 'Suggest edit failed',
    });

    return NextResponse.json(
      {
        error: info.message,
        details: info.detail,
      },
      { status: info.statusCode }
    );
  }
}
