import { contextBridge, ipcRenderer, shell } from 'electron';
import type {
  DesktopApiRequest,
  DesktopApiStreamEvent,
  DesktopApiStreamStart,
  DesktopDiagnosticsMetadata,
  DesktopStructuredLogEntry,
} from './shared/bridge';

const streamListeners = new Map<number, (event: DesktopApiStreamEvent) => void>();
let nextStreamListenerToken = 1;

ipcRenderer.on('dao:api-stream-event', (_event, payload: DesktopApiStreamEvent) => {
  for (const listener of streamListeners.values()) {
    listener(payload);
  }
});

contextBridge.exposeInMainWorld('daoDesktop', {
  isDesktop: true,
  openExternal: (url: string) => shell.openExternal(url),
  oauthLogin: (providerId: string) => ipcRenderer.invoke('dao:oauth-login', providerId),
  api: {
    fetch: (request: DesktopApiRequest) =>
      ipcRenderer.invoke('dao:api-fetch', request) as Promise<DesktopApiStreamStart>,
    subscribeStream: (listener: (event: DesktopApiStreamEvent) => void) => {
      const token = nextStreamListenerToken++;
      streamListeners.set(token, listener);
      return token;
    },
    unsubscribeStream: (token: number) => {
      streamListeners.delete(token);
    },
  },
  platform: {
    getStatus: () => ipcRenderer.invoke('dao:platform-status'),
  },
  diagnostics: {
    exportBundle: () => ipcRenderer.invoke('dao:diagnostics-export-bundle'),
    getMetadata: () =>
      ipcRenderer.invoke('dao:diagnostics-get-metadata') as Promise<DesktopDiagnosticsMetadata>,
    log: (entry: DesktopStructuredLogEntry) =>
      ipcRenderer.invoke('dao:diagnostics-log-renderer', entry),
    openLogsDirectory: () => ipcRenderer.invoke('dao:diagnostics-open-logs-directory'),
  },
});
