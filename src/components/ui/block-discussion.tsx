'use client';

import * as React from 'react';

import type { PlateElementProps, RenderNodeWrapper } from 'platejs/react';

import { getTransientSuggestionKey } from '@platejs/suggestion';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PencilLineIcon,
} from 'lucide-react';
import {
  type AnyPluginConfig,
  type NodeEntry,
  type Path,
  type TCommentText,
  type TElement,
  type TSuggestionText,
  PathApi,
} from 'platejs';
import { useEditorPlugin, usePluginOption } from 'platejs/react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { commentPlugin } from '@/components/editor/plugins/comment-kit';
import {
  type TDiscussion,
  discussionPlugin,
} from '@/components/editor/plugins/discussion-kit';
import { suggestionPlugin } from '@/components/editor/plugins/suggestion-kit';
import { requestCommentThreadFocus } from '@/lib/comments/constants';

import {
  BlockSuggestionCard,
  useResolveSuggestion,
} from './block-suggestion';

export const BlockDiscussion: RenderNodeWrapper<AnyPluginConfig> = (props) => {
  const { editor, element } = props;

  const commentsApi = editor.getApi(commentPlugin).comment;
  const blockPath = editor.api.findPath(element);

  // avoid duplicate in table or column
  if (!blockPath || blockPath.length > 1) return;

  const commentNodes = [...commentsApi.nodes({ at: blockPath })];

  const suggestionNodes = [
    ...editor.getApi(SuggestionPlugin).suggestion.nodes({ at: blockPath }),
  ].filter(([node]) => !node[getTransientSuggestionKey()]);

  if (
    commentNodes.length === 0 &&
    suggestionNodes.length === 0
  ) {
    return;
  }

  return function BlockDiscussionContent(props) {
    return (
      <BlockCommentContent
        blockPath={blockPath}
        commentNodes={commentNodes}
        suggestionNodes={suggestionNodes}
        {...props}
      />
    );
  };
};

