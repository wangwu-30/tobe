'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Archive,
  BookOpen,
  Brain,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type {
  KnowledgeItemData,
  MemoryData,
  WorkflowPlaybookData,
  WorkflowPlaybookDraftData,
  WorkflowPlaybookDraftWarningKey,
  WorkflowPlaybookStatus,
} from '@/types';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/language-provider';
import { FirstUseGuide } from '@/components/layout/first-use-guide';

export function KnowledgePanel({
  activeWorkflowPlaybookId,
  className,
  embedded = false,
  isOpen,
  onClose,
  onApplyWorkflow,
  showHeader = !embedded,
  wikiId,
}: {
  activeWorkflowPlaybookId?: string | null;
  className?: string;
  embedded?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onApplyWorkflow?: (workflowId: string | null) => Promise<void> | void;
  showHeader?: boolean;
  wikiId?: string | null;
}) {
  const t = useT();
  const [knowledgeItems, setKnowledgeItems] = React.useState<KnowledgeItemData[]>([]);
  const [memories, setMemories] = React.useState<MemoryData[]>([]);
  const [workflowPlaybooks, setWorkflowPlaybooks] = React.useState<WorkflowPlaybookData[]>(
    []
  );
  const [newTitle, setNewTitle] = React.useState('');
  const [newContent, setNewContent] = React.useState('');
  const [newWorkflowTitle, setNewWorkflowTitle] = React.useState('');
  const [newWorkflowSummary, setNewWorkflowSummary] = React.useState('');
  const [newWorkflowSteps, setNewWorkflowSteps] = React.useState('');
  const [newWorkflowConstraints, setNewWorkflowConstraints] = React.useState('');
  const [newWorkflowChecklist, setNewWorkflowChecklist] = React.useState('');
  const [newWorkflowContent, setNewWorkflowContent] = React.useState('');
  const [editingWorkflowId, setEditingWorkflowId] = React.useState<string | null>(null);
  const [editingWorkflowStatus, setEditingWorkflowStatus] =
    React.useState<WorkflowPlaybookStatus>('draft');
  const [workflowSourceVersionId, setWorkflowSourceVersionId] = React.useState<string | null>(
    null
  );
  const [workflowSourceThreadId, setWorkflowSourceThreadId] = React.useState<string | null>(
    null
  );
  const [workflowNotice, setWorkflowNotice] = React.useState<{
    tone: 'error' | 'info';
    text: string;
  } | null>(null);
  const [workflowDraftWarnings, setWorkflowDraftWarnings] = React.useState<
    WorkflowPlaybookDraftWarningKey[]
  >([]);

  const loadData = React.useCallback(async () => {
    const workflowParams = new URLSearchParams();
    if (wikiId) {
      workflowParams.set('wikiId', wikiId);
    }
    workflowParams.set('includeArchived', '1');
    const wikiQuery = wikiId ? `?wikiId=${encodeURIComponent(wikiId)}` : '';
    const [kRes, mRes, wRes] = await Promise.all([
      fetch(`/api/knowledge${wikiQuery}`),
      fetch(`/api/memories${wikiQuery}`),
      fetch(`/api/workflows?${workflowParams.toString()}`),
    ]);
    if (kRes.ok) setKnowledgeItems(await kRes.json());
    if (mRes.ok) setMemories(await mRes.json());
    if (wRes.ok) setWorkflowPlaybooks(await wRes.json());
  }, [wikiId]);

  React.useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  const addKnowledgeItem = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, content: newContent, wikiId }),
    });
    if (res.ok) {
      setNewTitle('');
      setNewContent('');
      loadData();
    }
  };

  const deleteKnowledgeItem = async (id: string) => {
    await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  const toggleMemory = async (id: string, active: boolean) => {
    await fetch('/api/memories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    });
    loadData();
  };

  const deleteMemory = async (id: string) => {
    await fetch(`/api/memories?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  const addWorkflowPlaybook = async () => {
    const hasWorkflowBody =
      newWorkflowSteps.trim() ||
      newWorkflowConstraints.trim() ||
      newWorkflowChecklist.trim() ||
      newWorkflowContent.trim();
    if (!newWorkflowTitle.trim() || !hasWorkflowBody) return;
    const res = await fetch('/api/workflows', {
      method: editingWorkflowId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingWorkflowId,
        title: newWorkflowTitle,
        summary: newWorkflowSummary,
        steps: toStructuredLines(newWorkflowSteps),
        constraints: toStructuredLines(newWorkflowConstraints),
        checklist: toStructuredLines(newWorkflowChecklist),
        content: newWorkflowContent,
        status: editingWorkflowId ? editingWorkflowStatus : 'draft',
        wikiId,
        sourceThreadId: workflowSourceThreadId,
        sourceVersionId: workflowSourceVersionId,
      }),
    });
    if (res.ok) {
      setNewWorkflowTitle('');
      setNewWorkflowSummary('');
      setNewWorkflowSteps('');
      setNewWorkflowConstraints('');
      setNewWorkflowChecklist('');
      setNewWorkflowContent('');
      setEditingWorkflowId(null);
      setEditingWorkflowStatus('draft');
      setWorkflowDraftWarnings([]);
      setWorkflowSourceVersionId(null);
      setWorkflowSourceThreadId(null);
      setWorkflowNotice({
        tone: 'info',
        text: t(editingWorkflowId ? 'context.workflowUpdated' : 'context.workflowSaved'),
      });
      loadData();
      return;
    }

    setWorkflowNotice({
      tone: 'error',
      text: t('context.workflowSaveFailed'),
    });
  };

  const deleteWorkflowPlaybook = async (id: string) => {
    await fetch(`/api/workflows?id=${id}`, { method: 'DELETE' });
    if (activeWorkflowPlaybookId === id) {
      await onApplyWorkflow?.(null);
    }
    loadData();
  };

  const duplicateWorkflowPlaybook = async (workflow: WorkflowPlaybookData) => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${workflow.title} Copy`,
        summary: workflow.summary,
        steps: workflow.steps,
        constraints: workflow.constraints,
        checklist: workflow.checklist,
        content: workflow.content,
        status: 'draft',
        wikiId,
        sourceThreadId: workflow.sourceThreadId,
        sourceVersionId: workflow.sourceVersionId,
      }),
    });

    if (res.ok) {
      setWorkflowNotice({
        tone: 'info',
        text: t('context.workflowSaved'),
      });
      loadData();
      return;
    }

    setWorkflowNotice({
      tone: 'error',
      text: t('context.workflowSaveFailed'),
    });
  };

  const editWorkflowPlaybook = React.useCallback((workflow: WorkflowPlaybookData) => {
    setEditingWorkflowId(workflow.id);
    setEditingWorkflowStatus(workflow.status);
    setNewWorkflowTitle(workflow.title);
    setNewWorkflowSummary(workflow.summary);
    setNewWorkflowSteps(fromStructuredLines(workflow.steps));
    setNewWorkflowConstraints(fromStructuredLines(workflow.constraints));
    setNewWorkflowChecklist(fromStructuredLines(workflow.checklist));
    setNewWorkflowContent(workflow.content);
    setWorkflowDraftWarnings([]);
    setWorkflowSourceVersionId(workflow.sourceVersionId);
    setWorkflowSourceThreadId(workflow.sourceThreadId);
    setWorkflowNotice(null);
  }, []);

  const cancelWorkflowEdit = React.useCallback(() => {
    setEditingWorkflowId(null);
    setEditingWorkflowStatus('draft');
    setNewWorkflowTitle('');
    setNewWorkflowSummary('');
    setNewWorkflowSteps('');
    setNewWorkflowConstraints('');
    setNewWorkflowChecklist('');
    setNewWorkflowContent('');
    setWorkflowSourceVersionId(null);
    setWorkflowSourceThreadId(null);
    setWorkflowDraftWarnings([]);
    setWorkflowNotice(null);
  }, []);

  const buildWorkflowDraft = async () => {
    if (!wikiId) {
      return;
    }

    const res = await fetch('/api/workflows/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wikiId }),
    });
    const payload = (await res.json().catch(() => null)) as
      | (Partial<WorkflowPlaybookDraftData> & { error?: string })
      | null;

    if (!res.ok || !payload) {
      setWorkflowNotice({
        tone: 'error',
        text: payload?.error || t('context.workflowDraftFailed'),
      });
      return;
    }

    setEditingWorkflowId(null);
    setNewWorkflowTitle(payload.title || '');
    setNewWorkflowSummary(payload.summary || '');
    setNewWorkflowSteps(fromStructuredLines(payload.steps || []));
    setNewWorkflowConstraints(fromStructuredLines(payload.constraints || []));
    setNewWorkflowChecklist(fromStructuredLines(payload.checklist || []));
    setNewWorkflowContent(payload.content || '');
      setWorkflowDraftWarnings(
        Array.isArray(payload.warnings)
          ? payload.warnings.filter(
              (warning): warning is WorkflowPlaybookDraftWarningKey =>
                typeof warning === 'string'
            )
          : []
      );
    setWorkflowSourceVersionId(payload.sourceVersionId || null);
    setWorkflowSourceThreadId(payload.sourceThreadId || null);
    setWorkflowNotice({
      tone: 'info',
      text: t('context.workflowDraftReady'),
    });
  };

  const applyWorkflowPlaybook = async (workflowId: string | null) => {
    if (!onApplyWorkflow) {
      return;
    }

    try {
      await onApplyWorkflow(workflowId);
      setWorkflowNotice({
        tone: 'info',
        text: workflowId ? t('context.workflowApplied') : t('context.workflowCleared'),
      });
    } catch (error) {
      setWorkflowNotice({
        tone: 'error',
        text:
          error instanceof Error ? error.message : t('context.workflowApplyFailed'),
      });
    }
  };

  if (!isOpen) return null;
  const draftWorkflowPlaybooks = workflowPlaybooks.filter(
    (workflow) => workflow.status === 'draft'
  );
  const activeWorkflowPlaybooks = workflowPlaybooks.filter(
    (workflow) => workflow.status === 'active'
  );
  const archivedWorkflowPlaybooks = workflowPlaybooks.filter(
    (workflow) => workflow.status === 'archived'
  );

  const categoryColors: Record<string, string> = {
    correction: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    preference: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    domain_knowledge: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    constraint: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  };

  const updateWorkflowLifecycle = async (
    workflow: WorkflowPlaybookData,
    status: WorkflowPlaybookStatus,
    forceActivate = false
  ) => {
    const res = await fetch('/api/workflows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: workflow.id,
        forceActivate,
        status,
      }),
    });

    const payload = (await res.json().catch(() => null)) as
      | { error?: string; warnings?: WorkflowPlaybookDraftWarningKey[] }
      | null;

    if (res.ok) {
      if (status !== 'active' && activeWorkflowPlaybookId === workflow.id) {
        await onApplyWorkflow?.(null);
      }
      setWorkflowNotice({
        tone: 'info',
        text:
          status === 'active'
            ? t('context.workflowActivated')
            : status === 'archived'
              ? t('context.workflowArchived')
              : t('context.workflowRestoredToDraft'),
      });
      loadData();
      return;
    }

    if (
      status === 'active' &&
      payload?.warnings?.length &&
      window.confirm(
        `${t('context.workflowActivationNeedsReview')}\n\n${payload.warnings
          .map((warning) => `- ${t(warning)}`)
          .join('\n')}`
      )
    ) {
      await updateWorkflowLifecycle(workflow, status, true);
      return;
    }

    setWorkflowNotice({
      tone: 'error',
      text: payload?.error || t('context.workflowSaveFailed'),
    });
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        embedded
          ? 'w-full border-0 shadow-none'
          : 'w-[360px] max-w-[360px] shrink-0 border-l border-border shadow-lg',
        className
      )}
    >
      {showHeader ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4" />
              {t('assistant.context')}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('context.description')}
            </p>
          </div>
          {!embedded ? (
            <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7 shrink-0">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <ContextSection
            count={knowledgeItems.length}
            icon={<BookOpen className="h-4 w-4" />}
            title={t('context.knowledge')}
          >
            <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
              <Input
                placeholder={t('context.knowledgeTitlePlaceholder')}
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                className="h-8 text-xs"
              />
              <Textarea
                placeholder={t('context.knowledgeContentPlaceholder')}
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                className="min-h-[72px] resize-none text-xs"
                rows={3}
              />
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                onClick={addKnowledgeItem}
                disabled={!newTitle.trim() || !newContent.trim()}
              >
                <Plus className="mr-1 h-3 w-3" />
                {t('context.addKnowledge')}
              </Button>
            </div>

            {knowledgeItems.length === 0 ? (
              <ContextEmptyState
                description={t('context.noKnowledgeDescription')}
                icon={<BookOpen className="h-6 w-6" />}
                title={t('context.noKnowledgeTitle')}
              />
            ) : (
              <div className="space-y-2">
                {knowledgeItems.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium">{item.title}</h4>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 shrink-0"
                        onClick={() => deleteKnowledgeItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {item.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ContextSection>

          <ContextSection
            count={memories.length}
            icon={<Brain className="h-4 w-4" />}
            title={t('context.memories')}
          >
            {memories.length === 0 ? (
              <ContextEmptyState
                description={t('context.noMemoriesDescription')}
                icon={<Brain className="h-6 w-6" />}
                title={t('context.noMemoriesTitle')}
              />
            ) : (
              <div className="space-y-2">
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    className={cn(
                      'rounded-lg border p-3 text-xs',
                      !memory.active && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <Badge
                          className={cn(
                            'mb-1 text-[10px]',
                            categoryColors[memory.category] || ''
                          )}
                        >
                          {memory.category}
                        </Badge>
                        <p className="leading-relaxed">{memory.content}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={memory.active}
                          onCheckedChange={(checked) => toggleMemory(memory.id, checked)}
                          className="scale-75"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => deleteMemory(memory.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ContextSection>

          <ContextSection
            count={workflowPlaybooks.length}
            icon={<Workflow className="h-4 w-4" />}
            title={t('context.workflow')}
          >
            <FirstUseGuide
              className="mb-3"
              description={t('guide.workflowDescription')}
              guideId="context-workflow"
              testId="first-use-guide-workflow"
              title={t('guide.workflowTitle')}
              variant="compact"
            />
            <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
              {wikiId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-xs"
                  onClick={buildWorkflowDraft}
                >
                  {t('context.buildWorkflowDraft')}
                </Button>
              ) : null}
              <Input
                placeholder={t('context.workflowTitlePlaceholder')}
                value={newWorkflowTitle}
                onChange={(event) => setNewWorkflowTitle(event.target.value)}
                className="h-8 text-xs"
              />
              <Input
                placeholder={t('context.workflowOverviewPlaceholder')}
                value={newWorkflowSummary}
                onChange={(event) => setNewWorkflowSummary(event.target.value)}
                className="h-8 text-xs"
              />
              <WorkflowField
                label={t('context.workflowStepsLabel')}
                placeholder={t('context.workflowStepsPlaceholder')}
                rows={4}
                value={newWorkflowSteps}
                onChange={setNewWorkflowSteps}
              />
              <WorkflowField
                label={t('context.workflowConstraintsLabel')}
                placeholder={t('context.workflowConstraintsPlaceholder')}
                rows={3}
                value={newWorkflowConstraints}
                onChange={setNewWorkflowConstraints}
              />
              <WorkflowField
                label={t('context.workflowChecklistLabel')}
                placeholder={t('context.workflowChecklistPlaceholder')}
                rows={3}
                value={newWorkflowChecklist}
                onChange={setNewWorkflowChecklist}
              />
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t('context.workflowNotesLabel')}
              </div>
              <Textarea
                placeholder={t('context.workflowContentPlaceholder')}
                value={newWorkflowContent}
                onChange={(event) => setNewWorkflowContent(event.target.value)}
                className="min-h-[88px] resize-none text-xs"
                rows={4}
              />
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                onClick={addWorkflowPlaybook}
                disabled={
                  !newWorkflowTitle.trim() ||
                  !(
                    newWorkflowSteps.trim() ||
                    newWorkflowConstraints.trim() ||
                    newWorkflowChecklist.trim() ||
                    newWorkflowContent.trim()
                  )
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                {t(editingWorkflowId ? 'context.updateWorkflow' : 'context.addWorkflow')}
              </Button>
              {editingWorkflowId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full text-xs"
                  onClick={cancelWorkflowEdit}
                >
                  {t('common.cancel')}
                </Button>
              ) : null}
              {workflowNotice ? (
                <div
                  className={cn(
                    'rounded-md px-2 py-1.5 text-[11px] leading-relaxed',
                    workflowNotice.tone === 'error'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted/60 text-muted-foreground'
                  )}
                >
                  {workflowNotice.text}
                </div>
              ) : null}
              {workflowDraftWarnings.length > 0 ? (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  <div className="font-medium text-foreground">
                    {t('context.workflowDraftWarningsTitle')}
                  </div>
                  <div className="mt-1 space-y-1">
                    {workflowDraftWarnings.map((warning) => (
                      <p key={warning}>- {t(warning)}</p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {workflowPlaybooks.length === 0 ? (
              <ContextEmptyState
                description={t('context.noWorkflowsDescription')}
                icon={<Workflow className="h-6 w-6" />}
                title={t('context.noWorkflowsTitle')}
              />
            ) : (
              <div className="space-y-2">
                {draftWorkflowPlaybooks.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t('context.draftWorkflows', {
                        count: draftWorkflowPlaybooks.length,
                      })}
                    </div>
                    {draftWorkflowPlaybooks.map((workflow) => (
                      <div key={workflow.id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{workflow.title}</h4>
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {t('context.workflowDraftBadge')}
                              </Badge>
                            </div>
                            {workflow.summary ? (
                              <p className="mt-1 leading-relaxed text-muted-foreground">
                                {workflow.summary}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => void updateWorkflowLifecycle(workflow, 'active')}
                            >
                              {t('context.activateWorkflow')}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => editWorkflowPlaybook(workflow)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => duplicateWorkflowPlaybook(workflow)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => void updateWorkflowLifecycle(workflow, 'archived')}
                            >
                              <Archive className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => deleteWorkflowPlaybook(workflow.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <WorkflowPlaybookPreview workflow={workflow} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {activeWorkflowPlaybooks.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/5 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t('context.activeWorkflows', {
                        count: activeWorkflowPlaybooks.length,
                      })}
                    </div>
                    {activeWorkflowPlaybooks.map((workflow) => (
                      <div key={workflow.id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{workflow.title}</h4>
                              {activeWorkflowPlaybookId === workflow.id ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t('context.workflowActive')}
                                </Badge>
                              ) : null}
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {t('context.workflowActiveBadge')}
                              </Badge>
                            </div>
                            {workflow.summary ? (
                              <p className="mt-1 leading-relaxed text-muted-foreground">
                                {workflow.summary}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {onApplyWorkflow ? (
                              <Button
                                size="sm"
                                variant={
                                  activeWorkflowPlaybookId === workflow.id ? 'secondary' : 'outline'
                                }
                                className="h-6 px-2 text-[11px]"
                                onClick={() =>
                                  applyWorkflowPlaybook(
                                    activeWorkflowPlaybookId === workflow.id ? null : workflow.id
                                  )
                                }
                              >
                                {activeWorkflowPlaybookId === workflow.id
                                  ? t('context.clearWorkflow')
                                  : t('context.useWorkflow')}
                              </Button>
                            ) : null}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => duplicateWorkflowPlaybook(workflow)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => editWorkflowPlaybook(workflow)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => void updateWorkflowLifecycle(workflow, 'archived')}
                            >
                              <Archive className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => deleteWorkflowPlaybook(workflow.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <WorkflowPlaybookPreview workflow={workflow} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {archivedWorkflowPlaybooks.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t('context.archivedWorkflows', {
                        count: archivedWorkflowPlaybooks.length,
                      })}
                    </div>
                    {archivedWorkflowPlaybooks.map((workflow) => (
                      <div key={workflow.id} className="rounded-lg border p-3 text-xs opacity-80">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{workflow.title}</h4>
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {t('context.workflowArchivedBadge')}
                              </Badge>
                            </div>
                            {workflow.summary ? (
                              <p className="mt-1 leading-relaxed text-muted-foreground">
                                {workflow.summary}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => void updateWorkflowLifecycle(workflow, 'draft')}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => duplicateWorkflowPlaybook(workflow)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => deleteWorkflowPlaybook(workflow.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <WorkflowPlaybookPreview workflow={workflow} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </ContextSection>
        </div>
      </ScrollArea>
    </div>
  );
}

function toStructuredLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function fromStructuredLines(items: string[]) {
  return items.join('\n');
}

function WorkflowField({
  label,
  onChange,
  placeholder,
  rows,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows: number;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <Textarea
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[72px] resize-none text-xs"
        rows={rows}
      />
    </div>
  );
}

function WorkflowPlaybookPreview({
  workflow,
}: {
  workflow: WorkflowPlaybookData;
}) {
  const t = useT();

  return (
    <div className="mt-2 space-y-2">
      {workflow.steps.length > 0 ? (
        <WorkflowPreviewSection
          items={workflow.steps}
          title={t('context.workflowStepsLabel')}
          ordered
        />
      ) : null}
      {workflow.constraints.length > 0 ? (
        <WorkflowPreviewSection
          items={workflow.constraints}
          title={t('context.workflowConstraintsLabel')}
        />
      ) : null}
      {workflow.checklist.length > 0 ? (
        <WorkflowPreviewSection
          items={workflow.checklist}
          title={t('context.workflowChecklistLabel')}
        />
      ) : null}
      {workflow.content ? (
        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {workflow.content}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowPreviewSection({
  items,
  ordered = false,
  title,
}: {
  items: string[];
  ordered?: boolean;
  title: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/15 px-2 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        {items.map((item, index) => (
          <p key={`${title}-${index}`}>
            {ordered ? `${index + 1}. ${item}` : `- ${item}`}
          </p>
        ))}
      </div>
    </div>
  );
}

function ContextSection({
  children,
  count,
  icon,
  title,
}: {
  children: React.ReactNode;
  count?: number;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-background/80 p-3">
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </h3>
        {count !== undefined ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {count}
          </Badge>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ContextEmptyState({
  description,
  icon,
  title,
}: {
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center opacity-40">
        {icon}
      </div>
      <p>{title}</p>
      <p className="mt-1 opacity-70">{description}</p>
    </div>
  );
}
