import type { Value } from 'platejs';

export type ModelProvider = 'anthropic' | 'openai' | 'custom';

export type AIModel = {
  id: string;
  name: string;
  provider: ModelProvider;
};

export type SessionWithRelations = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessageData[];
  documents: DocumentData[];
};

export type ChatMessageData = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  documentId: string | null;
  model: string | null;
  createdAt: Date;
};

export type DocumentData = {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  status: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentThreadData = {
  id: string;
  documentId: string;
  anchorText: string;
  status: string;
  messages: CommentMessageData[];
  createdAt: Date;
  updatedAt: Date;
};

export type CommentMessageData = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  model: string | null;
  createdAt: Date;
};

export type MemoryData = {
  id: string;
  sessionId: string | null;
  category: string;
  content: string;
  sourceThreadId: string | null;
  active: boolean;
  createdAt: Date;
};

export type KnowledgeItemData = {
  id: string;
  documentId: string | null;
  title: string;
  content: string;
  sourceType: string;
  createdAt: Date;
};

export type VersionData = {
  id: string;
  documentId: string;
  versionNum: number;
  content: string;
  title: string;
  lockedAt: Date;
};

export type PlateValue = Value;
