'use client';

import { useT } from '@/components/providers/language-provider';
import { FirstUseGuide } from '@/components/layout/first-use-guide';

const STORAGE_KEY = 'dao-has-seen-onboarding';

export function OnboardingDialog() {
  const t = useT();

  return (
    <FirstUseGuide
      className="fixed bottom-4 right-4 z-40 w-[min(28rem,calc(100vw-2rem))] bg-background/96 backdrop-blur"
      description={t('onboarding.description')}
      guideId="home"
      storageKey={STORAGE_KEY}
      testId="first-use-guide-home"
      title={t('onboarding.title')}
    />
  );
}
