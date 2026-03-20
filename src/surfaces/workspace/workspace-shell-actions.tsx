'use client';

import {
  ArrowLeftRight,
  Code2,
  ExternalLink,
  FilePlus2,
  LoaderCircle,
  Play,
  SlidersHorizontal,
  Square,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/components/providers/language-provider';

export function WorkspaceShellActions({
  canCreateSiblingDeliverable,
  canToggleImplementation,
  isStartingPreview,
  isStoppingPreview,
  onCreateSiblingDeliverable,
  onStartPreview,
  onStopPreview,
  onToggleImplementation,
  onTogglePaneOrder,
  previewUrl,
  showImplementation,
  showPreviewControls,
}: {
  canCreateSiblingDeliverable: boolean;
  canToggleImplementation: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  onCreateSiblingDeliverable: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  onToggleImplementation: () => void;
  onTogglePaneOrder: () => void;
  previewUrl?: string | null;
  showImplementation: boolean;
  showPreviewControls: boolean;
}) {
  const t = useT();

  return (
    <>
      {canCreateSiblingDeliverable ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-testid="workspace-new-sibling-deliverable"
          onClick={onCreateSiblingDeliverable}
        >
          <FilePlus2 className="h-4 w-4" />
          {t('sidebar.newSiblingDeliverable')}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <SlidersHorizontal className="h-4 w-4" />
            {t('workspace.view')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canToggleImplementation ? (
            <DropdownMenuItem onClick={onToggleImplementation}>
              <Code2 className="h-4 w-4" />
              {showImplementation
                ? t('workspace.showDeliverable')
                : t('workspace.showImplementation')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onTogglePaneOrder}>
            <ArrowLeftRight className="h-4 w-4" />
            {t('workspace.swapLayout')}
          </DropdownMenuItem>
          {showPreviewControls ? (
            previewUrl ? (
              <>
                <DropdownMenuItem onClick={onStopPreview} disabled={isStoppingPreview}>
                  {isStoppingPreview ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {t('workspace.stopPreview')}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    {t('workspace.openPreview')}
                  </a>
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={onStartPreview} disabled={isStartingPreview}>
                {isStartingPreview ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t('workspace.startPreview')}
              </DropdownMenuItem>
            )
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
