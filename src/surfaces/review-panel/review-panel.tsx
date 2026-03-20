'use client';

import * as React from 'react';

import { CommentSidebar } from '@/components/comments/comment-sidebar';

type WorkspaceReviewPanelProps = Omit<
  React.ComponentProps<typeof CommentSidebar>,
  'embedded' | 'onOpenChange' | 'showHeader'
>;

export function ReviewPanelSurface(props: WorkspaceReviewPanelProps) {
  return (
    <CommentSidebar
      {...props}
      embedded
      onOpenChange={() => undefined}
      showHeader={false}
    />
  );
}
