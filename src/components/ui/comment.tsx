'use client';

import * as React from 'react';

import type { CreatePlateEditorOptions } from 'platejs/react';

import { getCommentKey, getDraftCommentKey } from '@platejs/comment';
import { CommentPlugin, useCommentId } from '@platejs/comment/react';
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
} from 'date-fns';
import {
  ArrowUpIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react';
import {
  type NodeEntry,
  type TCommentText,
  type Value,
  KEYS,
  nanoid,
  NodeApi,
} from 'platejs';
import {
  Plate,
  useEditorPlugin,
  useEditorRef,
  usePlateEditor,
  usePluginOption,
} from 'platejs/react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BasicMarksKit } from '@/components/editor/plugins/basic-marks-kit';
import {
  type TDiscussion,
  discussionPlugin,
} from '@/components/editor/plugins/discussion-kit';
import { useAiReply } from '@/hooks/use-ai-reply';
import { useCommentAgents } from '@/hooks/use-comment-agents';
import { useEditorSession } from '@/components/editor/editor-session-context';
import {
  notifyCommentThreadsChanged,
} from '@/lib/comments/constants';
import { parseCommentAgentMentions } from '@/lib/comments/agents';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';

import { Editor, EditorContainer } from './editor';
import { apiFetch } from '@/framework/resilience';


export type TComment = {
  id: string;
  contentRich: Value;
  createdAt: Date;
  discussionId: string;
  isEdited: boolean;
  userId: string;
};

export function Comment(props: {
  comment: TComment;
  discussionLength: number;
  editingId: string | null;
  index: number;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  documentContent?: string;
  showDocumentContent?: boolean;
  onEditorClick?: () => void;
}) {
  const {
    comment,
    discussionLength,
    documentContent,
    editingId,
    index,
    setEditingId,
    showDocumentContent = false,
    onEditorClick,
  } = props;

  const userInfo = usePluginOption(discussionPlugin, 'user', comment.userId);
  const currentUserId = usePluginOption(discussionPlugin, 'currentUserId');
  const isMyComment = currentUserId === comment.userId;

  const updateComment = React.useCallback(async (input: {
    id: string;
    contentRich: Value;
    discussionId: string;
    isEdited: boolean;
  }) => {
    const content = NodeApi.string({ children: input.contentRich, type: KEYS.p });
    const response = await apiFetch(
      `/api/threads/${input.discussionId}/messages/${input.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );

    if (response.ok) {
      notifyCommentThreadsChanged();
    }
  }, []);

  const { tf } = useEditorPlugin(CommentPlugin);

  const initialValue = comment.contentRich;

  const commentEditor = useCommentEditor(
    {
      id: comment.id,
      value: initialValue,
    },
    [initialValue]
  );

  const onCancel = () => {
    setEditingId(null);
    commentEditor.tf.replaceNodes(initialValue, {
      at: [],
      children: true,
    });
  };

  const onSave = () => {
    void updateComment({
      id: comment.id,
      contentRich: commentEditor.children,
      discussionId: comment.discussionId,
      isEdited: true,
    });
    setEditingId(null);
  };

  const onResolveComment = () => {
    void (async () => {
      const response = await apiFetch(`/api/threads/${comment.discussionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });

      if (response.ok) {
        tf.comment.unsetMark({ id: comment.discussionId });
        notifyCommentThreadsChanged();
      }
    })();
  };

  const isFirst = index === 0;
  const isLast = index === discussionLength - 1;
  const isEditing = editingId && editingId === comment.id;

  const [hovering, setHovering] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="relative flex items-center">
        <Avatar className="size-5">
          <AvatarImage alt={userInfo?.name} src={userInfo?.avatarUrl} />
          <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
        </Avatar>
        <h4 className="mx-2 font-semibold text-sm leading-none">
          {/* Replace to your own backend or refer to potion */}
          {userInfo?.name}
        </h4>

        <div className="text-muted-foreground/80 text-xs leading-none">
          <span className="mr-1">
            {formatCommentDate(new Date(comment.createdAt))}
          </span>
          {comment.isEdited && <span>(edited)</span>}
        </div>

        {isMyComment && (hovering || dropdownOpen) && (
          <div className="absolute top-0 right-0 flex space-x-1">
            {index === 0 && (
              <Button
                variant="ghost"
                className="h-6 p-1 text-muted-foreground"
                onClick={onResolveComment}
                type="button"
              >
                <CheckIcon className="size-4" />
              </Button>
            )}

            <CommentMoreDropdown
              onCloseAutoFocus={() => {
                setTimeout(() => {
                  commentEditor.tf.focus({ edge: 'endEditor' });
                }, 0);
              }}
              onRemoveComment={() => {
                if (discussionLength === 1) {
                  tf.comment.unsetMark({ id: comment.discussionId });
                }
              }}
              comment={comment}
              dropdownOpen={dropdownOpen}
              setDropdownOpen={setDropdownOpen}
              setEditingId={setEditingId}
            />
          </div>
        )}
      </div>

      {isFirst && showDocumentContent && (
        <div className="relative mt-1 flex pl-[32px] text-sm text-subtle-foreground">
          {discussionLength > 1 && (
            <div className="absolute top-[5px] left-3 h-full w-0.5 shrink-0 bg-muted" />
          )}
          <div className="my-px w-0.5 shrink-0 bg-highlight" />
          {documentContent && <div className="ml-2">{documentContent}</div>}
        </div>
      )}

      <div className="relative my-1 pl-[26px]">
        {!isLast && (
          <div className="absolute top-0 left-3 h-full w-0.5 shrink-0 bg-muted" />
        )}
        <Plate readOnly={!isEditing} editor={commentEditor}>
          <EditorContainer variant="comment">
            <Editor
              variant="comment"
              className="w-auto grow"
              onClick={() => onEditorClick?.()}
            />

            {isEditing && (
              <div className="ml-auto flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-[28px]"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    void onCancel();
                  }}
                >
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-[50%] bg-primary/40">
                    <XIcon className="size-3 stroke-[3px] text-background" />
                  </div>
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    void onSave();
                  }}
                >
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-[50%] bg-brand">
                    <CheckIcon className="size-3 stroke-[3px] text-background" />
                  </div>
                </Button>
              </div>
            )}
          </EditorContainer>
        </Plate>
      </div>
    </div>
  );
}

