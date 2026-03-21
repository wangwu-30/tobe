'use client';

import * as React from 'react';

import { AssistantRail } from '@/components/workspace/assistant-rail';
import { AssistantPanelSurface } from '@/surfaces/assistant-panel/assistant-panel';
import { ContextPanelSurface } from '@/surfaces/context-panel/context-panel';
import { ReviewPanelSurface } from '@/surfaces/review-panel/review-panel';
import { StatusPanelSurface } from '@/surfaces/status-panel/status-panel';

type AssistantPanelProps = React.ComponentProps<typeof AssistantPanelSurface>;
type ContextPanelProps = React.ComponentProps<typeof ContextPanelSurface>;
type ReviewPanelProps = React.ComponentProps<typeof ReviewPanelSurface>;
type StatusPanelProps = React.ComponentProps<typeof StatusPanelSurface>;

export function WorkspaceAssistantRail({
  activeAssistantRun,
  activeFileId,
  activeWorkflowPlaybookId,
  allowSourceApply,
  baseVersionId,
  baseVersionLabel,
  branches,
  conversationId,
  conversationRuns,
  conversationTitle,
  currentProjectId,
  currentDraftBranchTitle,
  currentStatus,
  documentContent,
  files,
  initialMessages,
  isAssistantBusy,
  onApplyWorkflow,
  onBranchConversation,
  onBusyChange,
  onChatErrorChange,
  onConversationComplete,
  onCreateNextDeliverable,
  onOpenFile,
  onQueuedPromptHandled,
  onSelectConversation,
  onSourceContentApplied,
  onWorkspaceChange,
  plan,
  queuedPrompt,
  refreshThreads,
  reviewThreads,
  wikiId,
  workspaceId,
}: {
  activeAssistantRun: AssistantPanelProps['activeAssistantRun'];
  activeFileId: AssistantPanelProps['activeFileId'];
  activeWorkflowPlaybookId: ContextPanelProps['activeWorkflowPlaybookId'];
  allowSourceApply: ReviewPanelProps['allowSourceApply'];
  baseVersionId: AssistantPanelProps['baseVersionId'];
  baseVersionLabel: AssistantPanelProps['baseVersionLabel'];
  branches: AssistantPanelProps['branches'];
  conversationId: AssistantPanelProps['conversationId'];
  conversationRuns: AssistantPanelProps['conversationRuns'];
  conversationTitle: AssistantPanelProps['conversationTitle'];
  currentProjectId: ContextPanelProps['projectId'];
  currentDraftBranchTitle: StatusPanelProps['currentDraftBranchTitle'];
  currentStatus: StatusPanelProps['currentStatus'];
  documentContent: ReviewPanelProps['documentContent'];
  files: ReviewPanelProps['files'];
  initialMessages: AssistantPanelProps['initialMessages'];
  isAssistantBusy: StatusPanelProps['isAssistantBusy'];
  onApplyWorkflow: ContextPanelProps['onApplyWorkflow'];
  onBranchConversation: AssistantPanelProps['onBranchConversation'];
  onBusyChange: AssistantPanelProps['onBusyChange'];
  onChatErrorChange: AssistantPanelProps['onChatErrorChange'];
  onConversationComplete: AssistantPanelProps['onConversationComplete'];
  onCreateNextDeliverable: StatusPanelProps['onCreateNextDeliverable'];
  onOpenFile: AssistantPanelProps['onOpenFile'];
  onQueuedPromptHandled: AssistantPanelProps['onQueuedPromptHandled'];
  onSelectConversation: AssistantPanelProps['onSelectConversation'];
  onSourceContentApplied: ReviewPanelProps['onSourceContentApplied'];
  onWorkspaceChange: AssistantPanelProps['onWorkspaceChange'];
  plan: StatusPanelProps['plan'];
  queuedPrompt: AssistantPanelProps['queuedPrompt'];
  refreshThreads: ReviewPanelProps['refreshThreads'];
  reviewThreads: ReviewPanelProps['threads'];
  wikiId: ContextPanelProps['wikiId'];
  workspaceId: string;
}) {
  const reviewCount = reviewThreads.filter(
    (thread) =>
      (thread.status === 'open' || thread.status === 'applied') &&
      (thread.scope === 'direct' || thread.inheritanceState === 'actionable')
  ).length;

  return (
    <AssistantRail
      reviewCount={reviewCount}
      status={
        <StatusPanelSurface
          currentDraftBranchTitle={currentDraftBranchTitle}
          isAssistantBusy={isAssistantBusy}
          onCreateNextDeliverable={onCreateNextDeliverable}
          plan={plan}
          currentStatus={currentStatus}
        />
      }
      review={
        <ReviewPanelSurface
          allowSourceApply={allowSourceApply}
          className="border-0"
          documentId={workspaceId}
          documentContent={documentContent}
          files={files}
          onOpenFile={onOpenFile}
          onSourceContentApplied={onSourceContentApplied}
          refreshThreads={refreshThreads}
          threads={reviewThreads}
        />
      }
      chat={
        <AssistantPanelSurface
          activeFileId={activeFileId}
          activeAssistantRun={activeAssistantRun}
          baseVersionLabel={baseVersionLabel}
          baseVersionId={baseVersionId}
          branches={branches}
          conversationId={conversationId}
          conversationRuns={conversationRuns}
          conversationTitle={conversationTitle}
          initialMessages={initialMessages}
          onBusyChange={onBusyChange}
          onBranchConversation={onBranchConversation}
          onConversationComplete={onConversationComplete}
          onOpenFile={onOpenFile}
          onQueuedPromptHandled={onQueuedPromptHandled}
          onSelectConversation={onSelectConversation}
          onWorkspaceChange={onWorkspaceChange}
          onChatErrorChange={onChatErrorChange}
          queuedPrompt={queuedPrompt}
          workspaceId={workspaceId}
        />
      }
      context={
        <ContextPanelSurface
          activeWorkflowPlaybookId={activeWorkflowPlaybookId}
          onApplyWorkflow={onApplyWorkflow}
          projectId={currentProjectId}
          wikiId={wikiId}
        />
      }
    />
  );
}
