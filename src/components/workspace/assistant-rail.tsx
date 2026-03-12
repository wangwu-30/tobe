'use client';

import * as React from 'react';
import { BookOpen, MessageSquare, Sparkles, MessagesSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { COMMENT_THREAD_FOCUS_EVENT } from '@/lib/comments/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/language-provider';

export function AssistantRail({
  chat,
  context,
  defaultTab = 'plan',
  plan,
  review,
  reviewCount = 0,
}: {
  chat: React.ReactNode;
  context: React.ReactNode;
  defaultTab?: 'plan' | 'review' | 'chat' | 'context';
  plan: React.ReactNode;
  review: React.ReactNode;
  reviewCount?: number;
}) {
  const t = useT();
  const [tab, setTab] = React.useState(defaultTab);

  React.useEffect(() => {
    const handleFocus = () => {
      setTab('review');
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-background">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(
            value === 'review' || value === 'chat' || value === 'context'
              ? value
              : 'plan'
          )
        }
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border px-3 py-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="plan" className="text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              {t('assistant.plan')}
            </TabsTrigger>
            <TabsTrigger value="review" className="text-xs">
              <MessageSquare className="h-3.5 w-3.5" />
              {t('assistant.review')}
              {reviewCount > 0 ? (
                <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                  {reviewCount}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs">
              <MessagesSquare className="h-3.5 w-3.5" />
              {t('assistant.chat')}
            </TabsTrigger>
            <TabsTrigger value="context" className="text-xs">
              <BookOpen className="h-3.5 w-3.5" />
              {t('assistant.context')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          forceMount
          value="plan"
          className={cn('mt-0 min-h-0 flex-1 overflow-hidden', tab !== 'plan' && 'hidden')}
        >
          {plan}
        </TabsContent>
        <TabsContent
          forceMount
          value="review"
          className={cn('mt-0 min-h-0 flex-1 overflow-hidden', tab !== 'review' && 'hidden')}
        >
          {review}
        </TabsContent>
        <TabsContent
          forceMount
          value="chat"
          className={cn('mt-0 min-h-0 flex-1 overflow-hidden', tab !== 'chat' && 'hidden')}
        >
          {chat}
        </TabsContent>
        <TabsContent
          forceMount
          value="context"
          className={cn('mt-0 min-h-0 flex-1 overflow-hidden', tab !== 'context' && 'hidden')}
        >
          {context}
        </TabsContent>
      </Tabs>
    </div>
  );
}
