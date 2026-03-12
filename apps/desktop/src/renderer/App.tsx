import * as React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '@/components/providers/language-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import WorkspacePage from '@/app/workspace/[workspaceId]/page';

export function DesktopApp() {
  React.useEffect(() => {
    const reportError = (event: string, context: Record<string, unknown>) => {
      const logDiagnostics = window.daoDesktop?.diagnostics?.log;
      void logDiagnostics?.({
        context,
        event,
        level: 'error',
      });
    };

    const handleError = (errorEvent: ErrorEvent) => {
      reportError('renderer.windowError', {
        filename: errorEvent.filename,
        line: errorEvent.lineno,
        message: errorEvent.message,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      reportError('renderer.unhandledRejection', {
        reason:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <LanguageProvider>
      <TooltipProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        </HashRouter>
      </TooltipProvider>
    </LanguageProvider>
  );
}
