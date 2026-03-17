'use client';

import * as React from 'react';

import type { TCommentText } from 'platejs';
import type { PlateLeafProps } from 'platejs/react';

import { getCommentCount } from '@platejs/comment';
import { PlateLeaf, useEditorPlugin, usePluginOption } from 'platejs/react';

import { cn } from '@/lib/utils';
import { commentPlugin } from '@/components/editor/plugins/comment-kit';
import { discussionPlugin } from '@/components/editor/plugins/discussion-kit';
import { requestCommentThreadFocus } from '@/lib/comments/constants';

export function CommentLeaf(props: PlateLeafProps<TCommentText>) {
  const { children, leaf } = props;

  const { api, setOption } = useEditorPlugin(commentPlugin);
  const hoverId = usePluginOption(commentPlugin, 'hoverId');
  const activeId = usePluginOption(commentPlugin, 'activeId');
  const discussions = usePluginOption(discussionPlugin, 'discussions');

  const isOverlapping = getCommentCount(leaf) > 1;
  const currentId = api.comment.nodeId(leaf);
  const isActive = activeId === currentId;
  const isHover = hoverId === currentId;
  const isResolved =
    currentId != null &&
    discussions.some((discussion) => discussion.id === currentId && discussion.isResolved);
  const shouldShowHighlight = !isResolved || isHover || isActive;

  return (
    <PlateLeaf
      {...props}
      className={cn(
        'transition-colors duration-200',
        shouldShowHighlight && 'border-b-2 border-b-highlight/[.36] bg-highlight/[.13]',
        shouldShowHighlight && (isHover || isActive) && 'border-b-highlight bg-highlight/25',
        shouldShowHighlight && isOverlapping && 'border-b-2 border-b-highlight/[.7] bg-highlight/25',
        shouldShowHighlight &&
          (isHover || isActive) &&
          isOverlapping &&
          'border-b-highlight bg-highlight/45'
      )}
      attributes={{
        ...props.attributes,
        'data-comment-thread-id': currentId ?? undefined,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          setOption('activeId', currentId ?? null);
          if (currentId) {
            requestCommentThreadFocus(currentId);
          }
        },
        onMouseEnter: () => setOption('hoverId', currentId ?? null),
        onMouseLeave: () => setOption('hoverId', null),
      }}
    >
      {children}
    </PlateLeaf>
  );
}
