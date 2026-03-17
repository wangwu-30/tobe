'use client';

import * as React from 'react';
import { Code2, FileText, Globe, Presentation } from 'lucide-react';
import type { DeliverableType } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';

const OPTION_ICON: Record<DeliverableType, React.ComponentType<{ className?: string }>> = {
  code: Code2,
  document: FileText,
  slides: Presentation,
  web: Globe,
};

export function WorkspaceStarterDialog({
  onOpenChange,
  onSelect,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onSelect: (deliverableType: DeliverableType) => void;
  open: boolean;
}) {
  const t = useT();
  const options: Array<{
    disabled?: boolean;
    deliverableType: DeliverableType;
    description: string;
    disabledDescription?: string;
    title: string;
  }> = [
    {
      deliverableType: 'document',
      description: t('goal.documentDescription'),
      title: t('goal.document'),
    },
    {
      deliverableType: 'slides',
      description: t('goal.slidesDescription'),
      title: t('goal.slides'),
    },
    {
      deliverableType: 'web',
      description: t('goal.webPageDescription'),
      title: t('goal.webPage'),
    },
    {
      deliverableType: 'code',
      description: t('goal.codeDeliverableDescription'),
      disabled: true,
      disabledDescription: t('goal.codeDeliverableDisabledDescription'),
      title: t('goal.codeDeliverable'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{t('goal.chooseWorkspaceTitle')}</DialogTitle>
          <DialogDescription>{t('goal.chooseWorkspaceDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const Icon = OPTION_ICON[option.deliverableType];
            return (
              <button
                key={option.deliverableType}
                type="button"
                disabled={option.disabled}
                data-testid={`starter-option-${option.deliverableType}`}
                className={cn(
                  'group flex min-h-[148px] flex-col items-start rounded-3xl border border-border/70 bg-muted/10 p-5 text-left transition-colors',
                  option.disabled
                    ? 'cursor-not-allowed border-border/50 bg-muted/5 text-muted-foreground'
                    : 'hover:border-primary/30 hover:bg-accent'
                )}
                onClick={() => {
                  if (!option.disabled) {
                    onSelect(option.deliverableType);
                  }
                }}
              >
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-3 shadow-sm">
                    <Icon className={cn('h-5 w-5', option.disabled ? 'text-muted-foreground' : 'text-foreground')} />
                  </div>
                  {option.disabled ? (
                    <span className="rounded-full border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {t('goal.comingSoon')}
                    </span>
                  ) : null}
                </div>
                <div className={cn('mt-4 text-base font-semibold tracking-tight', option.disabled && 'text-foreground/70')}>
                  {option.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {option.disabledDescription || option.description}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          {t('goal.chooseWorkspaceFootnote')}
        </p>
      </DialogContent>
    </Dialog>
  );
}
