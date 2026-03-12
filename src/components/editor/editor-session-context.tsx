'use client';

import * as React from 'react';

type EditorSessionContextValue = {
  documentContent: string;
  documentId: string | null;
  workspaceId: string | null;
  fileId: string | null;
  sessionId: string;
  wikiId: string | null;
  conversationId: string | null;
  snapshotId: string | null;
  versionId: string | null;
};

const EditorSessionContext = React.createContext<EditorSessionContextValue | null>(
  null
);

export function EditorSessionProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: EditorSessionContextValue;
}) {
  return (
    <EditorSessionContext.Provider value={value}>
      {children}
    </EditorSessionContext.Provider>
  );
}

export function useEditorSession() {
  return React.useContext(EditorSessionContext);
}
