'use client';

import type { PlateElementProps } from 'platejs/react';
import { PlateElement } from 'platejs/react';

import { cn } from '@/lib/utils';

export function SlidePageElement(props: PlateElementProps) {
  const element = props.element as { title?: string } | undefined;
  const title =
    typeof element?.title === 'string' && element.title.trim()
      ? element.title.trim()
      : 'Slide';

  return (
    <PlateElement
      {...props}
      className={cn(
        'my-5 rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.05),_transparent_55%)] p-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.35)]'
      )}
    >
      <div
        contentEditable={false}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <span className="rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-primary/80">
          Slide Page
        </span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="space-y-2">{props.children}</div>
    </PlateElement>
  );
}
