'use client';

import { useState, useCallback, useRef } from 'react';
import type { DocumentData, VersionData } from '@/types';

export function useDocument() {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadDocument = useCallback(async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}`);
    if (res.ok) {
      const doc = await res.json();
      setDocument(doc);
      return doc;
    }
    return null;
  }, []);

  const createDocument = useCallback(
    async (sessionId: string, title: string, content: string) => {
      // Create via direct API - the document will be created by the chat route
      // For now, create manually
      const res = await fetch(`/api/documents/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, title, content }),
      });
      if (res.ok) {
        const doc = await res.json();
        setDocument(doc);
        return doc;
      }
      return null;
    },
    []
  );

  const saveContent = useCallback(
    (docId: string, content: string) => {
      // Debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await fetch(`/api/documents/${docId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    []
  );

  const lockVersion = useCallback(async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}/versions`, {
      method: 'POST',
    });
    if (res.ok) {
      const version = await res.json();
      setVersions(prev => [version, ...prev]);
      setDocument(prev =>
        prev ? { ...prev, status: 'locked', currentVersion: version.versionNum } : null
      );
      return version;
    }
    return null;
  }, []);

  const loadVersions = useCallback(async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}/versions`);
    if (res.ok) {
      const data = await res.json();
      setVersions(data);
      return data;
    }
    return [];
  }, []);

  const unlockForEditing = useCallback(async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewing' }),
    });
    if (res.ok) {
      setDocument(prev => (prev ? { ...prev, status: 'reviewing' } : null));
    }
  }, []);

  return {
    document,
    setDocument,
    versions,
    isSaving,
    loadDocument,
    createDocument,
    saveContent,
    lockVersion,
    loadVersions,
    unlockForEditing,
  };
}
