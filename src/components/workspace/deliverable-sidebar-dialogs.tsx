'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { useT } from '@/components/providers/language-provider';
import type { ProjectSummaryData } from '@/types';

export function LinkProjectDialog({
  availableProjects,
  error,
  isSaving,
  onOpenChange,
  onSelectProject,
  onSubmit,
  open,
  selectedProjectId,
  t,
}: {
  availableProjects: ProjectSummaryData[];
  error: string | null;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProject: (projectId: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  open: boolean;
  selectedProjectId: string;
  t: ReturnType<typeof useT>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('sidebar.addLinkedProject')}</DialogTitle>
          <DialogDescription>{t('sidebar.addLinkedProjectDescription')}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="linked-project-target">{t('sidebar.addLinkedProjectSelect')}</Label>
            <Select
              value={selectedProjectId || undefined}
              onValueChange={onSelectProject}
              disabled={isSaving || availableProjects.length === 0}
            >
              <SelectTrigger
                id="linked-project-target"
                className="w-full"
                data-testid="sidebar-linked-project-select"
              >
                <SelectValue placeholder={t('sidebar.addLinkedProjectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {availableProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableProjects.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground"
              data-testid="sidebar-linked-project-no-options"
            >
              {t('sidebar.noLinkableProjects')}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || availableProjects.length === 0}
              data-testid="sidebar-linked-project-submit"
            >
              {isSaving ? t('common.saving') : t('sidebar.addLinkedProjectSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameTextDialog({
  cancelLabel,
  description,
  error,
  isSaving,
  onChangeValue,
  onOpenChange,
  onSubmit,
  open,
  placeholder,
  saveLabel,
  savingLabel,
  title,
  value,
}: {
  cancelLabel: string;
  description: string;
  error: string | null;
  isSaving: boolean;
  onChangeValue: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  open: boolean;
  placeholder: string;
  saveLabel: string;
  savingLabel: string;
  title: string;
  value: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            value={value}
            onChange={(event) => onChangeValue(event.target.value)}
            placeholder={placeholder}
            disabled={isSaving}
            autoFocus
          />

          {error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? savingLabel : saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDestinationDialog({
  cancelLabel,
  confirmLabel,
  description,
  destinationLabel,
  error,
  isSaving,
  onChangeTarget,
  onOpenChange,
  onSubmit,
  open,
  options,
  rootLabel,
  rootValue,
  savingLabel,
  title,
  value,
}: {
  cancelLabel: string;
  confirmLabel: string;
  description: string;
  destinationLabel: string;
  error: string | null;
  isSaving: boolean;
  onChangeTarget: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  open: boolean;
  options: Array<{ depth: number; id: string; label: string }>;
  rootLabel: string;
  rootValue: string;
  savingLabel: string;
  title: string;
  value: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{destinationLabel}</div>
            <Select value={value} onValueChange={onChangeTarget} disabled={isSaving}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={rootLabel} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={rootValue}>{rootLabel}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {`${'> '.repeat(option.depth)}${option.label}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? savingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableSidebarDialogs({
  availableMountProjects,
  closeMountDialog,
  closeRenameDialog,
  handleCreateMount,
  handleRename,
  isCreatingMount,
  isMountDialogOpen,
  isRenamingWorkspace,
  mountDialogError,
  projectTreeActions,
  projectTreeRootValue,
  renameError,
  renameValue,
  renameWorkspaceId,
  selectedMountTargetProjectId,
  setMountDialogError,
  setRenameError,
  setRenameValue,
  setSelectedMountTargetProjectId,
  supportTreeActions,
  supportTreeRootValue,
  t,
}: {
  availableMountProjects: ProjectSummaryData[];
  closeMountDialog: (open: boolean) => void;
  closeRenameDialog: (open: boolean) => void;
  handleCreateMount: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleRename: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  isCreatingMount: boolean;
  isMountDialogOpen: boolean;
  isRenamingWorkspace: boolean;
  mountDialogError: string | null;
  projectTreeActions: ReturnType<
    typeof import('./use-project-tree-actions').useProjectTreeActions
  >;
  projectTreeRootValue: string;
  renameError: string | null;
  renameValue: string;
  renameWorkspaceId: string | null;
  selectedMountTargetProjectId: string;
  setMountDialogError: (value: string | null) => void;
  setRenameError: (value: string | null) => void;
  setRenameValue: (value: string) => void;
  setSelectedMountTargetProjectId: (value: string) => void;
  supportTreeActions: ReturnType<
    typeof import('./use-support-tree-actions').useSupportTreeActions
  >;
  supportTreeRootValue: string;
  t: ReturnType<typeof useT>;
}) {
  return (
    <>
      <LinkProjectDialog
        availableProjects={availableMountProjects}
        error={mountDialogError}
        isSaving={isCreatingMount}
        onOpenChange={closeMountDialog}
        onSelectProject={(value) => {
          setSelectedMountTargetProjectId(value);
          if (mountDialogError) {
            setMountDialogError(null);
          }
        }}
        onSubmit={(event) => void handleCreateMount(event)}
        open={isMountDialogOpen}
        selectedProjectId={selectedMountTargetProjectId}
        t={t}
      />

      <RenameTextDialog
        cancelLabel={t('common.cancel')}
        description={t('sidebar.renameProjectDescription')}
        error={renameError}
        isSaving={isRenamingWorkspace}
        onChangeValue={(value) => {
          setRenameValue(value);
          if (renameError) {
            setRenameError(null);
          }
        }}
        onOpenChange={closeRenameDialog}
        onSubmit={(event) => void handleRename(event)}
        open={Boolean(renameWorkspaceId)}
        placeholder={t('sidebar.renameProjectPlaceholder')}
        saveLabel={t('sidebar.renameProjectSave')}
        savingLabel={t('common.saving')}
        title={t('sidebar.renameProject')}
        value={renameValue}
      />

      <RenameTextDialog
        cancelLabel={t('common.cancel')}
        description={t('sidebar.renameDeliverableDescription')}
        error={projectTreeActions.renameDeliverableError}
        isSaving={projectTreeActions.isRenamingDeliverable}
        onChangeValue={(value) => {
          projectTreeActions.setRenameDeliverableValue(value);
          if (projectTreeActions.renameDeliverableError) {
            projectTreeActions.setRenameDeliverableError(null);
          }
        }}
        onOpenChange={projectTreeActions.closeRenameDeliverableDialog}
        onSubmit={(event) => void projectTreeActions.handleRenameDeliverable(event)}
        open={Boolean(projectTreeActions.renameDeliverableId)}
        placeholder={t('sidebar.renameDeliverablePlaceholder')}
        saveLabel={t('sidebar.renameDeliverableSave')}
        savingLabel={t('common.saving')}
        title={t('sidebar.renameDeliverable')}
        value={projectTreeActions.renameDeliverableValue}
      />

      <MoveDestinationDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('sidebar.moveConfirm')}
        description={
          projectTreeActions.moveNode?.type === 'folder'
            ? t('sidebar.moveProjectFolderDescription', {
                title: projectTreeActions.moveNode.title,
              })
            : t('sidebar.moveDeliverableDescription', {
                title: projectTreeActions.moveNode?.title || '',
              })
        }
        destinationLabel={t('sidebar.moveDestination')}
        error={projectTreeActions.moveNodeError}
        isSaving={projectTreeActions.isMovingNode}
        onChangeTarget={(value) => {
          projectTreeActions.setMoveTargetFolderId(value);
          if (projectTreeActions.moveNodeError) {
            projectTreeActions.setMoveNodeError(null);
          }
        }}
        onOpenChange={projectTreeActions.closeMoveDialog}
        onSubmit={(event) => void projectTreeActions.handleMoveNode(event)}
        open={Boolean(projectTreeActions.moveNode)}
        options={projectTreeActions.availableMoveTargets.map((option) => ({
          depth: option.depth,
          id: option.id,
          label: option.title,
        }))}
        rootLabel={t('sidebar.moveToRoot')}
        rootValue={projectTreeRootValue}
        savingLabel={t('common.saving')}
        title={
          projectTreeActions.moveNode?.type === 'folder'
            ? t('sidebar.moveProjectFolder')
            : t('sidebar.moveDeliverable')
        }
        value={projectTreeActions.moveTargetFolderId}
      />

      <RenameTextDialog
        cancelLabel={t('common.cancel')}
        description={t('sidebar.renameProjectFolderDescription')}
        error={projectTreeActions.renameProjectFolderError}
        isSaving={projectTreeActions.isRenamingProjectFolder}
        onChangeValue={(value) => {
          projectTreeActions.setRenameProjectFolderValue(value);
          if (projectTreeActions.renameProjectFolderError) {
            projectTreeActions.setRenameProjectFolderError(null);
          }
        }}
        onOpenChange={projectTreeActions.closeRenameProjectFolderDialog}
        onSubmit={(event) => void projectTreeActions.handleRenameProjectFolder(event)}
        open={Boolean(projectTreeActions.renameProjectFolderId)}
        placeholder={t('sidebar.renameProjectFolderPlaceholder')}
        saveLabel={t('sidebar.renameProjectFolderSave')}
        savingLabel={t('common.saving')}
        title={t('sidebar.renameProjectFolder')}
        value={projectTreeActions.renameProjectFolderValue}
      />

      <RenameTextDialog
        cancelLabel={t('common.cancel')}
        description={t('sidebar.renameSupportMaterialDescription')}
        error={supportTreeActions.renameSupportError}
        isSaving={supportTreeActions.isRenamingSupportFile}
        onChangeValue={(value) => {
          supportTreeActions.setRenameSupportValue(value);
          if (supportTreeActions.renameSupportError) {
            supportTreeActions.setRenameSupportError(null);
          }
        }}
        onOpenChange={supportTreeActions.closeRenameSupportDialog}
        onSubmit={(event) => void supportTreeActions.handleRenameSupportFile(event)}
        open={Boolean(supportTreeActions.renameSupportFileId)}
        placeholder={t('sidebar.renameSupportMaterialPlaceholder')}
        saveLabel={t('sidebar.renameSupportMaterialSave')}
        savingLabel={t('common.saving')}
        title={t('sidebar.renameSupportMaterial')}
        value={supportTreeActions.renameSupportValue}
      />

      <MoveDestinationDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('sidebar.moveConfirm')}
        description={t('sidebar.moveSupportMaterialDescription', {
          title: supportTreeActions.moveSupportNode?.name || '',
        })}
        destinationLabel={t('sidebar.moveDestination')}
        error={supportTreeActions.moveSupportError}
        isSaving={supportTreeActions.isMovingSupportNode}
        onChangeTarget={(value) => {
          supportTreeActions.setMoveSupportTargetId(value);
          if (supportTreeActions.moveSupportError) {
            supportTreeActions.setMoveSupportError(null);
          }
        }}
        onOpenChange={supportTreeActions.closeMoveSupportDialog}
        onSubmit={(event) => void supportTreeActions.handleMoveSupportNode(event)}
        open={Boolean(supportTreeActions.moveSupportNode)}
        options={supportTreeActions.availableSupportMoveTargets.map((option) => ({
          depth: option.depth,
          id: option.id,
          label: option.name,
        }))}
        rootLabel={t('sidebar.moveSupportToRoot')}
        rootValue={supportTreeRootValue}
        savingLabel={t('common.saving')}
        title={t('sidebar.moveSupportMaterial')}
        value={supportTreeActions.moveSupportTargetId}
      />
    </>
  );
}
