import type { Value } from 'platejs';

export type ModelProvider = 'anthropic' | 'openai' | 'custom';

export type AIModel = {
  id: string;
  name: string;
  provider: ModelProvider;
};

export type ModelProviderAuthState =
  | 'oauth_connected'
  | 'oauth_required'
  | 'api_key_configured'
  | 'api_key_required';

export type ModelOptionData = {
  id: string;
  key: string;
  name: string;
  providerId: string;
};

export type ModelCatalogProviderData = {
  id: string;
  label: string;
  configured: boolean;
  authState: ModelProviderAuthState;
  disabledReason: string | null;
  models: ModelOptionData[];
};

export type ModelCatalogData = {
  defaultModelKey: string;
  providers: ModelCatalogProviderData[];
};

export type ModelSelectionData = {
  providerId: string;
  modelId: string;
  key: string;
};

export type OrganizationData = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type UserData = {
  id: string;
  name: string;
  email: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type TaskActorType = 'user' | 'agent';
export type TeamTaskKind = 'execution' | 'help';
export type TeamTaskPriority = 0 | 1 | 2 | 3;
export type TeamTaskStatus =
  | 'open'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled';

export type TaskActivityData = {
  id: string;
  taskId: string;
  type: string;
  message: string;
  actorType: TaskActorType;
  actorId: string;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
};

export type TeamTaskData = {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  kind: TeamTaskKind;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  revision: number;
  projectId: string | null;
  workspaceId: string | null;
  threadId: string | null;
  createdByType: TaskActorType;
  createdById: string;
  assigneeType: TaskActorType | null;
  assigneeId: string | null;
  blockedReason: string | null;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  activities: TaskActivityData[];
};

export type AgentProfileData = {
  id: string;
  organizationId: string;
  handle: string;
  name: string;
  description: string;
  skills: string[];
  enabled: boolean;
  builtin: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type SearchProvider = {
  id: string;
  label: string;
  supportsAuto: boolean;
  supportsManual: boolean;
};

export type SearchCitation = {
  title: string;
  url: string;
  snippet?: string | null;
};

export type SearchResult = {
  id: string;
  providerId: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: Date | string | null;
  citations?: SearchCitation[];
};

export type PlatformPathsData = {
  appDataRoot: string;
  dbFilePath: string;
  logsRoot: string;
  oauthDir: string;
  workspaceMirrorRoot: string;
};

export type PlatformStatusData = {
  appVersion: string;
  channel: string;
  deviceId: string;
  organizationId: string;
  oauthProviders: Array<{
    email: string | null;
    planType: string | null;
    providerId: string;
    savedAt: string | null;
  }>;
  paths: PlatformPathsData;
  userId: string;
};

export type WorkspaceFileData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  path: string;
  nodeType: 'file' | 'folder';
  kind: 'richtext' | 'markdown' | 'text' | 'code';
  role: 'deliverable' | 'support';
  language: string | null;
  content: string;
  sortOrder: number;
  isPrimary: boolean;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkspaceVersionFileData = Omit<
  WorkspaceFileData,
  'organizationId' | 'deletedAt' | 'createdAt' | 'updatedAt'
> & {
  versionId?: string | null;
};

/** @deprecated Legacy compatibility enum derived from labels. Prefer visible/pinned/recoveryKind. */
export type WorkspaceVersionType = 'manual' | 'checkpoint' | 'checkpoint_pinned';

export type WorkspaceVersionData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  versionNum: number;
  title: string;
  content: string;
  files: WorkspaceVersionFileData[];
  parentVersionId: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  /** @deprecated Derived legacy compatibility field. Prefer visible/pinned/recoveryKind. */
  versionType: WorkspaceVersionType;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  lockedAt: Date | string;
  labels?: StateLabelData[];
  /** Human-confirmed source-of-truth state for durable execution. */
  aligned: boolean;
  visible: boolean;
  restorable: boolean;
  pinned: boolean;
  recoveryKind: 'temporary' | 'pinned' | null;
};

export type StateLabelKind =
  | 'milestone'
  | 'head'
  | 'recovery'
  | 'pinned'
  | 'aligned';

export type StateLabelData = {
  id: string;
  organizationId: string;
  stateId: string;
  kind: StateLabelKind;
  name: string;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChatAttachmentData = {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string;
  workspaceId: string;
  workspaceFileId: string;
  filePath: string;
  kind: 'image' | 'text' | 'file';
  source: 'upload' | 'clipboard';
  storageFormat: 'text' | 'base64-envelope';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
  previewUrl?: string | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

export type DeliverableType = 'document' | 'web';

export type LegacyDeliverableType = DeliverableType | 'slides' | 'code';

export type RenderAs = 'document' | 'slides' | 'web';

export type CommentAgentConfigData = {
  id: string;
  handle: string;
  name: string;
  systemPrompt: string;
  enabled: boolean;
  builtin: boolean;
};

export type CommentAgentReferenceData = {
  agentId: string;
  agentLabel: string;
  handle: string;
};

export type CommentAgentBindingData = CommentAgentReferenceData & {
  lastActivatedAt: Date | string;
  listeningUntil: Date | string;
  sortOrder: number;
};

export type ReviewAnchorPointData = {
  path: number[];
  offset: number;
};

export type ReviewAnchorPayloadData = Record<string, unknown> & {
  boundingRect?: {
    height?: number;
    width?: number;
    x?: number;
    y?: number;
  } | null;
  cssSelector?: string | null;
  domContext?: string | null;
  excerpt?: string;
  selector?: string;
  start?: ReviewAnchorPointData;
  end?: ReviewAnchorPointData;
};

export type ReviewAnchorData = {
  surfaceType: 'document-block' | 'document-selection' | 'web-component' | 'web-block' | 'code-range';
  bindingType: 'selection' | 'block' | 'component' | 'range';
  anchorPayload: ReviewAnchorPayloadData;
  previewVersionId?: string | null;
  sourceMapping?: {
    fileId?: string | null;
    path?: string | null;
    selector?: string | null;
  } | null;
};

export type DeliverableData = {
  id: string;
  workspaceId: string;
  title: string;
  deliverableType: DeliverableType;
  storedDeliverableType: LegacyDeliverableType | null;
  renderAs: RenderAs;
  persistedStatus: string;
  content: string;
  primaryFileId: string | null;
  currentVersion: number;
};

export type DeliverableVersionData = WorkspaceVersionData;

export type WorkspacePlanStageData = {
  id: string;
  kind: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  checkpoint: boolean;
};

export type PlanStepData = WorkspacePlanStageData;

export type WorkspacePlanData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  activeWorkflowPlaybookId: string | null;
  activeWorkflowPlaybook: WorkflowPlaybookData | null;
  goal: string;
  deliverableType: DeliverableType;
  constraints: string | null;
  styleGuide: string | null;
  status: string;
  version: number;
  activeStageId: string | null;
  lastProgressNote: string | null;
  stages: WorkspacePlanStageData[];
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AssistantPlanProposalData = {
  status: 'pending' | 'applied' | 'dismissed';
  goal: string;
  deliverableType: DeliverableType;
  constraints: string | null;
  styleGuide: string | null;
  summary: string;
  originalRequest: string;
  stages: WorkspacePlanStageData[];
};

export type ResearchMode = 'light' | 'deep';

export type DeepResearchPlanProposalData = {
  status: 'pending' | 'approved' | 'dismissed';
  title: string;
  query: string;
  summary: string;
  subquestions: string[];
  reportOutline: string[];
  allowedDomains: string[];
  sourceScope: {
    attachments: boolean;
    web: boolean;
    workspace: boolean;
  };
};

export type ResearchProgressPhase =
  | 'proposal'
  | 'searching'
  | 'analyzing_gaps'
  | 'reporting'
  | 'blocked'
  | 'completed';

export type ResearchProgressData = {
  mode: ResearchMode;
  phase: ResearchProgressPhase;
  currentStepLabel: string | null;
  providerState: 'ready' | 'unavailable';
  reportFileId: string | null;
  reportFileName: string | null;
  stepIndex: number | null;
  totalSteps: number | null;
};

export type WorkflowPrimaryActionKind =
  | 'none'
  | 'generate_first_pass'
  | 'wait_for_ai'
  | 'start_preview'
  | 'create_version'
  | 'restore_latest';

export type WorkspaceWorkflowStatusData = {
  phase:
    | 'idle'
    | 'planning'
    | 'implementing'
    | 'preview_ready'
    | 'preview_running'
    | 'reviewing'
    | 'finalized'
    | 'blocked';
  statusTitle: string;
  statusDescription: string;
  primaryAction: WorkflowPrimaryActionKind;
  blockedReason: string | null;
  latestRestorableVersionId: string | null;
  latestRestorableVersionTitle: string | null;
  isAiWorking: boolean;
};

export type WorkflowSummaryData = WorkspaceWorkflowStatusData;
export type WorkflowPlaybookStatus = 'draft' | 'active' | 'archived';

export type StagedChangeOperation = 'create' | 'update' | 'delete';

export type StagedChangeFilePreimageData = {
  content: string;
  contentSha256: string;
  revision: number;
};

export type StagedChangePatchData = {
  operation: StagedChangeOperation;
  fileId: string | null;
  name: string;
  summary: string;
  nextContent: string | null;
  kind: 'richtext' | 'markdown' | 'text' | 'code';
  preimage: StagedChangeFilePreimageData | null;
};

export type StagedChangeSetData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  conversationId: string | null;
  baseVersionId: string | null;
  baseVersionSha256: string | null;
  baseDraftRevision: number | null;
  patchSchemaVersion: number | null;
  patchSha256: string | null;
  appliedCheckpointVersionId: string | null;
  title: string;
  summary: string;
  status: 'pending' | 'applied' | 'discarded';
  sourceType: string;
  changes: StagedChangePatchData[];
  createdByUserId: string | null;
  originDeviceId: string | null;
  appliedAt: Date | string | null;
  discardedAt: Date | string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkspaceRunData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  versionId: string | null;
  kind: string;
  command: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'stopped';
  previewUrl: string | null;
  logPath: string | null;
  exitCode: number | null;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AssistantRunData = {
  id: string;
  organizationId: string;
  conversationId: string;
  workspaceId: string;
  requestMessageId: string | null;
  mode: 'run' | 'first_pass' | 'revision' | 'question' | 'replan';
  title: string;
  status: 'queued' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';
  summary: string | null;
  planProposal?: AssistantPlanProposalData | null;
  researchPlanProposal?: DeepResearchPlanProposalData | null;
  researchProgress?: ResearchProgressData | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ConversationMessageData = {
  id: string;
  organizationId: string;
  conversationId: string;
  role: string;
  content: string;
  attachments: ChatAttachmentData[];
  workspaceId: string | null;
  focusNodeId?: string | null;
  wikiId?: string | null;
  model: string | null;
  citations?: SearchCitation[];
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
};

export type ConversationData = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  projectId?: string | null;
  wikiId?: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  baseVersionId: string | null;
  activeFileId: string | null;
  hasPendingChanges?: boolean;
  scopeFilter?: string | null;
  title: string;
  sourceType: string;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  messages?: ConversationMessageData[];
};

export type ConversationBranchSummary = ConversationData & {
  children: ConversationBranchSummary[];
  lastMessagePreview: string | null;
};

export type CommentMessageData = {
  id: string;
  organizationId: string;
  threadId: string;
  role: string;
  content: string;
  model: string | null;
  mentionedAgents: CommentAgentReferenceData[];
  agentId: string | null;
  agentLabel: string | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
};

export type CommentResearchStateData = {
  progress: ResearchProgressData | null;
  proposal: DeepResearchPlanProposalData | null;
  reportFileId: string | null;
  reportFileName: string | null;
  summary: string | null;
  targetAgentId: string | null;
  targetAgentLabel: string | null;
};

export type CommentThreadStatus = 'open' | 'applied' | 'resolved';
export type CommentThreadScope = 'direct' | 'inherited';
export type CommentThreadInheritanceState =
  | 'actionable'
  | 'stale'
  | 'superseded';

export type CommentThreadData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  wikiId?: string;
  fileId: string | null;
  versionId: string | null;
  sourceVersionId: string | null;
  anchorFingerprint: string;
  scope: CommentThreadScope;
  inheritanceState: CommentThreadInheritanceState | null;
  isInherited: boolean;
  inheritedFromVersionId: string | null;
  inheritedFromVersionTitle: string | null;
  draftRevision: number | null;
  anchorText: string;
  selectionAnchor: string | null;
  reviewAnchor?: ReviewAnchorData | null;
  status: CommentThreadStatus;
  messages: CommentMessageData[];
  agentBindings: CommentAgentBindingData[];
  researchState: CommentResearchStateData | null;
  resolvedAt: Date | string | null;
  version: WorkspaceVersionData | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type NoteScope = 'user' | 'project' | 'deliverable';

export type NoteData = {
  id: string;
  organizationId: string;
  scope: NoteScope;
  scopeId: string;
  kind: string;
  title: string | null;
  content: string;
  source: string;
  sourceRef: string | null;
  active: boolean;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkflowExtensionKind = 'tools' | 'mcp' | 'skills';

export type WorkflowExtensionHintData = {
  kind: WorkflowExtensionKind;
  summary: string;
};

export type WorkflowPlaybookData = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  sourceVersionId: string | null;
  sourceThreadId: string | null;
  status: WorkflowPlaybookStatus;
  builtin?: boolean;
  title: string;
  summary: string;
  steps: string[];
  constraints: string[];
  checklist: string[];
  extensionHints: WorkflowExtensionHintData[];
  content: string;
  archivedAt: Date | string | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkflowPlaybookDraftWarningKey =
  | 'context.workflowDraftWarningDedupedSignals'
  | 'context.workflowDraftWarningDefaultConstraints'
  | 'context.workflowDraftWarningDefaultSteps'
  | 'context.workflowDraftWarningReviewSignals';

export type WorkflowPlaybookDraftData = {
  sourceThreadId: string | null;
  sourceVersionId: string | null;
  summary: string;
  title: string;
  steps: string[];
  constraints: string[];
  checklist: string[];
  extensionHints: WorkflowExtensionHintData[];
  content: string;
  warnings: WorkflowPlaybookDraftWarningKey[];
};

export type WorkspaceData = {
  id: string;
  organizationId: string;
  primaryConversationId: string;
  sessionId?: string;
  projectId: string;
  projectFolderId: string | null;
  draftBaseVersionId: string | null;
  projectTitle: string;
  title: string;
  content: string;
  projectRootPath: string | null;
  persistedStatus: string;
  currentVersion: number;
  draftRevision: number;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ProjectSummaryData = {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  deliverableCount: number;
  latestDeliverableTitle: string | null;
  updatedAt: Date | string;
};

export type ProjectSidebarItem = ProjectSummaryData;

export type ProjectDeliverableItem = {
  id: string;
  projectId: string;
  projectFolderId: string | null;
  sortOrder: number;
  title: string;
  deliverableType: DeliverableType;
  updatedAt: Date | string;
};

export type ProjectFolderItem = {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  sortOrder: number;
  title: string;
  updatedAt: Date | string;
};

export type ProjectMountData = {
  id: string;
  organizationId: string;
  sourceProjectId: string;
  sourceProjectTitle: string | null;
  targetProjectId: string;
  targetProjectTitle: string | null;
  createdAt: Date | string;
};

export type ProjectNodeSearchResultData = {
  deliverableType: DeliverableType;
  id: string;
  isCurrent: boolean;
  matchPreview: string;
  matchedIn: 'content' | 'title';
  previewText: string;
  primaryFilePath: string | null;
  projectId: string;
  renderAs: RenderAs;
  status: string;
  title: string;
  updatedAt: Date | string;
};

export type WorkspaceSidebarItem = ProjectSummaryData;

export type WorkspaceEditLockData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  wikiId?: string;
  userId: string;
  originDeviceId: string;
  lockedVersionId: string | null;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ConversationWithRelations = ConversationData & {
  workspace: WorkspaceData | null;
  messages: ConversationMessageData[];
};

export type WorkspaceWithRelations = WorkspaceData & {
  comments?: CommentThreadData[];
  conversations?: ConversationData[];
  deliverable?: DeliverableData | null;
  files?: WorkspaceFileData[];
  notes?: NoteData[];
  primaryConversation?: ConversationData | null;
  stagedChangeSets?: StagedChangeSetData[];
  versions?: WorkspaceVersionData[];
  workspacePlan?: WorkspacePlanData | null;
};

export type WorkspaceViewData = {
  workspace: WorkspaceWithRelations | null;
  currentProject: ProjectSummaryData | null;
  projectFolders: ProjectFolderItem[];
  projectDeliverables: ProjectDeliverableItem[];
  deliverable: DeliverableData | null;
  files: WorkspaceFileData[];
  versions: WorkspaceVersionData[];
  visibleVersions: DeliverableVersionData[];
  versionFiles: WorkspaceVersionFileData[];
  currentFile: WorkspaceFileData | WorkspaceVersionFileData | null;
  currentConversation: ConversationWithRelations | null;
  latestConversation: ConversationWithRelations | null;
  conversationTree: ConversationBranchSummary[];
  conversationRuns: AssistantRunData[];
  activeAssistantRun: AssistantRunData | null;
  activePreviewRun: WorkspaceRunData | null;
  selectedVersion: WorkspaceVersionData | null;
  stagedChangeSets: StagedChangeSetData[];
  workspacePlan: WorkspacePlanData | null;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  activeLock?: WorkspaceEditLockData | null;
};

export type SyncEventData = {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  originDeviceId: string | null;
  revision: number;
  occurredAt: Date | string;
  payload: string;
  pushedAt: Date | string | null;
};

export type SyncCursorData = {
  id: string;
  organizationId: string;
  deviceId: string;
  backend: string;
  lastEventId: string | null;
  lastOccurredAt: Date | string | null;
  updatedAt: Date | string;
};

export type ChatMessageData = ConversationMessageData;

export type PlateValue = Value;
