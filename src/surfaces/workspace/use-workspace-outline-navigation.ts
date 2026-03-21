'use client';

import * as React from 'react';

const WORKSPACE_OUTLINE_SURFACE_SELECTOR = '[data-workspace-outline-surface="true"]';

function findOutlineScrollContainer(
  outlineSurface: HTMLElement,
  targetHeading: HTMLElement
) {
  let current: HTMLElement | null = targetHeading.parentElement;

  while (current && current !== outlineSurface) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const isScrollable =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      current.scrollHeight > current.clientHeight + 1;

    if (isScrollable) {
      return current;
    }

    current = current.parentElement;
  }

  const viewport =
    outlineSurface.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
  if (viewport && viewport.scrollHeight > viewport.clientHeight + 1) {
    return viewport;
  }

  return null;
}

export function useWorkspaceOutlineNavigation({
  outlineItems,
}: {
  outlineItems: Array<{ id: string; label?: string | null }>;
}) {
  const openOutline = React.useCallback(
    (outlineId: string) => {
      const match = outlineId.match(/^heading-(\d+)$/);
      if (!match) {
        return;
      }

      const headingIndex = Number.parseInt(match[1] || '', 10);
      if (!Number.isFinite(headingIndex)) {
        return;
      }

      const outlineSurface = document.querySelector(WORKSPACE_OUTLINE_SURFACE_SELECTOR);
      if (!(outlineSurface instanceof HTMLElement)) {
        return;
      }

      const headings = [
        ...outlineSurface.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
      ];
      const targetLabel = outlineItems.find((item) => item.id === outlineId)?.label?.trim();
      const targetHeading =
        (targetLabel
          ? headings.find((heading) => heading.textContent?.trim() === targetLabel)
          : null) || headings[headingIndex];
      if (!targetHeading) {
        return;
      }

      targetHeading.scrollIntoView({
        behavior: 'auto',
        block: 'start',
        inline: 'nearest',
      });

      window.requestAnimationFrame(() => {
        const scrollContainer =
          findOutlineScrollContainer(outlineSurface, targetHeading) ||
          outlineSurface.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
        if (!scrollContainer) {
          return;
        }

        const desiredOffset = 28;
        const relativeTop =
          targetHeading.getBoundingClientRect().top -
          scrollContainer.getBoundingClientRect().top;

        if (relativeTop <= desiredOffset + 4) {
          return;
        }

        scrollContainer.scrollBy({
          top: relativeTop - desiredOffset,
          behavior: 'auto',
        });
      });
    },
    [outlineItems]
  );

  return {
    openOutline,
  };
}
