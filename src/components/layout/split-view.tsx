'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export function SplitView({
  left,
  right,
  className,
  defaultRatio = 0.38,
  resetKey,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
  defaultRatio?: number;
  resetKey?: string;
}) {
  const [splitRatio, setSplitRatio] = React.useState(defaultRatio);
  const [isDragging, setIsDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSplitRatio(defaultRatio);
  }, [defaultRatio, resetKey]);

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
        'flex h-full min-h-0 w-full min-w-0 overflow-hidden',
        isDragging && 'select-none',
        className
      )}
    >
      <div
        className={cn(
          'flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-border',
          isDragging && 'pointer-events-none'
        )}
        inert={isDragging ? true : undefined}
        style={{ width: `${splitRatio * 100}%` }}
      >
        {left}
      </div>

      <div
        aria-label="Resize panels"
        aria-orientation="vertical"
        aria-valuemax={60}
        aria-valuemin={20}
        aria-valuenow={Math.round(splitRatio * 100)}
        className="w-2 flex-shrink-0 touch-none cursor-col-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-primary/20 motion-reduce:transition-none"
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
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden',
          isDragging && 'pointer-events-none'
        )}
        inert={isDragging ? true : undefined}
      >
        {right}
      </div>
    </div>
  );
}
