'use client';

import * as React from 'react';
import type { Value } from 'platejs';
import { LoaderCircle, Sparkles } from 'lucide-react';

import { WebSelectionCommentTrigger } from '@/components/comments/web-selection-comment-trigger';
import { resolveCommentCapability } from '@/derive/comment-capability';
import { safeJsonParse } from '@/framework/resilience';
import { DeliverableOutlineItem } from '@/components/workspace/deliverable-sidebar';
import { EditorWrapper } from '@/components/editor/editor-wrapper';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { markdownToPlate, plateToMarkdown } from '@/lib/ai/serializer';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  requestManualCommentComposerOpen,
} from '@/lib/comments/constants';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import {
  buildPreviewBridgeUrl,
  WEB_PREVIEW_BRIDGE_CHANNEL,
} from '@/lib/workspace/preview-bridge';
import {
  getWorkspaceFileDisplayName,
  isPlateBackedWorkspaceFile,
} from '@/lib/workspace/file-presentation';
import {
  extractSlidePageCards,
} from '@/lib/workspace/slide-pages';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import type {
  CommentThreadData,
  DeliverableType,
  RenderAs,
  WorkspaceWorkflowStatusData,
  WorkspaceViewData,
} from '@/types';

export function buildDeliverablePanel(params: {
  commentContextContent: string;
  currentFile: WorkspaceViewData['currentFile'];
  selectedVersion: WorkspaceViewData['selectedVersion'];
  currentText: string;
  draftRevision: number | null;
  deliverableTitle: string;
  renderAs: RenderAs;
  documentPlaceholder: string;
  editorContent: Value | null;
  fileContent: string;
  headerActions: React.ReactNode;
  isAssistantBusy: boolean;
  isFirstPassQueued: boolean;
  isReadOnly: boolean;
  isSavingTextFile: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  noDocumentDescription: string;
  noDocumentTitle: string;
  openPreviewLabel: string;
  onChange: (content: string) => void;
  onGenerateFirstPass: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  previewAnchorFileId: string | null;
  previewEmptyDescription: string;
  previewEmptyTitle: string;
  previewNotReadyTitle: string;
  previewRunId: string | null;
  previewUnavailableDescription: string;
  previewUrl: string | null;
  readOnlyLabel: string;
  reviewThreads: CommentThreadData[];
  supportMaterialLabel: string;
  onRestoreLatest?: (() => void) | undefined;
  onThreadsChanged: () => Promise<void>;
  savingLabel: string;
  showImplementation: boolean;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  versionActionLabel: string;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  chatError: {
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null;
  t: ReturnType<typeof useT>;
  workspaceId: string;
}) {
  const isSupportFile = params.currentFile?.role === 'support';
  const richtextLikeFile = isPlateBackedWorkspaceFile(params.currentFile);
  const isErrorState = !params.selectedVersion && !!params.chatError;
  const projectedRichtextValue = params.editorContent || parsePlateContent(params.fileContent);
  const statusTitle = isErrorState
    ? params.chatError!.error.message
    : params.isFirstPassQueued
      ? params.t('workflow.implementingTitle')
      : params.workflowStatus?.statusTitle || params.noDocumentTitle;
  const statusDescription = isErrorState
    ? params.chatError!.error.detail
    : params.isFirstPassQueued
      ? params.t('workspace.aiPreparingFirstPass')
      : params.workflowStatus?.statusDescription || params.noDocumentDescription;
  const errorAction = isErrorState && params.chatError?.retryFn ? (
    <Button size="sm" onClick={params.chatError.retryFn}>
      {params.t ? params.t('chat.retry') : 'Retry'}
    </Button>
  ) : undefined;

  const showIntentCanvas =
    !isSupportFile && !params.showImplementation && params.renderAs !== 'document';
  const editorStatusTone = params.selectedVersion
    ? 'locked'
    : params.workflowStatus?.phase === 'blocked'
      ? 'blocked'
      : params.workflowStatus?.phase === 'reviewing' ||
          params.workflowStatus?.phase === 'preview_ready' ||
          params.workflowStatus?.phase === 'preview_running' ||
          params.workflowStatus?.phase === 'finalized'
        ? 'reviewing'
        : 'draft';
  const editorStatusLabel = params.selectedVersion
    ? undefined
    : params.isFirstPassQueued
      ? params.t('workflow.implementingTitle')
      : params.workflowStatus?.statusTitle || undefined;
  const surfaceTitle =
    isSupportFile && params.currentFile
      ? getWorkspaceFileDisplayName(params.currentFile)
      : params.deliverableTitle;
  const showActivitySurface =
    !isSupportFile &&
    !params.selectedVersion &&
    !params.currentText.trim() &&
    (params.workflowStatus?.phase === 'planning' ||
      params.workflowStatus?.phase === 'implementing');
  const canStartFirstPass =
    !isErrorState &&
    !params.selectedVersion &&
    !params.isFirstPassQueued &&
    params.workflowStatus?.primaryAction === 'generate_first_pass';
  const activityVariant =
    params.workflowStatus?.phase === 'implementing' ||
    params.isAssistantBusy ||
    params.isFirstPassQueued
      ? 'working'
      : 'idle';
  const firstPassAction = canStartFirstPass ? (
    <Button
      size="sm"
      onClick={params.onGenerateFirstPass}
      disabled={params.isAssistantBusy || params.isFirstPassQueued}
    >
      {params.isAssistantBusy || params.isFirstPassQueued
        ? params.t('plan.aiDrafting')
        : params.t('plan.firstPassAction')}
    </Button>
  ) : undefined;
  const commentCapability = resolveCommentCapability({
    previewRunning: Boolean(params.previewRunId || params.previewUrl),
    renderAs: params.renderAs,
    workflowPhase: params.workflowStatus?.phase,
  });
  const manualCommentAction =
    commentCapability === 'manual' ? (
      <Button size="sm" variant="outline" onClick={requestManualCommentComposerOpen}>
        {params.t('comments.manualOpenComposer')}
      </Button>
    ) : null;

  if (showIntentCanvas && params.renderAs === 'web') {
    return (
      <WebDeliverableCanvas
        actions={params.headerActions}
        commentAction={manualCommentAction}
        workflowStatus={params.workflowStatus}
        draftRevision={params.draftRevision}
        documentContent={params.commentContextContent}
        fileId={params.previewAnchorFileId}
        isAssistantBusy={params.isAssistantBusy}
        isFirstPassQueued={params.isFirstPassQueued}
        isStartingPreview={params.isStartingPreview}
        isStoppingPreview={params.isStoppingPreview}
        onGenerateFirstPass={params.onGenerateFirstPass}
        onStartPreview={params.onStartPreview}
        onStopPreview={params.onStopPreview}
        previewCapability={params.previewCapability}
        previewEmptyDescription={params.previewEmptyDescription}
        previewEmptyTitle={params.previewEmptyTitle}
        previewNotReadyTitle={params.previewNotReadyTitle}
        previewRunId={params.previewRunId}
        previewUnavailableDescription={params.previewUnavailableDescription}
        previewUrl={params.previewUrl}
        reviewThreads={params.reviewThreads}
        onRestoreLatest={params.onRestoreLatest}
        onThreadsChanged={params.onThreadsChanged}
        versionId={params.selectedVersion?.id || null}
        startPreviewLabel={params.startPreviewLabel}
        startingLabel={params.startingLabel}
        stopPreviewLabel={params.stopPreviewLabel}
        stoppingLabel={params.stoppingLabel}
        subtitle={params.readOnlyLabel}
        title={params.deliverableTitle}
        workspaceId={params.workspaceId}
        chatError={params.chatError}
      />
    );
  }

  if (
    showIntentCanvas &&
    params.renderAs === 'slides'
  ) {
    return (
      <SlidesDeliverableCanvas
        actions={params.headerActions}
        commentAction={manualCommentAction}
        workflowStatus={params.workflowStatus}
        isAssistantBusy={params.isAssistantBusy}
        isFirstPassQueued={params.isFirstPassQueued}
        onGenerateFirstPass={params.onGenerateFirstPass}
        value={projectedRichtextValue}
        subtitle={params.readOnlyLabel}
        title={params.deliverableTitle}
      />
    );
  }

  if (richtextLikeFile && params.currentFile) {
    if (showActivitySurface || isErrorState) {
      return (
        <RenderingDeliverableCanvas
          actions={params.headerActions}
          action={combineActions(errorAction || firstPassAction, manualCommentAction)}
          statusDescription={statusDescription}
          statusTitle={statusTitle}
          subtitle={params.readOnlyLabel}
          title={surfaceTitle}
          variant={isErrorState ? 'idle' : activityVariant}
        />
      );
    }

    return (
      <EditorWrapper
        commentSidebarOpen={false}
        documentId={params.workspaceId}
        documentContent={params.commentContextContent}
        fileId={params.currentFile.id}
        headerActions={params.headerActions}
        initialContent={params.editorContent}
        onContentChange={params.onChange}
        onLockVersion={() => undefined}
        onUnlock={() => undefined}
        placeholder={params.documentPlaceholder}
        primaryActionLabel={params.versionActionLabel}
        readOnly={params.isReadOnly}
        sessionId={`${params.workspaceId}:conversation`}
        showCommentAction={false}
        showVersionControls={false}
        versionId={params.selectedVersion?.id || null}
        draftRevision={params.selectedVersion ? null : params.draftRevision}
        status={params.selectedVersion ? 'locked' : 'draft'}
        statusLabel={editorStatusLabel}
        statusTone={editorStatusTone}
        title={surfaceTitle}
        emptyDescription={params.noDocumentDescription}
        emptyTitle={params.noDocumentTitle}
        workspaceId={params.workspaceId}
      />
    );
  }

  return (
    <SourceDeliverableCanvas
      actions={params.headerActions}
      commentAction={manualCommentAction}
      content={params.fileContent}
      isReadOnly={params.isReadOnly}
      isSaving={params.isSavingTextFile}
      onChange={params.onChange}
      savingLabel={params.savingLabel}
      subtitle={isSupportFile ? params.supportMaterialLabel : params.readOnlyLabel}
      title={getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle}
    />
  );
}

function RenderingDeliverableCanvas({
  actions,
  action,
  statusDescription,
  statusTitle,
  subtitle,
  title,
  variant = 'working',
}: {
  actions: React.ReactNode;
  action?: React.ReactNode;
  statusDescription: string;
  statusTitle: string;
  subtitle: string;
  title: string;
  variant?: 'idle' | 'working';
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="rendering-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>

      <DeliverableActivityState
        action={action}
        description={statusDescription}
        title={statusTitle}
        variant={variant}
      />
    </div>
  );
}

function SlidesDeliverableCanvas({
  actions,
  commentAction,
  workflowStatus,
  isAssistantBusy,
  isFirstPassQueued,
  onGenerateFirstPass,
  subtitle,
  value,
  title,
}: {
  actions: React.ReactNode;
  commentAction?: React.ReactNode;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  isAssistantBusy: boolean;
  isFirstPassQueued: boolean;
  onGenerateFirstPass: () => void;
  subtitle: string;
  value: Value;
  title: string;
}) {
  const t = useT();
  const slides = React.useMemo(() => extractSlidePageCards(value, title), [title, value]);
  const hasSlides = slides.length > 0;
  const statusTitle = hasSlides
    ? isFirstPassQueued
      ? t('workflow.implementingTitle')
      : workflowStatus?.statusTitle || t('workspace.slidesPreviewTitle')
    : isFirstPassQueued
      ? t('workflow.implementingTitle')
      : workflowStatus?.statusTitle || t('workspace.slidesEmptyTitle');
  const statusDescription = hasSlides
    ? isFirstPassQueued
      ? t('workspace.aiPreparingFirstPass')
      : workflowStatus?.statusDescription || t('workspace.slidesPreviewDescription')
    : isFirstPassQueued
      ? t('workspace.aiPreparingFirstPass')
      : workflowStatus?.statusDescription || t('workspace.slidesEmptyDescription');
  const showGenerateFirstPassAction =
    !isFirstPassQueued && workflowStatus?.primaryAction === 'generate_first_pass';

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="slides-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {commentAction}
          {actions}
        </div>
      </div>

      {hasSlides ? (
        <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.06),_transparent_55%)] px-5 py-5">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="rounded-[28px] border border-primary/15 bg-background/95 px-5 py-5 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-primary/80">
                  {t('workspace.slideResultBadge')}
                </span>
                <span className="text-sm font-medium text-foreground">{statusTitle}</span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {statusDescription}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {slides.map((slide, index) => (
                <section
                  key={slide.id}
                  className="flex min-h-64 flex-col rounded-[28px] border border-border/70 bg-background/95 px-5 py-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {t('workspace.slideCardLabel', { index: index + 1 })}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold leading-tight text-foreground">
                    {slide.title}
                  </h3>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    {slide.body.length > 0 ? (
                      slide.body.map((paragraph, paragraphIndex) => (
                        <p key={`${slide.id}-${paragraphIndex}`}>{paragraph}</p>
                      ))
                    ) : (
                      <p>{t('workspace.slidesCardEmpty')}</p>
                    )}
                  </div>
                  {slide.notes ? (
                    <div className="mt-auto pt-4 text-xs leading-5 text-muted-foreground/90">
                      Notes: {slide.notes}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <DeliverableActivityState
          action={combineActions(
            showGenerateFirstPassAction ? (
              <Button
                size="sm"
                onClick={onGenerateFirstPass}
                disabled={isAssistantBusy || isFirstPassQueued}
              >
                {isAssistantBusy || isFirstPassQueued
                  ? t('plan.aiDrafting')
                  : t('plan.firstPassAction')}
              </Button>
            ) : undefined,
            commentAction
          )}
          description={statusDescription}
          title={statusTitle}
          variant={showGenerateFirstPassAction ? 'idle' : 'working'}
        />
      )}
    </div>
  );
}

function WebDeliverableCanvas({
  actions,
  commentAction,
  workflowStatus,
  draftRevision,
  documentContent,
  fileId,
  isAssistantBusy,
  isFirstPassQueued,
  isStartingPreview,
  isStoppingPreview,
  onGenerateFirstPass,
  onStartPreview,
  onStopPreview,
  previewCapability,
  previewEmptyDescription,
  previewEmptyTitle,
  previewNotReadyTitle,
  previewRunId,
  previewUnavailableDescription,
  previewUrl,
  reviewThreads,
  onRestoreLatest,
  onThreadsChanged,
  versionId,
  startPreviewLabel,
  startingLabel,
  stopPreviewLabel,
  stoppingLabel,
  subtitle,
  title,
  workspaceId,
  chatError,
}: {
  actions: React.ReactNode;
  commentAction?: React.ReactNode;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  draftRevision?: number | null;
  documentContent: string;
  fileId?: string | null;
  isAssistantBusy: boolean;
  isFirstPassQueued: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  onGenerateFirstPass: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  previewEmptyDescription: string;
  previewEmptyTitle: string;
  previewNotReadyTitle: string;
  previewRunId: string | null;
  previewUnavailableDescription: string;
  previewUrl: string | null;
  reviewThreads: CommentThreadData[];
  onRestoreLatest?: (() => void) | undefined;
  onThreadsChanged: () => Promise<void>;
  versionId?: string | null;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  subtitle: string;
  title: string;
  workspaceId: string;
  chatError: {
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null;
}) {
  const t = useT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const iframePreviewUrl = previewRunId
    ? buildPreviewBridgeUrl({
        runId: previewRunId,
        workspaceId,
      })
    : previewUrl;
  const isErrorState = !!chatError;
  const statusTitle = isErrorState
    ? chatError!.error.message
    : isFirstPassQueued
      ? t('workflow.implementingTitle')
      : workflowStatus?.statusTitle ||
      (previewCapability.canPreview ? previewEmptyTitle : previewNotReadyTitle);
  const statusDescription = isErrorState
    ? chatError!.error.detail
    : isFirstPassQueued
      ? t('workspace.aiPreparingFirstPass')
      : workflowStatus?.blockedReason ||
      workflowStatus?.statusDescription ||
      (previewCapability.canPreview
        ? previewEmptyDescription
        : previewUnavailableDescription);
  const showStartPreviewAction =
    !isErrorState &&
    !previewUrl &&
    previewCapability.canPreview &&
    workflowStatus?.primaryAction === 'start_preview';
  const showGenerateFirstPassAction =
    !isErrorState &&
    !previewUrl &&
    !isFirstPassQueued &&
    workflowStatus?.primaryAction === 'generate_first_pass';
  const showRestoreAction =
    !isErrorState &&
    !previewUrl &&
    workflowStatus?.primaryAction === 'restore_latest' &&
    onRestoreLatest;
  const errorAction = isErrorState && chatError?.retryFn ? (
    <Button size="sm" onClick={chatError.retryFn}>{t('chat.retry')}</Button>
  ) : null;

  React.useEffect(() => {
    const handleThreadFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (!detail?.threadId || !iframeRef.current?.contentWindow) {
        return;
      }

      const thread = reviewThreads.find((item) => item.id === detail.threadId);
      if (thread?.reviewAnchor?.surfaceType !== 'web-component') {
        return;
      }

      iframeRef.current.contentWindow.postMessage(
        {
          channel: WEB_PREVIEW_BRIDGE_CHANNEL,
          type: 'focus',
          payload: {
            excerpt:
              typeof thread.reviewAnchor.anchorPayload?.excerpt === 'string'
                ? thread.reviewAnchor.anchorPayload.excerpt
                : null,
            cssSelector:
              typeof thread.reviewAnchor.anchorPayload?.cssSelector === 'string'
                ? thread.reviewAnchor.anchorPayload.cssSelector
                : typeof thread.reviewAnchor.anchorPayload?.selector === 'string'
                  ? thread.reviewAnchor.anchorPayload.selector
                  : null,
            domContext:
              typeof thread.reviewAnchor.anchorPayload?.domContext === 'string'
                ? thread.reviewAnchor.anchorPayload.domContext
                : null,
            selector:
              typeof thread.reviewAnchor.anchorPayload?.selector === 'string'
                ? thread.reviewAnchor.anchorPayload.selector
                : null,
          },
        },
        '*'
      );
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    };
  }, [reviewThreads]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="web-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {commentAction}
          {iframePreviewUrl ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onStopPreview}
              disabled={isStoppingPreview}
            >
              {isStoppingPreview ? stoppingLabel : stopPreviewLabel}
            </Button>
          ) : null}
          {actions}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {iframePreviewUrl ? (
          <div className="relative h-full">
            <iframe
              ref={iframeRef}
              src={iframePreviewUrl}
              className="h-full w-full border-0 bg-white"
              title={title}
            />
            <WebSelectionCommentTrigger
              draftRevision={draftRevision}
              documentContent={documentContent}
              fileId={fileId}
              iframeRef={iframeRef}
              onThreadsChanged={onThreadsChanged}
              versionId={versionId}
              workspaceId={workspaceId}
            />
          </div>
        ) : (
          <DeliverableActivityState
            action={combineActions(
              errorAction ? errorAction : showStartPreviewAction ? (
                <Button
                  size="sm"
                  onClick={onStartPreview}
                  disabled={isStartingPreview}
                >
                  {isStartingPreview ? startingLabel : startPreviewLabel}
                </Button>
              ) : showGenerateFirstPassAction ? (
                <Button
                  size="sm"
                  onClick={onGenerateFirstPass}
                  disabled={isAssistantBusy || isFirstPassQueued}
                >
                  {isAssistantBusy || isFirstPassQueued
                    ? t('plan.aiDrafting')
                    : t('plan.firstPassAction')}
                </Button>
              ) : showRestoreAction ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRestoreLatest}
                >
                  {t('version.restore')}
                </Button>
              ) : null,
              commentAction
            )}
            description={statusDescription}
            title={statusTitle}
            variant={showGenerateFirstPassAction ? 'idle' : 'working'}
          />
        )}
      </div>
    </div>
  );
}

