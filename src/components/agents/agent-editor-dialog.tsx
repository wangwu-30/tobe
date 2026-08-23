'use client';

import * as React from 'react';
import { LoaderCircle, LockKeyhole } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { useNavigationBlocker } from '@/lib/navigation/navigation-guard';
import { cn } from '@/lib/utils';
import {
  createAgent,
  defaultAgentConfigV1,
  normalizeAgentHandle,
  parseAgentSkills,
  updateAgent,
  type AgentProfileDtoV1,
} from '@/lib/agents/client';

type AgentEditorDialogProps = {
  agent: AgentProfileDtoV1 | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (agent: AgentProfileDtoV1, created: boolean) => void;
  open: boolean;
};

type InvalidField = 'handle' | 'name' | 'runtime' | null;

const HANDLE_PATTERN = /^@[a-z0-9][a-z0-9_-]*$/;
const FORM_ERROR_ID = 'agent-editor-error';
const SKILLS_HELP_ID = 'agent-skills-help';
const SUBMIT_STATUS_ID = 'agent-editor-submit-status';
const UNSAVED_CHANGES_CONFIRM = 'You have unsaved agent changes. Discard them?';

function serializeAgentDraft({
  description,
  enabled,
  handle,
  name,
  runtimeId,
  skills,
}: {
  description: string;
  enabled: boolean;
  handle: string;
  name: string;
  runtimeId: string;
  skills: string;
}) {
  return JSON.stringify({ description, enabled, handle, name, runtimeId, skills });
}

