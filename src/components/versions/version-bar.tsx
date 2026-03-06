'use client';

import * as React from 'react';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { VersionData } from '@/types';

export function VersionBar({ documentId }: { documentId: string }) {
  const [versions, setVersions] = React.useState<VersionData[]>([]);
  const [selectedVersion, setSelectedVersion] = React.useState<VersionData | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const loadVersions = React.useCallback(async () => {
    const res = await fetch(`/api/documents/${documentId}/versions`);
    if (res.ok) {
      setVersions(await res.json());
    }
  }, [documentId]);

  React.useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  if (versions.length === 0) return null;

  return (
    <div className="border-t border-border bg-muted/30 px-3 py-1.5">
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <History className="h-3.5 w-3.5" />
          <span>{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
        </button>

        {isOpen && (
          <div className="flex items-center gap-1">
            {versions.map(v => (
              <Button
                key={v.id}
                size="sm"
                variant={selectedVersion?.id === v.id ? 'default' : 'ghost'}
                className="h-6 text-[10px] px-2"
                onClick={() => setSelectedVersion(v)}
              >
                v{v.versionNum}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
