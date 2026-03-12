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
  diagnosticsEnabled: boolean;
  deviceId: string;
  isDesktop: boolean;
  mode: 'desktop' | 'web';
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

export type WorkspaceSnapshotFileData = Omit<
  WorkspaceFileData,
  'organizationId' | 'deletedAt' | 'createdAt' | 'updatedAt'
> & {
  snapshotId?: string | null;
};

export type WorkspaceSnapshotData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  versionNum: number;
  title: string;
  content: string;
  files: WorkspaceSnapshotFileData[];
  parentSnapshotId: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  snapshotType: string;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  lockedAt: Date | string;
  visible: boolean;
  restorable: boolean;
  pinned: boolean;
  recoveryKind: 'temporary' | 'pinned' | null;
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

export type DeliverableType = 'document' | 'slides' | 'web' | 'code';

export type ReviewAnchorData = {
  surfaceType: 'document-block' | 'document-selection' | 'web-component' | 'web-block' | 'code-range';
  bindingType: 'selection' | 'block' | 'component' | 'range';
  anchorPayload: Record<string, unknown>;
  previewSnapshotId?: string | null;
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
  status: string;
  content: string;
  primaryFileId: string | null;
  currentVersion: number;
};

export type DeliverableVersionData = WorkspaceSnapshotData;

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

export type WorkflowPrimaryActionKind =
  | 'none'
  | 'wait_for_ai'
  | 'start_preview'
  | 'create_version'
  | 'restore_latest';

export type WorkflowSummaryData = {
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
  latestRestorableSnapshotId: string | null;
  latestRestorableSnapshotTitle: string | null;
  isAiWorking: boolean;
};

export type StagedChangePatchData = {
  fileId: string | null;
  name: string;
  summary: string;
  nextContent: string;
  kind: 'richtext' | 'markdown' | 'text' | 'code';
};

export type StagedChangeSetData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  conversationId: string | null;
  baseVersionId: string | null;
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
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkspaceRunData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  snapshotId: string | null;
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
  mode: 'first_pass' | 'revision' | 'question' | 'replan';
  title: string;
  status: 'queued' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';
  summary: string | null;
  planProposal?: AssistantPlanProposalData | null;
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
  wikiId?: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  baseSnapshotId: string | null;
  baseDeliverableVersionId?: string | null;
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
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
};

export type CommentThreadData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  wikiId?: string;
  fileId: string | null;
  snapshotId: string | null;
  draftRevision: number | null;
  anchorText: string;
  selectionAnchor: string | null;
  reviewAnchor?: ReviewAnchorData | null;
  status: string;
  messages: CommentMessageData[];
  resolvedAt: Date | string | null;
  snapshot: WorkspaceSnapshotData | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type KnowledgeItemData = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  wikiId?: string | null;
  title: string;
  content: string;
  sourceType: string;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type MemoryData = {
  id: string;
  organizationId: string;
  conversationId: string | null;
  workspaceId: string | null;
  wikiId?: string | null;
  category: string;
  content: string;
  sourceThreadId: string | null;
  active: boolean;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkspaceData = {
  id: string;
  organizationId: string;
  primaryConversationId: string;
  sessionId?: string;
  title: string;
  content: string;
  status: string;
  currentVersion: number;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type WorkspaceSidebarItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: Date | string;
};

export type WorkspaceEditLockData = {
  id: string;
  organizationId: string;
  workspaceId: string;
  wikiId?: string;
  userId: string;
  originDeviceId: string;
  lockedSnapshotId: string | null;
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
  knowledgeItems?: KnowledgeItemData[];
  primaryConversation?: ConversationData | null;
  stagedChangeSets?: StagedChangeSetData[];
  snapshots?: WorkspaceSnapshotData[];
  workspacePlan?: WorkspacePlanData | null;
};

export type WorkspaceViewData = {
  workspace: WorkspaceWithRelations | null;
  deliverable: DeliverableData | null;
  files: WorkspaceFileData[];
  snapshots: WorkspaceSnapshotData[];
  visibleVersions: DeliverableVersionData[];
  snapshotFiles: WorkspaceSnapshotFileData[];
  currentFile: WorkspaceFileData | WorkspaceSnapshotFileData | null;
  currentConversation: ConversationWithRelations | null;
  latestConversation: ConversationWithRelations | null;
  conversationTree: ConversationBranchSummary[];
  conversationRuns: AssistantRunData[];
  activeAssistantRun: AssistantRunData | null;
  currentSnapshot: WorkspaceSnapshotData | null;
  stagedChangeSets: StagedChangeSetData[];
  workspacePlan: WorkspacePlanData | null;
  workflowSummary: WorkflowSummaryData | null;
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

export type WikiData = WorkspaceData;
export type WikiVersionData = WorkspaceSnapshotData;
export type WikiWithRelations = WorkspaceWithRelations;
export type WikiSidebarItem = WorkspaceSidebarItem;
export type WikiEditLockData = WorkspaceEditLockData;
export type SessionWithRelations = ConversationWithRelations;
export type ChatMessageData = ConversationMessageData;
export type DocumentData = WorkspaceData;
export type VersionData = WorkspaceSnapshotData;

export type PlateValue = Value;
