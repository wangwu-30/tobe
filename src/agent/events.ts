'use client';

export const OPEN_AGENT_COMPOSER_EVENT = 'open-agent-composer';

export type OpenAgentComposerDetail = {
  prompt?: string;
};

export function requestAgentComposerOpen(prompt?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OpenAgentComposerDetail>(OPEN_AGENT_COMPOSER_EVENT, {
      detail: { prompt },
    })
  );
}