function DeliverableActivityState({
  action,
  description,
  title,
  variant = 'working',
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
  variant?: 'idle' | 'working';
}) {
  return (
    <div
      aria-busy={variant === 'working'}
      aria-live="polite"
      className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.06),_transparent_55%)] px-4 py-8 sm:px-8 sm:py-10"
      role="status"
    >
      <div className="w-full max-w-2xl rounded-[32px] border border-primary/15 bg-background/95 p-8 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]">
        <div className="flex flex-col items-center text-center">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            {variant === 'working' ? (
              <>
                <div aria-hidden="true" className="absolute inset-0 rounded-full border border-primary/25 animate-ping [animation-duration:2.8s] motion-reduce:animate-none" />
                <div aria-hidden="true" className="absolute inset-2 rounded-full bg-primary/8 animate-pulse motion-reduce:animate-none" />
                <LoaderCircle aria-hidden="true" className="relative h-7 w-7 animate-spin text-primary motion-reduce:animate-none" />
              </>
            ) : (
              <>
                <div className="absolute inset-2 rounded-full bg-primary/8" />
                <Sparkles className="relative h-7 w-7 text-primary" />
              </>
            )}
          </div>
          <p className="mt-5 text-lg font-semibold text-foreground">{title}</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {action && variant === 'idle' ? (
            <div className="mt-6 flex justify-center">{action}</div>
          ) : null}
        </div>

        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-border/70 bg-muted/25 px-4 py-4"
            >
              <div
                className={cn(
                  'h-2.5 rounded-full',
                  variant === 'working'
                    ? 'bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10 animate-pulse motion-reduce:animate-none'
                    : 'bg-muted-foreground/10'
                )}
                style={{
                  animationDelay: `${index * 180}ms`,
                  width: `${92 - index * 14}%`,
                }}
              />
              <div
                className={cn(
                  'mt-3 h-2 rounded-full bg-muted-foreground/10',
                  variant === 'working' && 'animate-pulse motion-reduce:animate-none'
                )}
                style={{
                  animationDelay: `${index * 220 + 120}ms`,
                  width: `${70 - index * 8}%`,
                }}
              />
            </div>
          ))}
        </div>

        {action && variant === 'working' ? (
          <div className="mt-6 flex justify-center">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

function SourceDeliverableCanvas({
  actions,
  commentAction,
  content,
  isReadOnly,
  isSaving,
  onChange,
  savingLabel,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  commentAction?: React.ReactNode;
  content: string;
  isReadOnly: boolean;
  isSaving: boolean;
  onChange: (content: string) => void;
  savingLabel: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="source-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {commentAction}
          {isSaving ? <span className="text-xs text-muted-foreground">{savingLabel}</span> : null}
          {actions}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <Textarea
          value={content}
          onChange={(event) => onChange(event.target.value)}
          readOnly={isReadOnly}
          className="h-full min-h-full resize-none rounded-none border-0 px-4 py-4 font-mono text-sm shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

export function parsePlateContent(content: string): Value {
  const parsed = safeJsonParse<unknown>(content, null);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  // Legacy markdown content: convert to Plate JSON for rich-text rendering
  if (content.trim()) {
    return markdownToPlate(content);
  }

  return [{ type: 'p', children: [{ text: '' }] }];
}

export function normalizeDeliverableText(content: string) {
  const parsed = safeJsonParse<unknown>(content, null);
  if (Array.isArray(parsed)) {
    return plateToMarkdown(parsed);
  }

  return content;
}

function combineActions(...actions: Array<React.ReactNode | null | undefined>) {
  const visibleActions = actions.filter(Boolean);
  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {visibleActions.map((action, index) => (
        <React.Fragment key={index}>{action}</React.Fragment>
      ))}
    </div>
  );
}

export function buildOutlineItems(params: {
  currentFile: WorkspaceViewData['currentFile'];
  deliverableTitle: string;
  deliverableType: DeliverableType;
  text: string;
}): DeliverableOutlineItem[] {
  const shouldParseHeadings =
    params.deliverableType === 'document' || params.currentFile?.role === 'support';

  if (!shouldParseHeadings) {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle,
      },
    ];
  }

  const headings = params.text
    .split('\n')
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        depth: Math.max(0, match[1].length - 1),
        label: match[2].trim(),
      };
    })
    .filter((item): item is Omit<DeliverableOutlineItem, 'id'> => Boolean(item))
    .map((item, index) => ({
      ...item,
      id: `heading-${index}`,
    }));

  if (headings.length === 0) {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle,
      },
    ];
  }

  return headings;
}
