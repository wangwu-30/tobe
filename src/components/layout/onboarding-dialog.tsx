'use client';

import * as React from 'react';
import { MessageSquareText } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { FirstUseGuide } from '@/components/layout/first-use-guide';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'dao-has-seen-onboarding';

export function OnboardingDialog() {
  const t = useT();
  const [dismissedByAction, setDismissedByAction] = React.useState(false);

  const handleAskAssistant = React.useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setDismissedByAction(true);

    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-testid="agent-composer-input"]')
        ?.focus();
    });
  }, []);

  if (dismissedByAction) {
    return null;
  }

  return (
    <FirstUseGuide
      className="fixed bottom-4 right-4 z-40 w-[min(28rem,calc(100vw-2rem))] bg-background/96 backdrop-blur [&_button]:min-h-11 md:[&_button]:min-h-8"
      actions={
        <Button
          className="gap-2"
          onClick={handleAskAssistant}
          size="sm"
          type="button"
        >
          <MessageSquareText aria-hidden="true" className="h-4 w-4" />
          {t('home.askAssistant')}
        </Button>
      }
      description={t('onboarding.description')}
      guideId="home"
      storageKey={STORAGE_KEY}
      testId="first-use-guide-home"
      title={t('onboarding.title')}
    />
  );
}