const BlockCommentContent = function BlockCommentContent({
  blockPath,
  children,
  commentNodes,
  suggestionNodes,
}: PlateElementProps & {
  blockPath: Path;
  commentNodes: NodeEntry<TCommentText>[];
  suggestionNodes: NodeEntry<TElement | TSuggestionText>[];
}) {
  const resolvedSuggestions = useResolveSuggestion(suggestionNodes, blockPath);
  const resolvedDiscussions = useResolvedDiscussion(commentNodes, blockPath);

  const suggestionsCount = resolvedSuggestions.length;
  const discussionsCount = resolvedDiscussions.length;

  const activeSuggestionId = usePluginOption(suggestionPlugin, 'activeId');
  const activeSuggestion =
    activeSuggestionId &&
    resolvedSuggestions.find((s) => s.suggestionId === activeSuggestionId);
  const activeCommentId = usePluginOption(commentPlugin, 'activeId');
  const hasActiveDiscussion = resolvedDiscussions.some(
    discussion => discussion.id === activeCommentId
  );
  const selectedSuggestion = Boolean(activeSuggestion);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(selectedSuggestion);

  React.useEffect(() => {
    if (selectedSuggestion) {
      setSuggestionsOpen(true);
    }
  }, [selectedSuggestion]);

  const primaryDiscussionId =
    hasActiveDiscussion && activeCommentId
      ? activeCommentId
      : resolvedDiscussions[0]?.id ?? null;

  if (suggestionsCount + resolvedDiscussions.length === 0)
    return <div className="w-full">{children}</div>;

  return (
    <div className="flex w-full justify-between">
      <div className="w-full">{children}</div>

      {(discussionsCount > 0 || suggestionsCount > 0) && (
        <div className="relative left-0 size-0 select-none">
          <div className="mt-1 ml-1 flex items-center gap-1">
            {discussionsCount > 0 && primaryDiscussionId && (
              <Button
                variant="ghost"
                className="!px-1.5 flex h-6 gap-1 py-0 text-muted-foreground/80 hover:text-muted-foreground/80"
                contentEditable={false}
                data-testid={`block-discussion-trigger-${primaryDiscussionId}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => requestCommentThreadFocus(primaryDiscussionId)}
              >
                {(suggestionsCount > 0 && (
                  <MessagesSquareIcon className="size-4 shrink-0" />
                )) || <MessageSquareTextIcon className="size-4 shrink-0" />}
                <span className="font-semibold text-xs">{discussionsCount}</span>
              </Button>
            )}

            {suggestionsCount > 0 && (
              <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="!px-1.5 flex h-6 gap-1 py-0 text-muted-foreground/80 hover:text-muted-foreground/80 data-[active=true]:bg-muted"
                    data-active={suggestionsOpen}
                    contentEditable={false}
                  >
                    <PencilLineIcon className="size-4 shrink-0" />
                    <span className="font-semibold text-xs">{suggestionsCount}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="max-h-[min(50dvh,calc(-24px+var(--radix-popper-available-height)))] w-[380px] min-w-[130px] max-w-[calc(100vw-24px)] overflow-y-auto p-0 data-[state=closed]:opacity-0"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  align="center"
                  side="bottom"
                >
                  {resolvedSuggestions.map((suggestion, index) => (
                    <BlockSuggestionCard
                      key={suggestion.suggestionId}
                      idx={index}
                      isLast={index === resolvedSuggestions.length - 1}
                      suggestion={suggestion}
                    />
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const useResolvedDiscussion = (
  commentNodes: NodeEntry<TCommentText>[],
  blockPath: Path
) => {
  const { api, setOption } = useEditorPlugin(commentPlugin);
  const discussions = usePluginOption(discussionPlugin, 'discussions');
  const uniquePathMap = usePluginOption(commentPlugin, 'uniquePathMap');

  const pendingPathEntries = React.useMemo(() => {
    const nextEntries = new Map<string, Path>();

    commentNodes.forEach(([node]) => {
      const id = api.comment.nodeId(node);
      if (!id) return;

      const previousPath = uniquePathMap.get(id);

      // If there are no comment nodes in the corresponding path in the map, then update it.
      if (PathApi.isPath(previousPath)) {
        const nodes = api.comment.node({ id, at: previousPath });
        if (!nodes) {
          nextEntries.set(id, blockPath);
        }
        return;
      }

      nextEntries.set(id, blockPath);
    });

    return [...nextEntries.entries()];
  }, [api.comment, blockPath, commentNodes, uniquePathMap]);

  React.useEffect(() => {
    if (pendingPathEntries.length === 0) {
      return;
    }

    const nextMap = new Map(uniquePathMap);
    let changed = false;

    pendingPathEntries.forEach(([id, path]) => {
      const previousPath = nextMap.get(id);
      if (PathApi.isPath(previousPath) && PathApi.equals(previousPath, path)) {
        return;
      }

      nextMap.set(id, path);
      changed = true;
    });

    if (changed) {
      setOption('uniquePathMap', nextMap);
    }
  }, [pendingPathEntries, setOption, uniquePathMap]);

  const commentsIds = new Set(
    commentNodes.map(([node]) => api.comment.nodeId(node)).filter(Boolean)
  );

  const resolvedDiscussions = discussions
    .map((d: TDiscussion) => ({
      ...d,
      createdAt: new Date(d.createdAt),
    }))
    .filter((item: TDiscussion) => {
      /** If comment cross blocks just show it in the first block */
      const firstBlockPath = uniquePathMap.get(item.id);

      if (!firstBlockPath) return false;
      if (!PathApi.equals(firstBlockPath, blockPath)) return false;

      return (
        api.comment.has({ id: item.id }) &&
        commentsIds.has(item.id) &&
        !item.isResolved
      );
    });

  return resolvedDiscussions;
};
