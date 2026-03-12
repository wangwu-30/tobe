export type SyncBackendPullResult = {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  nextOccurredAt: Date | string | null;
};

export interface SyncBackend {
  id: string;
  pull(params: {
    cursor?: string | null;
    deviceId: string;
    lastOccurredAt?: string | null;
    organizationId: string;
  }): Promise<SyncBackendPullResult>;
  push(params: {
    deviceId: string;
    events: Array<Record<string, unknown>>;
    organizationId: string;
    userId: string;
  }): Promise<{
    accepted: string[];
  }>;
}
