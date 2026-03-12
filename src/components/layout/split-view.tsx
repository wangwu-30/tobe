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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  React.useEffect(() => {
    setSplitRatio(defaultRatio);
  }, [defaultRatio, resetKey]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.2, Math.min(0.6, ratio)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full min-h-0 w-full min-w-0 overflow-hidden', className)}
    >
      <div
        className="flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-border"
        style={{ width: `${splitRatio * 100}%` }}
      >
        {left}
      </div>

      <div
        className="w-1.5 cursor-col-resize bg-transparent hover:bg-primary/10 active:bg-primary/20 transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {right}
      </div>
    </div>
  );
}
