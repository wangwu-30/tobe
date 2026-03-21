'use client';

import * as React from 'react';

import { saveWorkspaceFileContent } from '@/lib/workspace/file-client';
import type { WorkspaceViewData } from '@/types';

export function useWorkspaceFileSaveController({
  currentFileId,
  isVersionView,
  setFileContent,
  setIsSavingTextFile,
  setWorkspaceView,
  workspaceId,
}: {
  currentFileId: string | null;
  isVersionView: boolean;
  setFileContent: React.Dispatch<React.SetStateAction<string>>;
  setIsSavingTextFile: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceView: React.Dispatch<React.SetStateAction<WorkspaceViewData | null>>;
  workspaceId: string;
}) {
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const saveCurrentFileContent = React.useCallback(
    (nextContent: string) => {
      if (!currentFileId || isVersionView) {
        return;
      }

      setFileContent(nextContent);
      setWorkspaceView((current) => {
        if (!current?.currentFile) {
          return current;
        }

        return {
          ...current,
          deliverable: current.deliverable
            ? { ...current.deliverable, content: nextContent }
            : current.deliverable,
          currentFile: {
            ...current.currentFile,
            content: nextContent,
          },
          files: current.files.map((file) =>
            file.id === currentFileId ? { ...file, content: nextContent } : file
          ),
          workspace: current.workspace
            ? {
                ...current.workspace,
                content:
                  current.files.find((file) => file.id === currentFileId)?.isPrimary
                    ? nextContent
                    : current.workspace.content,
              }
            : current.workspace,
        };
      });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setIsSavingTextFile(true);
        try {
          await saveWorkspaceFileContent({
            content: nextContent,
            fileId: currentFileId,
            workspaceId,
          });
        } finally {
          setIsSavingTextFile(false);
        }
      }, 700);
    },
    [
      currentFileId,
      isVersionView,
      setFileContent,
      setIsSavingTextFile,
      setWorkspaceView,
      workspaceId,
    ]
  );

  return {
    saveCurrentFileContent,
  };
}
