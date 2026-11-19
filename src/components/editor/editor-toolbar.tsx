'use client';

import * as React from 'react';
import { toggleCodeBlock } from '@platejs/code-block';
import { unwrapLink, upsertLink } from '@platejs/link';
import { ListStyleType, someList, toggleList } from '@platejs/list';
import {
  Bold,
  ChevronDown,
  Code,
  FileCode2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Unlink,
  Undo2,
} from 'lucide-react';
import { KEYS, type TElement, type TLinkElement, type TRange } from 'platejs';
import { useEditorRef, useEditorSelector } from 'platejs/react';

import { useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { normalizeLinkInputUrl } from '@/lib/ai/serializer';
import { cn } from '@/lib/utils';

type BlockStyleOption = 'p' | 'h1' | 'h2' | 'h3';

function preventEditorBlur(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function EditorToolbar() {
  const editor = useEditorRef();
  const t = useT();
  const linkInputId = React.useId();

  const [linkPopoverOpen, setLinkPopoverOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState('');
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const savedSelectionRef = React.useRef<TRange | null>(null);

  const toolbarState = useEditorSelector((ed) => {
    const marks = (ed.api.marks() ?? {}) as Record<string, unknown>;
    const currentBlock = ed.api.block<TElement>();
    const rawBlockType = currentBlock?.[0]?.type;
    const blockStyle: BlockStyleOption =
      rawBlockType === ed.getType(KEYS.h1)
        ? 'h1'
        : rawBlockType === ed.getType(KEYS.h2)
          ? 'h2'
          : rawBlockType === ed.getType(KEYS.h3)
            ? 'h3'
            : 'p';

    const linkEntry = ed.api.above<TLinkElement>({
      match: { type: ed.getType(KEYS.link) },
    });

    return {
      activeLinkUrl: linkEntry?.[0]?.url ?? null,
      blockStyle,
      canRedo: ed.history.redos.length > 0,
      canUndo: ed.history.undos.length > 0,
      isBlockquote: rawBlockType === ed.getType(KEYS.blockquote),
      isBold: Boolean(marks[KEYS.bold]),
      isBulletList: someList(ed, ListStyleType.Disc),
      isCode: Boolean(marks[KEYS.code]),
      isCodeBlock: ed.api.some({
        match: { type: ed.getType(KEYS.codeBlock) },
      }),
      isItalic: Boolean(marks[KEYS.italic]),
      isLink: Boolean(linkEntry),
      isNumberedList: someList(ed, ListStyleType.Decimal),
      isStrikethrough: Boolean(marks[KEYS.strikethrough]),
    };
  }, []);

  const blockStyleLabel =
    toolbarState.blockStyle === 'h1'
      ? t('editor.heading1')
      : toolbarState.blockStyle === 'h2'
        ? t('editor.heading2')
        : toolbarState.blockStyle === 'h3'
          ? t('editor.heading3')
          : t('editor.paragraph');

  const applyBlockStyle = (target: BlockStyleOption) => {
    const typeKey =
      target === 'h1'
        ? KEYS.h1
        : target === 'h2'
          ? KEYS.h2
          : target === 'h3'
            ? KEYS.h3
            : KEYS.p;
    editor.tf.toggleBlock(editor.getType(typeKey));
    editor.tf.focus();
  };

  const toggleMark = (markKey: string) => {
    editor.tf.toggleMark(markKey);
    editor.tf.focus();
  };

  const handleLinkOpenChange = (open: boolean) => {
    if (open) {
      savedSelectionRef.current = editor.selection;
      setLinkUrl(toolbarState.activeLinkUrl ?? '');
      setLinkError(null);
    }
    setLinkPopoverOpen(open);
  };

  const handleLinkSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeLinkInputUrl(linkUrl);
    if (!normalized) {
      setLinkError(t('editor.linkInvalidUrl'));
      return;
    }

    if (savedSelectionRef.current) {
      editor.tf.select(savedSelectionRef.current);
    }
    upsertLink(editor, {
      skipValidation: true,
      url: normalized,
    });
    setLinkError(null);
    setLinkPopoverOpen(false);
    editor.tf.focus();
  };

  const handleLinkRemove = () => {
    if (savedSelectionRef.current) {
      editor.tf.select(savedSelectionRef.current);
    }
    unwrapLink(editor);
    setLinkUrl('');
    setLinkError(null);
    setLinkPopoverOpen(false);
    editor.tf.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbarLabel')}
      data-testid="wiki-editor-toolbar"
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-background/95 px-3 py-1"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={t('editor.undo')}
          data-testid="editor-toolbar-undo"
          disabled={!toolbarState.canUndo}
          onClick={() => {
            editor.tf.undo();
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.undo')}
          variant="ghost"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.redo')}
          data-testid="editor-toolbar-redo"
          disabled={!toolbarState.canRedo}
          onClick={() => {
            editor.tf.redo();
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.redo')}
          variant="ghost"
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <span
        aria-hidden="true"
        className="mx-1 h-4 w-px shrink-0 bg-border"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t('editor.blockStyle')}
            className="h-8 min-w-[5.75rem] justify-between gap-1 px-2 text-xs font-normal"
            data-testid="editor-toolbar-block-style"
            onMouseDown={preventEditorBlur}
            size="sm"
            variant="ghost"
          >
            <span className="truncate">{blockStyleLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[9rem]">
          <DropdownMenuItem
            data-testid="editor-block-style-p"
            onSelect={() => applyBlockStyle('p')}
          >
            <span className="text-sm">{t('editor.paragraph')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="editor-block-style-h1"
            onSelect={() => applyBlockStyle('h1')}
          >
            <span className="text-base font-bold">{t('editor.heading1')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="editor-block-style-h2"
            onSelect={() => applyBlockStyle('h2')}
          >
            <span className="text-sm font-semibold">{t('editor.heading2')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="editor-block-style-h3"
            onSelect={() => applyBlockStyle('h3')}
          >
            <span className="text-xs font-semibold">{t('editor.heading3')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span
        aria-hidden="true"
        className="mx-1 h-4 w-px shrink-0 bg-border"
      />

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={t('editor.bold')}
          aria-pressed={toolbarState.isBold}
          data-testid="editor-toolbar-bold"
          onClick={() => toggleMark(KEYS.bold)}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.bold')}
          variant={toolbarState.isBold ? 'secondary' : 'ghost'}
        >
          <Bold className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.italic')}
          aria-pressed={toolbarState.isItalic}
          data-testid="editor-toolbar-italic"
          onClick={() => toggleMark(KEYS.italic)}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.italic')}
          variant={toolbarState.isItalic ? 'secondary' : 'ghost'}
        >
          <Italic className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.strikethrough')}
          aria-pressed={toolbarState.isStrikethrough}
          data-testid="editor-toolbar-strikethrough"
          onClick={() => toggleMark(KEYS.strikethrough)}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.strikethrough')}
          variant={toolbarState.isStrikethrough ? 'secondary' : 'ghost'}
        >
          <Strikethrough className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.inlineCode')}
          aria-pressed={toolbarState.isCode}
          data-testid="editor-toolbar-inline-code"
          onClick={() => toggleMark(KEYS.code)}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.inlineCode')}
          variant={toolbarState.isCode ? 'secondary' : 'ghost'}
        >
          <Code className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <span
        aria-hidden="true"
        className="mx-1 h-4 w-px shrink-0 bg-border"
      />

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={t('editor.bulletList')}
          aria-pressed={toolbarState.isBulletList}
          data-testid="editor-toolbar-bullet-list"
          onClick={() => {
            toggleList(editor, { listStyleType: ListStyleType.Disc });
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.bulletList')}
          variant={toolbarState.isBulletList ? 'secondary' : 'ghost'}
        >
          <List className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.numberedList')}
          aria-pressed={toolbarState.isNumberedList}
          data-testid="editor-toolbar-numbered-list"
          onClick={() => {
            toggleList(editor, { listStyleType: ListStyleType.Decimal });
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.numberedList')}
          variant={toolbarState.isNumberedList ? 'secondary' : 'ghost'}
        >
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.blockquote')}
          aria-pressed={toolbarState.isBlockquote}
          data-testid="editor-toolbar-blockquote"
          onClick={() => {
            editor.tf.toggleBlock(editor.getType(KEYS.blockquote));
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.blockquote')}
          variant={toolbarState.isBlockquote ? 'secondary' : 'ghost'}
        >
          <Quote className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.codeBlock')}
          aria-pressed={toolbarState.isCodeBlock}
          data-testid="editor-toolbar-code-block"
          onClick={() => {
            toggleCodeBlock(editor);
            editor.tf.focus();
          }}
          onMouseDown={preventEditorBlur}
          size="icon-sm"
          title={t('editor.codeBlock')}
          variant={toolbarState.isCodeBlock ? 'secondary' : 'ghost'}
        >
          <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <span
        aria-hidden="true"
        className="mx-1 h-4 w-px shrink-0 bg-border"
      />

      <Popover open={linkPopoverOpen} onOpenChange={handleLinkOpenChange}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t('editor.link')}
            aria-pressed={toolbarState.isLink}
            className={cn(toolbarState.isLink && 'text-brand')}
            data-testid="editor-toolbar-link"
            onMouseDown={preventEditorBlur}
            size="icon-sm"
            title={t('editor.link')}
            variant={toolbarState.isLink ? 'secondary' : 'ghost'}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <form className="space-y-2.5" onSubmit={handleLinkSubmit}>
            <div className="space-y-1">
              <Label className="text-xs font-medium" htmlFor={linkInputId}>
                {t('editor.linkUrlLabel')}
              </Label>
              <Input
                autoFocus
                className="h-8 text-xs"
                data-testid="editor-link-url-input"
                id={linkInputId}
                onChange={(event) => {
                  setLinkUrl(event.target.value);
                  if (linkError) setLinkError(null);
                }}
                placeholder={t('editor.linkUrlPlaceholder')}
                type="text"
                value={linkUrl}
              />
            </div>
            {linkError ? (
              <p className="text-xs text-destructive" role="alert">
                {linkError}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-1.5">
              {toolbarState.isLink ? (
                <Button
                  data-testid="editor-link-remove"
                  onClick={handleLinkRemove}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Unlink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {t('editor.linkRemove')}
                </Button>
              ) : null}
              <Button
                data-testid="editor-link-apply"
                size="sm"
                type="submit"
              >
                {t('editor.linkApply')}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
