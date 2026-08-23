'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  MessageSquare,
  MessagesSquare,
  Sparkles,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { COMMENT_THREAD_FOCUS_EVENT } from '@/lib/comments/constants';
import { OPEN_MANUAL_COMMENT_COMPOSER_EVENT } from '@/lib/comments/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/language-provider';
import { FirstUseGuide } from '@/components/layout/first-use-guide';
import { OPEN_AGENT_COMPOSER_EVENT } from '@/agent/events';
import {
  parseWorkspaceAssistantTab,
  type WorkspaceAssistantTab,
} from '@/lib/workspace/route';

export function AssistantRail({
  chat,
  context,
  defaultTab = 'chat',
  chatHref,
  onValueChange,
  room,
  review,
  reviewCount = 0,
  status,
  value,
}: {
  chat: React.ReactNode;
  chatHref: string;
  context: React.ReactNode;
  defaultTab?: WorkspaceAssistantTab;
  onValueChange?: (value: WorkspaceAssistantTab) => void;
  room: React.ReactNode;
  review: React.ReactNode;
  reviewCount?: number;
  status: React.ReactNode;
  value?: WorkspaceAssistantTab;
}) {
  const t = useT();
  const [uncontrolledTab, setUncontrolledTab] = React.useState(defaultTab);
  const tab = value ?? uncontrolledTab;
  const selectTab = React.useCallback(
    (nextTab: WorkspaceAssistantTab) => {
      if (value === undefined) {
        setUncontrolledTab(nextTab);
      }
      onValueChange?.(nextTab);
    },
    [onValueChange, value],
  );
  const tabMeta = React.useMemo(
    () => ({
      room: {
        title: t('assistant.room'),
        description: t('assistant.roomDescription'),
        guideTitle: '',
        guideDescription: '',
        testId: 'project-room-surface',
      },
      status: {
        title: t('assistant.status'),
        description: t('assistant.statusDescription'),
        guideTitle: t('guide.statusTitle'),
        guideDescription: t('guide.statusDescription'),
        testId: 'first-use-guide-status',
      },
      review: {
        title: t('assistant.review'),
        description: t('assistant.reviewDescription'),
        guideTitle: t('guide.reviewTitle'),
        guideDescription: t('guide.reviewDescription'),
        testId: 'first-use-guide-review',
      },
      chat: {
        title: t('assistant.chat'),
        description: t('assistant.chatDescription'),
        guideTitle: t('guide.chatTitle'),
        guideDescription: t('guide.chatDescription'),
        testId: 'first-use-guide-chat',
      },
      context: {
        title: t('assistant.context'),
        description: t('assistant.contextDescription'),
        guideTitle: t('guide.contextTitle'),
        guideDescription: t('guide.contextDescription'),
        testId: 'first-use-guide-context',
      },
    }),
    [t],
  );
  const currentTabMeta = tabMeta[tab];

  React.useEffect(() => {
    const handleFocus = () => {
      selectTab('review');
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    window.addEventListener(OPEN_MANUAL_COMMENT_COMPOSER_EVENT, handleFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
      window.removeEventListener(
        OPEN_MANUAL_COMMENT_COMPOSER_EVENT,
        handleFocus,
      );
    };
  }, [selectTab]);

  React.useEffect(() => {
    const handleAgentComposerOpen = () => {
      selectTab('chat');
    };

    window.addEventListener(OPEN_AGENT_COMPOSER_EVENT, handleAgentComposerOpen);
    return () => {
      window.removeEventListener(
        OPEN_AGENT_COMPOSER_EVENT,
        handleAgentComposerOpen,
      );
    };
  }, [selectTab]);

  if (tab === 'room') {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background md:border-l md:border-border">
        <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-2">
          <Button asChild className="min-w-0" size="sm" variant="ghost">
            <Link
              className="touch-manipulation"
              data-testid="room-back-to-chat"
              href={chatHref}
            >
              <ArrowLeft aria-hidden="true" className="shrink-0" />
              <span className="truncate">{t('assistant.chat')}</span>
            </Link>
          </Button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{room}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background md:border-l md:border-border">
      <Tabs
        value={tab}
        onValueChange={(nextValue) =>
          selectTab(parseWorkspaceAssistantTab(nextValue))
        }
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border px-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold text-foreground">
                {currentTabMeta.title}
              </div>
              {tab === 'review' && reviewCount > 0 ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {reviewCount}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {currentTabMeta.description}
            </p>
          </div>
          <TabsList className="mt-3 grid w-full grid-cols-4">
            <TabsTrigger
              value="chat"
              className="text-xs"
              data-testid="assistant-tab-chat"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              {t('assistant.chat')}
            </TabsTrigger>
            <TabsTrigger
              value="status"
              className="text-xs"
              data-testid="assistant-tab-status"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('assistant.status')}
            </TabsTrigger>
            <TabsTrigger
              value="review"
              className="text-xs"
              data-testid="assistant-tab-review"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t('assistant.review')}
              {reviewCount > 0 && tab !== 'review' ? (
                <Badge
                  variant="secondary"
                  className="ml-1 px-1 py-0 text-[10px]"
                >
                  {reviewCount}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger
              value="context"
              className="text-xs"
              data-testid="assistant-tab-context"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {t('assistant.context')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          forceMount
          value="status"
          className={cn(
            'mt-0 min-h-0 flex-1 overflow-hidden',
            tab !== 'status' && 'hidden',
          )}
        >
          <GuidedAssistantContent
            description={tabMeta.status.guideDescription}
            guideId="assistant-status"
            testId={tabMeta.status.testId}
            title={tabMeta.status.guideTitle}
          >
            {status}
          </GuidedAssistantContent>
        </TabsContent>
        <TabsContent
          forceMount
          value="review"
          className={cn(
            'mt-0 min-h-0 flex-1 overflow-hidden',
            tab !== 'review' && 'hidden',
          )}
        >
          <GuidedAssistantContent
            description={tabMeta.review.guideDescription}
            guideId="assistant-review"
            testId={tabMeta.review.testId}
            title={tabMeta.review.guideTitle}
          >
            {review}
          </GuidedAssistantContent>
        </TabsContent>
        <TabsContent
          forceMount
          value="chat"
          className={cn(
            'mt-0 min-h-0 flex-1 overflow-hidden',
            tab !== 'chat' && 'hidden',
          )}
        >
          <GuidedAssistantContent
            description={tabMeta.chat.guideDescription}
            guideId="assistant-chat"
            testId={tabMeta.chat.testId}
            title={tabMeta.chat.guideTitle}
          >
            {chat}
          </GuidedAssistantContent>
        </TabsContent>
        <TabsContent
          forceMount
          value="context"
          className={cn(
            'mt-0 min-h-0 flex-1 overflow-hidden',
            tab !== 'context' && 'hidden',
          )}
        >
          <GuidedAssistantContent
            description={tabMeta.context.guideDescription}
            guideId="assistant-context"
            testId={tabMeta.context.testId}
            title={tabMeta.context.guideTitle}
          >
            {context}
          </GuidedAssistantContent>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GuidedAssistantContent({
  children,
  description,
  guideId,
  testId,
  title,
}: {
  children: React.ReactNode;
  description: string;
  guideId: string;
  testId: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <FirstUseGuide
        className="m-3 mb-0"
        description={description}
        guideId={guideId}
        testId={testId}
        title={title}
        variant="compact"
      />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
