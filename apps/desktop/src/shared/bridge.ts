export type DesktopFormDataEntry =
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
    };

export type DesktopRequestBody =
  | {
      kind: 'empty';
    }
  | {
      kind: 'text';
      value: string;
    }
  | {
      entries: DesktopFormDataEntry[];
      kind: 'form-data';
    };

export type DesktopApiRequest = {
  body: DesktopRequestBody;
  headers: Record<string, string>;
  method: string;
  path: string;
};

export type DesktopApiStreamStart = {
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
  streamId: string;
};

export type DesktopApiStreamEvent =
  | {
      chunk: ArrayBuffer;
      streamId: string;
      type: 'chunk';
    }
  | {
      error: string;
      streamId: string;
      type: 'error';
    }
  | {
      streamId: string;
      type: 'end';
    };

export type DesktopDiagnosticsMetadata = {
  appVersion: string;
  channel: string;
  deviceId: string;
  diagnosticsEnabled: boolean;
  logsPath: string;
};

export type DesktopStructuredLogEntry = {
  context?: Record<string, unknown>;
  event: string;
  level: 'debug' | 'info' | 'warn' | 'error';
};
