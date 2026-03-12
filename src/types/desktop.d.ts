export {};

declare global {
  interface Window {
    daoDesktop?: {
      api?: {
        fetch?: (request: {
          body:
            | { kind: 'empty' }
            | { kind: 'text'; value: string }
            | {
                kind: 'form-data';
                entries: Array<
                  | {
                      kind: 'text';
                      name: string;
                      value: string;
                    }
                  | {
                      bytes: ArrayBuffer;
                      fileName: string;
                      kind: 'file';
                      mimeType: string | null;
                      name: string;
                    }
                >;
              };
          headers: Record<string, string>;
          method: string;
          path: string;
        }) => Promise<{
          headers: Array<[string, string]>;
          status: number;
          statusText: string;
          streamId: string;
        }>;
        subscribeStream?: (
          listener: (event: {
            streamId: string;
            type: 'chunk' | 'end' | 'error';
            chunk?: ArrayBuffer;
            error?: string;
          }) => void
        ) => number;
        unsubscribeStream?: (token: number) => void;
      };
      diagnostics?: {
        exportBundle?: () => Promise<{ path: string | null } | null>;
        getMetadata?: () => Promise<{
          appVersion: string;
          channel: string;
          deviceId: string;
          diagnosticsEnabled: boolean;
          logsPath: string;
        }>;
        log?: (entry: {
          context?: Record<string, unknown>;
          event: string;
          level: 'debug' | 'info' | 'warn' | 'error';
        }) => Promise<void>;
        openLogsDirectory?: () => Promise<string>;
      };
      isDesktop: boolean;
      openExternal: (url: string) => Promise<void> | void;
      oauthLogin?: (providerId: string) => Promise<{
        providerId: string;
        savedAt: string | null;
      }>;
      platform?: {
        getStatus?: () => Promise<unknown>;
      };
    };
  }
}
