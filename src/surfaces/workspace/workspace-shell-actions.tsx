'use client';

import {
  ArrowLeftRight,
  Code2,
  ExternalLink,
  FilePlus2,
  LayoutGrid,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/components/providers/language-provider';

type SurfaceMode = 'editor' | 'overview';

export function WorkspaceShellActions({
  canCreateSiblingDeliverable,
  canToggleImplementation,
  canToggleSurfaceMode = false,
  isStartingPreview,
  isStoppingPreview,
  onCreateSiblingDeliverable,
  onStartPreview,
  onStopPreview,
  onToggleImplementation,
  onTogglePaneOrder,
  onToggleSurfaceMode,
  previewUrl,
  showImplementation,
  showPreviewControls,
  surfaceMode = 'editor',
}: {
  canCreateSiblingDeliverable: boolean;
  canToggleImplementation: boolean;
  canToggleSurfaceMode?: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  onCreateSiblingDeliverable: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  onToggleImplementation: () => void;
  onTogglePaneOrder: () => void;
  onToggleSurfaceMode?: () => void;
  previewUrl?: string | null;
  showImplementation: boolean;
  showPreviewControls: boolean;
  surfaceMode?: SurfaceMode;
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
          {t('plan.nextDeliverableAction')}
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
          {canToggleSurfaceMode && onToggleSurfaceMode ? (
            <>
              <DropdownMenuItem
                onClick={onToggleSurfaceMode}
                data-testid="workspace-toggle-surface-mode"
              >
                <LayoutGrid className="h-4 w-4" />
                {surfaceMode === 'editor'
                  ? t('workspace.showOverview')
                  : t('workspace.showEditor')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
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
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
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
                  <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
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
