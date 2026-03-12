import type { Value } from 'platejs';
import type { CommentThreadData } from '@/types';
import type { TComment } from '@/components/ui/comment';
import type { TDiscussion } from '@/components/editor/plugins/discussion-kit';

export function threadsToDiscussions(threads: CommentThreadData[]): TDiscussion[] {
  return threads.map(thread => ({
    id: thread.id,
    comments: thread.messages
      .filter(message => message.role !== 'system')
      .map(message => ({
        id: message.id,
        contentRich: plainTextToValue(message.content),
        createdAt: new Date(message.createdAt),
        discussionId: thread.id,
        isEdited: false,
        userId: roleToUserId(message.role),
      })),
    createdAt: new Date(thread.createdAt),
    isResolved: thread.status === 'resolved',
    userId: 'user',
    documentContent: thread.anchorText,
  }));
}

function plainTextToValue(content: string): Value {
  const lines = content.split('\n');
  const blocks = lines.map(line => ({
    type: 'p',
    children: [{ text: line }],
  }));

  return blocks.length > 0 ? blocks : [{ type: 'p', children: [{ text: '' }] }];
}

function roleToUserId(role: string): TComment['userId'] {
  if (role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}