export function AgentEditorDialog({
  agent,
  canManage,
  onOpenChange,
  onSaved,
  open,
}: AgentEditorDialogProps) {
  const [name, setName] = React.useState('');
  const [handle, setHandle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [skills, setSkills] = React.useState('');
  const [runtimeId, setRuntimeId] = React.useState('pi-agent-core');
  const [enabled, setEnabled] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [invalidField, setInvalidField] = React.useState<InvalidField>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [draftBaseline, setDraftBaseline] = React.useState<string | null>(null);
  const allowSavedCloseRef = React.useRef(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const handleRef = React.useRef<HTMLInputElement>(null);
  const runtimeRef = React.useRef<HTMLInputElement>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);
  const editing = Boolean(agent);
  const readOnly = !canManage;
  const builtin = agent?.builtin === true;
  const currentDraft = serializeAgentDraft({ description, enabled, handle, name, runtimeId, skills });
  const isDirty =
    open && !isSubmitting && draftBaseline !== null && currentDraft !== draftBaseline;

  useNavigationBlocker(isDirty, UNSAVED_CHANGES_CONFIRM);

  React.useEffect(() => {
    if (!open) return;
    const config = agent?.config || defaultAgentConfigV1();
    const nextName = agent?.name || '';
    const nextHandle = agent?.handle || '';
    const nextDescription = agent?.description || '';
    const nextSkills = agent?.capabilities.skills.join(', ') || '';
    setName(nextName);
    setHandle(nextHandle);
    setDescription(nextDescription);
    setSkills(nextSkills);
    setRuntimeId(config.room.runtimeId);
    setEnabled(agent?.enabled ?? true);
    setDraftBaseline(
      serializeAgentDraft({
        description: nextDescription,
        enabled: agent?.enabled ?? true,
        handle: nextHandle,
        name: nextName,
        runtimeId: config.room.runtimeId,
        skills: nextSkills,
      })
    );
    allowSavedCloseRef.current = false;
    setError(null);
    setInvalidField(null);
    setIsSubmitting(false);
  }, [agent, open]);

  const focusValidationError = React.useCallback((field: Exclude<InvalidField, null>) => {
    const target =
      field === 'name'
        ? nameRef.current
        : field === 'handle'
          ? handleRef.current
          : runtimeRef.current;
    window.requestAnimationFrame(() => target?.focus());
  }, []);

  const setValidationError = React.useCallback(
    (field: Exclude<InvalidField, null>, message: string) => {
      setInvalidField(field);
      setError(message);
      focusValidationError(field);
    },
    [focusValidationError]
  );

  const clearFieldError = React.useCallback((field: Exclude<InvalidField, null>) => {
    if (invalidField === field) {
      setInvalidField(null);
      setError(null);
    }
  }, [invalidField]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || isSubmitting) return;

    const cleanName = name.trim();
    const cleanHandle = normalizeAgentHandle(handle);
    const cleanRuntimeId = runtimeId.trim();

    if (!cleanName) {
      setValidationError('name', 'Enter a name for this agent.');
      return;
    }
    if (!HANDLE_PATTERN.test(cleanHandle)) {
      setValidationError(
        'handle',
        'Use a handle such as @researcher with letters, numbers, underscores, or hyphens.'
      );
      return;
    }
    if (!cleanRuntimeId) {
      setValidationError('runtime', 'Enter a Room runtime ID.');
      return;
    }

    setError(null);
    setInvalidField(null);
    setIsSubmitting(true);

    let result: Awaited<ReturnType<typeof createAgent>>;
    try {
      const commonInput = {
        capabilities: {
          schemaVersion: 1 as const,
          skills: parseAgentSkills(skills),
        },
        config: {
          room: { configVersion: 1 as const, runtimeId: cleanRuntimeId },
          schemaVersion: 1 as const,
        },
        description: description.trim(),
        name: cleanName,
        schemaVersion: 1 as const,
      };
      result = agent
        ? await updateAgent(agent.id, {
            ...commonInput,
            expectedRevision: agent.revision,
            ...(!builtin ? { enabled, handle: cleanHandle } : {}),
          })
        : await createAgent({
            ...commonInput,
            enabled,
            handle: cleanHandle,
          });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The agent could not be saved.');
      setIsSubmitting(false);
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    if (!result.ok) {
      setError(
        result.status === 409
          ? 'This agent changed since you opened it. Close the editor, refresh, and try again.'
          : result.error
      );
      setIsSubmitting(false);
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    allowSavedCloseRef.current = true;
    setDraftBaseline(currentDraft);
    onSaved(result.data, !agent);
    onOpenChange(false);
    setIsSubmitting(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    if (
      !nextOpen &&
      open &&
      !isSubmitting &&
      isDirty &&
      !allowSavedCloseRef.current &&
      !window.confirm(UNSAVED_CHANGES_CONFIRM)
    ) {
      return;
    }
    allowSavedCloseRef.current = false;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] gap-0 overflow-y-auto p-0 motion-reduce:duration-0 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-h-[calc(100dvh-2rem)] sm:max-w-[640px] [&_[data-slot=dialog-close]]:size-11 sm:[&_[data-slot=dialog-close]]:size-8"
        data-testid="agent-editor-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader className="border-b px-5 py-5 pr-16 text-left sm:px-6">
          <DialogTitle>{editing ? 'Edit agent' : 'Create agent'}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'You can inspect this profile, but your account cannot change it.'
              : 'Define how teammates find this agent and what it can help with.'}
          </DialogDescription>
        </DialogHeader>

        <form className="min-w-0" noValidate onSubmit={handleSubmit}>
          <div className="min-w-0 space-y-5 px-5 py-5 sm:px-6">
            {builtin ? (
              <div
                className="flex items-start gap-2 rounded-lg border bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground"
                data-testid="builtin-agent-protection"
              >
                <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p>
                  This built-in agent must stay enabled and its handle cannot change.
                  You can still update its name, description, skills, and runtime.
                </p>
              </div>
            ) : null}

            {error ? (
              <div
                aria-atomic="true"
                aria-live="assertive"
                className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                data-testid="agent-editor-error"
                id={FORM_ERROR_ID}
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                {error}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  aria-describedby={invalidField === 'name' ? FORM_ERROR_ID : undefined}
                  aria-invalid={invalidField === 'name' || undefined}
                  autoCapitalize="words"
                  autoComplete="off"
                  className="h-11 text-base sm:h-10 md:text-base"
                  id="agent-name"
                  maxLength={100}
                  name="name"
                  onChange={(event) => {
                    setName(event.target.value);
                    clearFieldError('name');
                  }}
                  placeholder="Example: Research partner…"
                  required
                  readOnly={readOnly}
                  ref={nameRef}
                  spellCheck={true}
                  value={name}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent-handle">Handle</Label>
                <Input
                  aria-describedby={invalidField === 'handle' ? FORM_ERROR_ID : undefined}
                  aria-invalid={invalidField === 'handle' || undefined}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-11 text-base sm:h-10 md:text-base"
                  id="agent-handle"
                  maxLength={64}
                  name="handle"
                  onBlur={(event) => {
                    if (!builtin) setHandle(normalizeAgentHandle(event.target.value));
                  }}
                  onChange={(event) => {
                    setHandle(event.target.value);
                    clearFieldError('handle');
                  }}
                  placeholder="Example: @researcher…"
                  required
                  readOnly={readOnly || builtin}
                  ref={handleRef}
                  spellCheck={false}
                  value={handle}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-description">Description</Label>
              <Textarea
                autoCapitalize="sentences"
                autoComplete="off"
                className="min-h-24 resize-y text-base md:text-base"
                id="agent-description"
                maxLength={1000}
                name="description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Example: Summarizes research and checks sources…"
                readOnly={readOnly}
                spellCheck={true}
                value={description}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-skills">Skills</Label>
              <Input
                aria-describedby={SKILLS_HELP_ID}
                autoCapitalize="none"
                autoComplete="off"
                className="h-11 text-base sm:h-10 md:text-base"
                id="agent-skills"
                name="skills"
                onChange={(event) => setSkills(event.target.value)}
                placeholder="Example: research, writing, planning…"
                readOnly={readOnly}
                spellCheck={false}
                value={skills}
              />
              <p className="text-xs leading-5 text-muted-foreground" id={SKILLS_HELP_ID}>
                Separate skills with commas. These labels help people choose the right agent.
              </p>
            </div>

            <div className="space-y-2">
              <Label id="agent-enabled-label">Availability</Label>
              <button
                aria-checked={enabled}
                aria-describedby={builtin ? 'agent-enabled-help' : undefined}
                aria-label="Availability"
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border px-3 text-left outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:min-h-10',
                  enabled ? 'bg-background' : 'bg-muted/35',
                  (readOnly || builtin) && 'cursor-not-allowed opacity-65'
                )}
                disabled={readOnly || builtin}
                name="enabled"
                onClick={() => setEnabled((current) => !current)}
                role="switch"
                type="button"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium" id="agent-enabled-state">
                    {enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {enabled
                      ? 'Available for Room and task assignment.'
                      : 'Kept in the registry but unavailable for new work.'}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative h-6 w-10 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
                    enabled ? 'bg-foreground' : 'bg-input'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1 size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
                      enabled ? 'translate-x-5' : 'translate-x-1'
                    )}
                  />
                </span>
              </button>
              {builtin ? (
                <p className="text-xs text-muted-foreground" id="agent-enabled-help">
                  Built-in agents are always enabled.
                </p>
              ) : null}
            </div>

            <details
              className="group min-w-0 overflow-hidden rounded-lg border"
              data-testid="agent-runtime-details"
            >
              <summary className="flex min-h-11 min-w-0 list-none items-center gap-3 overflow-hidden px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
                <span className="shrink-0">Runtime configuration</span>
                <span
                  className="min-w-0 flex-1 truncate text-right font-mono text-xs font-normal text-muted-foreground"
                  title={runtimeId || 'Not set'}
                  translate="no"
                >
                  {runtimeId || 'Not set'}
                </span>
              </summary>
              <div className="min-w-0 space-y-2 border-t px-3 py-3">
                <Label htmlFor="agent-runtime">Room runtime ID</Label>
                <Input
                  aria-describedby={invalidField === 'runtime' ? FORM_ERROR_ID : undefined}
                  aria-invalid={invalidField === 'runtime' || undefined}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-11 font-mono text-base sm:h-10 md:text-base"
                  id="agent-runtime"
                  name="runtimeId"
                  onChange={(event) => {
                    setRuntimeId(event.target.value);
                    clearFieldError('runtime');
                  }}
                  required
                  readOnly={readOnly}
                  ref={runtimeRef}
                  spellCheck={false}
                  translate="no"
                  value={runtimeId}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Advanced: selects the Room runtime adapter. Configuration version 1 is used.
                </p>
              </div>
            </details>
          </div>

          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6">
            <Button
              className="min-h-11 sm:min-h-9"
              disabled={isSubmitting}
              onClick={() => handleDialogOpenChange(false)}
              type="button"
              variant="ghost"
            >
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly ? (
              <Button
                aria-describedby={isSubmitting ? SUBMIT_STATUS_ID : undefined}
                aria-busy={isSubmitting}
                className="min-h-11 sm:min-h-9"
                data-testid="agent-save-button"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                    Saving…
                  </>
                ) : editing ? (
                  'Save changes'
                ) : (
                  'Create agent'
                )}
              </Button>
            ) : null}
          </DialogFooter>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            id={SUBMIT_STATUS_ID}
            role="status"
          >
            {isSubmitting ? 'Saving agent.' : ''}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
