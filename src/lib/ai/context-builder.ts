import { prisma } from '@/lib/db/prisma';

// Build independent context for comment AI replies
export async function buildCommentContext(params: {
  documentContent: string;
  anchorText: string;
  threadMessages: { role: string; content: string }[];
  documentId?: string;
  sessionId?: string;
}): Promise<{ systemPrompt: string; messages: { role: 'user' | 'assistant'; content: string }[] }> {
  const { documentContent, anchorText, threadMessages, documentId, sessionId } = params;

  // Fetch active memories
  const memories = await prisma.memory.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });

  // Fetch knowledge items for this document
  const knowledgeItems = await prisma.knowledgeItem.findMany({
    where: documentId ? { documentId } : {},
    orderBy: { createdAt: 'desc' },
  });

  // Build system prompt
  const systemParts: string[] = [
    'You are an AI document review assistant. You are responding to a comment on a specific part of a document.',
    'Your response should be helpful, specific, and focused on the highlighted text and the user\'s comment.',
    'If the user is asking for changes, describe what you would suggest changing and why.',
    '',
    '## Document Content',
    documentContent,
    '',
    '## Highlighted Text (being commented on)',
    `"${anchorText}"`,
  ];

  if (memories.length > 0) {
    systemParts.push('', '## Learned Memories (apply these in your responses)');
    memories.forEach(m => {
      systemParts.push(`- [${m.category}] ${m.content}`);
    });
  }

  if (knowledgeItems.length > 0) {
    systemParts.push('', '## Knowledge Base');
    knowledgeItems.forEach(k => {
      systemParts.push(`- **${k.title}**: ${k.content}`);
    });
  }

  // Convert thread messages to AI SDK format
  const messages = threadMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  return {
    systemPrompt: systemParts.join('\n'),
    messages,
  };
}

// Build system prompt for main chat with memory injection
export async function buildChatSystemPrompt(sessionId?: string): Promise<string> {
  const memories = await prisma.memory.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });

  const parts: string[] = [
    'You are an AI writing assistant. When the user asks you to write or create a document, generate it in Markdown format.',
    'Always respond with the document content wrapped in a markdown code block with the language tag "document":',
    '',
    '```document',
    '# Document Title',
    '',
    'Document content here...',
    '```',
    '',
    'If the user asks a question that does not require document generation, respond normally without the document wrapper.',
    'Write comprehensive, well-structured documents with proper headings, lists, and formatting.',
  ];

  if (memories.length > 0) {
    parts.push('', '## Important - Learned Preferences & Knowledge (always apply these):');
    memories.forEach(m => {
      parts.push(`- [${m.category}] ${m.content}`);
    });
  }

  return parts.join('\n');
}

// Build context for suggestion generation
export async function buildSuggestionContext(params: {
  documentContent: string;
  anchorText: string;
  threadDiscussion: string;
}): Promise<string> {
  const { documentContent, anchorText, threadDiscussion } = params;

  const memories = await prisma.memory.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });

  const parts: string[] = [
    'You are an AI document editor. Based on the discussion in a comment thread, generate a specific text edit suggestion.',
    'Return ONLY the replacement text that should replace the highlighted section. Do not include explanations.',
    '',
    '## Full Document',
    documentContent,
    '',
    '## Text to Replace',
    `"${anchorText}"`,
    '',
    '## Discussion Context',
    threadDiscussion,
  ];

  if (memories.length > 0) {
    parts.push('', '## Learned Preferences (apply these):');
    memories.forEach(m => {
      parts.push(`- [${m.category}] ${m.content}`);
    });
  }

  return parts.join('\n');
}