function CommentMoreDropdown(props: {
  comment: TComment;
  dropdownOpen: boolean;
  setDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  onCloseAutoFocus?: () => void;
  onRemoveComment?: () => void;
}) {
  const {
    comment,
    dropdownOpen,
    setDropdownOpen,
    setEditingId,
    onCloseAutoFocus,
    onRemoveComment,
  } = props;

  const selectedEditCommentRef = React.useRef<boolean>(false);

  const onDeleteComment = React.useCallback(() => {
    if (!comment.id)
      return alert('You are operating too quickly, please try again later.');

    void (async () => {
      const response = await apiFetch(
        `/api/threads/${comment.discussionId}/messages/${comment.id}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) return;

      onRemoveComment?.();
      notifyCommentThreadsChanged();
    })();
  }, [comment.discussionId, comment.id, onRemoveComment]);

  const onEditComment = React.useCallback(() => {
    selectedEditCommentRef.current = true;

    if (!comment.id)
      return alert('You are operating too quickly, please try again later.');

    setEditingId(comment.id);
  }, [comment.id, setEditingId]);

  return (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      modal={false}
    >
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" className={cn('h-6 p-1 text-muted-foreground')}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        onCloseAutoFocus={(e) => {
          if (selectedEditCommentRef.current) {
            onCloseAutoFocus?.();
            selectedEditCommentRef.current = false;
          }

          return e.preventDefault();
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onEditComment}>
            <PencilIcon className="size-4" />
            Edit comment
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDeleteComment}>
            <TrashIcon className="size-4" />
            Delete comment
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const useCommentEditor = (
  options: Omit<CreatePlateEditorOptions, 'plugins'> = {},
  deps: unknown[] = []
) => {
  const commentEditor = usePlateEditor(
    {
      id: 'comment',
      plugins: BasicMarksKit,
      value: [],
      ...options,
    },
    deps
  );

  return commentEditor;
};

export function CommentCreateForm({
  autoFocus = false,
  className,
  discussionId: discussionIdProp,
  focusOnMount = false,
}: {
  autoFocus?: boolean;
  className?: string;
  discussionId?: string;
  focusOnMount?: boolean;
}) {
  const discussions = usePluginOption(discussionPlugin, 'discussions');
  const editor = useEditorRef();
  const commentId = useCommentId();
  const discussionId = discussionIdProp ?? commentId;
  const isReply = Boolean(discussionIdProp);
  const editorSession = useEditorSession();
  const { sendCommentReply } = useAiReply();
  const commentAgents = useCommentAgents();

  const userInfo = usePluginOption(discussionPlugin, 'currentUser');
  const [commentValue, setCommentValue] = React.useState<Value | undefined>();
  const commentContent = React.useMemo(
    () =>
      commentValue
        ? NodeApi.string({ children: commentValue, type: KEYS.p })
        : '',
    [commentValue]
  );
  const commentEditor = useCommentEditor();

  React.useEffect(() => {
    if (commentEditor && focusOnMount) {
      commentEditor.tf.focus();
    }
  }, [commentEditor, focusOnMount]);

  const onAddComment = React.useCallback(async () => {
    if (!commentValue) return;

    commentEditor.tf.reset();
    const commentsNodeEntry = editor
      .getApi(CommentPlugin)
      .comment.nodes({ at: [], isDraft: true });
    const discussion = discussions.find((item) => item.id === discussionId);
    const anchorText =
      commentsNodeEntry.map(([node]: NodeEntry<TCommentText>) => node.text).join('') ||
      discussion?.documentContent ||
      '';
    let persistedDiscussionId = discussionId || nanoid();
    const mentionTargets = parseCommentAgentMentions(commentContent, commentAgents);

    if (editorSession?.documentId) {
      if (isReply && discussionId) {
        const response = await apiFetch(`/api/threads/${discussionId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({ role: 'user', content: commentContent }),
        });

        if (response.ok) {
          notifyCommentThreadsChanged();

          for (const target of mentionTargets) {
            await sendCommentReply({
              agentId: target.agentId,
              threadId: discussionId,
              documentContent: editorSession.documentContent,
              anchorText,
              documentId: editorSession.documentId,
            });
            notifyCommentThreadsChanged();
          }
        }
        return;
      }

      if (commentsNodeEntry.length > 0) {
        const response = await apiFetch('/api/threads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            documentId: editorSession.documentId,
            anchorText,
            draftRevision: editorSession.versionId ? null : editorSession.draftRevision,
            firstMessage: commentContent,
            versionId: editorSession.versionId || null,
            selectionAnchor: JSON.stringify({
              surfaceType: 'document-block',
              bindingType: 'block',
              anchorPayload: {
                excerpt: anchorText,
              },
              previewVersionId: editorSession.versionId || null,
              sourceMapping: {
                fileId: editorSession.fileId || null,
              },
            }),
          }),
        });

        if (response.ok) {
          const thread = await response.json();
          persistedDiscussionId = thread.id;
          notifyCommentThreadsChanged();

          for (const binding of thread.agentBindings || []) {
            await sendCommentReply({
              agentId: binding.agentId,
              threadId: thread.id,
              documentContent: editorSession.documentContent,
              anchorText,
              documentId: editorSession.documentId,
            });
            notifyCommentThreadsChanged();
          }
        }
      }
      if (commentsNodeEntry.length === 0) return;

      commentsNodeEntry.forEach(([, path]: NodeEntry<TCommentText>) => {
        editor.tf.setNodes(
          {
            [getCommentKey(persistedDiscussionId)]: true,
          },
          { at: path, split: true }
        );
        editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
      });

      notifyCommentThreadsChanged();
      return;
    }

    if (commentsNodeEntry.length === 0) return;

    const newDiscussion: TDiscussion = {
      id: persistedDiscussionId,
      comments: [
        {
          id: nanoid(),
          contentRich: commentValue,
          createdAt: new Date(),
          discussionId: persistedDiscussionId,
          isEdited: false,
          userId: editor.getOption(discussionPlugin, 'currentUserId'),
        },
      ],
      createdAt: new Date(),
      documentContent: anchorText,
      isResolved: false,
      userId: editor.getOption(discussionPlugin, 'currentUserId'),
    };

    editor.setOption(discussionPlugin, 'discussions', [
      ...discussions,
      newDiscussion,
    ]);

    commentsNodeEntry.forEach(([, path]: NodeEntry<TCommentText>) => {
      editor.tf.setNodes(
        {
          [getCommentKey(persistedDiscussionId)]: true,
        },
        { at: path, split: true }
      );
      editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
    });
  }, [
    commentContent,
    commentValue,
    commentEditor.tf,
    discussionId,
    discussions,
    editor,
    editorSession,
    isReply,
    commentAgents,
    sendCommentReply,
  ]);

  return (
    <div className={cn('flex w-full', className)}>
      <div className="mt-2 mr-1 shrink-0">
        {/* Replace to your own backend or refer to potion */}
        <Avatar className="size-5">
          <AvatarImage alt={userInfo?.name} src={userInfo?.avatarUrl} />
          <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
        </Avatar>
      </div>

      <div className="relative flex grow gap-2">
        <Plate
          onChange={({ value }) => {
            setCommentValue(value);
          }}
          editor={commentEditor}
        >
          <EditorContainer variant="comment">
            <Editor
              variant="comment"
              className="min-h-[25px] grow pt-0.5 pr-8"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onAddComment();
                }
              }}
              placeholder="Reply…"
              autoComplete="off"
              autoFocus={autoFocus}
            />

            <Button
              size="icon"
              variant="ghost"
              className="absolute right-0.5 bottom-0.5 ml-auto size-6 shrink-0"
              disabled={commentContent.trim().length === 0}
              onClick={(e) => {
                e.stopPropagation();
                onAddComment();
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-full">
                <ArrowUpIcon />
              </div>
            </Button>
          </EditorContainer>
        </Plate>
      </div>
    </div>
  );
}

export const formatCommentDate = (date: Date) => {
  const now = new Date();
  const diffMinutes = differenceInMinutes(now, date);
  const diffHours = differenceInHours(now, date);
  const diffDays = differenceInDays(now, date);

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  if (diffDays < 2) {
    return `${diffDays}d`;
  }

  return format(date, 'MM/dd/yyyy');
};
