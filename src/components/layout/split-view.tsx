'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export function SplitView({
  left,
  right,
  className,
  defaultRatio = 0.38,
  leftLabel,
  mobilePaneRequest,
  resetKey,
  rightLabel,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
  defaultRatio?: number;
  leftLabel: string;
  mobilePaneRequest?: 'left' | 'right';
  resetKey?: string;
  rightLabel: string;
}) {
  const [splitRatio, setSplitRatio] = React.useState(defaultRatio);
  const [isDragging, setIsDragging] = React.useState(false);
  const [mobilePane, setMobilePane] = React.useState<'left' | 'right'>(
    mobilePaneRequest ?? (defaultRatio >= 0.5 ? 'left' : 'right')
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leftPaneId = React.useId();
  const rightPaneId = React.useId();

  React.useEffect(() => {
    setSplitRatio(defaultRatio);
    setMobilePane(defaultRatio >= 0.5 ? 'left' : 'right');
  }, [defaultRatio, resetKey]);

  React.useEffect(() => {
    if (mobilePaneRequest) {
      setMobilePane(mobilePaneRequest);
    }
  }, [mobilePaneRequest, resetKey]);

  const updateRatioFromPointer = React.useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    setSplitRatio(Math.max(0.2, Math.min(0.6, ratio)));
  }, []);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      updateRatioFromPointer(event.clientX);
    },
    [updateRatioFromPointer]
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      updateRatioFromPointer(event.clientX);
    },
    [isDragging, updateRatioFromPointer]
  );

  const finishPointerDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsDragging(false);
    },
    []
  );

  const handleSeparatorKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === 'Home') {
      event.preventDefault();
      setSplitRatio(0.2);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSplitRatio(0.6);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSplitRatio((current) => Math.max(0.2, current - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSplitRatio((current) => Math.min(0.6, current + step));
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden md:flex-row',
        isDragging && 'select-none',
        className
      )}
    >
      <div
        aria-label={`${leftLabel} / ${rightLabel}`}
        className="grid shrink-0 grid-cols-2 gap-1 border-b border-border bg-background p-2 md:hidden"
        role="group"
      >
        <button
          aria-controls={leftPaneId}
          aria-pressed={mobilePane === 'left'}
          className={cn(
            'min-h-11 min-w-0 touch-manipulation truncate rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            mobilePane === 'left' && 'bg-accent text-accent-foreground'
          )}
          data-testid="workspace-mobile-pane-left"
          onClick={() => setMobilePane('left')}
          type="button"
        >
          {leftLabel}
        </button>
        <button
          aria-controls={rightPaneId}
          aria-pressed={mobilePane === 'right'}
          className={cn(
            'min-h-11 min-w-0 touch-manipulation truncate rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            mobilePane === 'right' && 'bg-accent text-accent-foreground'
          )}
          data-testid="workspace-mobile-pane-right"
          onClick={() => setMobilePane('right')}
          type="button"
        >
          {rightLabel}
        </button>
      </div>

      <div
        aria-label={leftLabel}
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-none md:border-r md:border-border md:w-[var(--split-pane-width)]',
          mobilePane === 'left' ? 'flex' : 'hidden md:flex',
          isDragging && 'pointer-events-none'
        )}
        id={leftPaneId}
        inert={isDragging ? true : undefined}
        role="region"
        style={
          { '--split-pane-width': `${splitRatio * 100}%` } as React.CSSProperties
        }
      >
        {left}
      </div>

      <div
        aria-label="Resize panels"
        aria-orientation="vertical"
        aria-valuemax={60}
        aria-valuemin={20}
        aria-valuenow={Math.round(splitRatio * 100)}
        className="hidden w-2 flex-shrink-0 touch-none cursor-col-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-primary/20 motion-reduce:transition-none md:block"
        onKeyDown={handleSeparatorKeyDown}
        onLostPointerCapture={() => setIsDragging(false)}
        onPointerCancel={finishPointerDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        role="separator"
        tabIndex={0}
      />

      <div
        aria-label={rightLabel}
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          mobilePane === 'right' ? 'flex' : 'hidden md:flex',
          isDragging && 'pointer-events-none'
        )}
        id={rightPaneId}
        inert={isDragging ? true : undefined}
        role="region"
      >
        {right}
      </div>
    </div>
  );
}
