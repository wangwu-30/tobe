'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeliverableType } from '@/types';
import { useT } from '@/components/providers/language-provider';

export type GoalComposerValues = {
  constraints: string;
  deliverableType: DeliverableType;
  goal: string;
  styleGuide: string;
};

const DEFAULT_VALUES: GoalComposerValues = {
  constraints: '',
  deliverableType: 'document',
  goal: '',
  styleGuide: '',
};

export function GoalComposerDialog({
  disableInputs = false,
  errorMessage = null,
  initialValues,
  isSubmitting = false,
  onOpenChange,
  onSubmit,
  submitLabel,
  open,
}: {
  disableInputs?: boolean;
  errorMessage?: string | null;
  initialValues?: Partial<GoalComposerValues>;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: GoalComposerValues) => void | Promise<void>;
  open: boolean;
  submitLabel?: string;
}) {
  const t = useT();
  const [values, setValues] = React.useState<GoalComposerValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  });

  React.useEffect(() => {
    if (!open) {
      setValues({
        ...DEFAULT_VALUES,
        ...initialValues,
      });
    }
  }, [initialValues, open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) {
          return;
        }

        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-[560px]"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('goal.startWithGoal')}</DialogTitle>
          <DialogDescription>
            {t('goal.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal">{t('goal.goal')}</Label>
            <Textarea
              id="goal"
              value={values.goal}
              disabled={disableInputs || isSubmitting}
              onChange={(event) =>
                setValues((current) => ({ ...current, goal: event.target.value }))
              }
              placeholder={t('goal.goalPlaceholder')}
              className="min-h-[120px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('goal.deliverableType')}</Label>
              <Select
                disabled={disableInputs || isSubmitting}
                value={values.deliverableType}
                onValueChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    deliverableType:
                      value === 'web' || value === 'code' || value === 'slides'
                        ? value
                        : 'document',
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="document">{t('goal.document')}</SelectItem>
                  <SelectItem value="slides">{t('goal.slides')}</SelectItem>
                  <SelectItem value="web">{t('goal.webPage')}</SelectItem>
                  <SelectItem value="code">{t('goal.codeDeliverable')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="style-guide">{t('goal.styleTone')}</Label>
              <Textarea
                id="style-guide"
                value={values.styleGuide}
                disabled={disableInputs || isSubmitting}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    styleGuide: event.target.value,
                  }))
                }
                placeholder={t('goal.stylePlaceholder')}
                className="min-h-[88px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="constraints">{t('goal.constraints')}</Label>
            <Textarea
              id="constraints"
              value={values.constraints}
              disabled={disableInputs || isSubmitting}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  constraints: event.target.value,
                }))
              }
              placeholder={t('goal.constraintsPlaceholder')}
              className="min-h-[88px]"
            />
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void onSubmit(values)}
            disabled={isSubmitting || !values.goal.trim()}
          >
            {isSubmitting
              ? t('goal.creatingProject')
              : submitLabel || t('goal.createProject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
