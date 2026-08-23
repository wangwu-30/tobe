'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';

const FIRST_USE_GUIDE_STORAGE_PREFIX = 'dao-first-use-guide:';

export function FirstUseGuide({
  actions,
  className,
  description,
  guideId,
  storageKey,
  testId,
  title,
  variant = 'default',
}: {
  actions?: React.ReactNode;
  className?: string;
  description: string;
  guideId: string;
  storageKey?: string;
  testId?: string;
  title: string;
  variant?: 'compact' | 'default';
}) {
  const t = useT();
  const resolvedStorageKey = storageKey || `${FIRST_USE_GUIDE_STORAGE_PREFIX}${guideId}`;
  const [isMounted, setIsMounted] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    setIsMounted(true);
    setDismissed(window.localStorage.getItem(resolvedStorageKey) === 'true');
  }, [resolvedStorageKey]);

  const handleDismiss = React.useCallback(() => {
    window.localStorage.setItem(resolvedStorageKey, 'true');
    setDismissed(true);
  }, [resolvedStorageKey]);

  if (!isMounted || dismissed) {
    return null;
  }

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'rounded-xl border border-border/70 bg-muted/20 px-3 py-2 shadow-sm',
          className
        )}
        data-testid={testId}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">{title}</div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {description}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {actions}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-10 px-3 text-[11px] sm:min-h-6 sm:px-2"
                  onClick={handleDismiss}
                >
                  {t('common.gotIt')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 shadow-sm',
        className
      )}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actions}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-10 px-3 text-xs sm:min-h-7 sm:px-2"
              onClick={handleDismiss}
            >
              {t('common.gotIt')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
