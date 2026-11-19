'use client';

import { ListStyleType, toggleList } from '@platejs/list';
import { KEYS, PathApi, type TElement } from 'platejs';
import { type PlateEditor, createPlatePlugin } from 'platejs/react';

import { normalizeCodeBlockLanguage } from '@/lib/ai/serializer';

const HEADING_KEYS = [
  KEYS.h1,
  KEYS.h2,
  KEYS.h3,
  KEYS.h4,
  KEYS.h5,
  KEYS.h6,
] as const;

function convertParagraphToCodeBlock(
  editor: PlateEditor,
  blockPath: number[],
  lang: string
) {
  const codeBlockType = editor.getType(KEYS.codeBlock);
  const codeLineType = editor.getType(KEYS.codeLine);
  const normalizedLang = normalizeCodeBlockLanguage(lang);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: blockPath });
    editor.tf.insertNodes(
      {
        type: codeBlockType,
        ...(normalizedLang ? { lang: normalizedLang } : {}),
        children: [{ type: codeLineType, children: [{ text: '' }] }],
      } as TElement,
      { at: blockPath }
    );
    editor.tf.select({
      anchor: { offset: 0, path: [...blockPath, 0, 0] },
      focus: { offset: 0, path: [...blockPath, 0, 0] },
    });
  });
}

export const MarkdownShortcutsPlugin = createPlatePlugin({
  key: 'markdown_shortcuts',
}).overrideEditor(({ editor, tf: { insertBreak, insertText } }) => ({
  transforms: {
    insertBreak() {
      if (
        !editor.dom.composing &&
        editor.selection &&
        editor.api.isCollapsed() &&
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } })
      ) {
        const blockEntry = editor.api.block<TElement>();
        if (blockEntry) {
          const [block, blockPath] = blockEntry;
          const isPlainParagraph =
            block.type === editor.getType(KEYS.p) && !block.listStyleType;
          if (isPlainParagraph) {
            const fullText = editor.api.string(blockPath);
            const codeFenceMatch = fullText.match(/^```([a-zA-Z0-9_-]*)$/);
            if (codeFenceMatch) {
              convertParagraphToCodeBlock(
                editor,
                blockPath,
                codeFenceMatch[1] || ''
              );
              return;
            }
          }
        }
      }

      insertBreak();
    },

    insertText(text, options) {
      if (
        text === ' ' &&
        !editor.dom.composing &&
        editor.selection &&
        editor.api.isCollapsed() &&
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } })
      ) {
        const blockEntry = editor.api.block<TElement>();
        if (blockEntry) {
          const [block, blockPath] = blockEntry;
          const isPlainParagraph =
            block.type === editor.getType(KEYS.p) && !block.listStyleType;
          const blockStart = editor.api.start(blockPath);

          if (isPlainParagraph && blockStart) {
            const beforeRange = {
              anchor: blockStart,
              focus: editor.selection.anchor,
            };
            const beforeText = editor.api.string(beforeRange);

            const headingMatch = beforeText.match(/^(#{1,6})$/);
            if (headingMatch) {
              const headingKey = HEADING_KEYS[headingMatch[1].length - 1];
              editor.tf.delete({ at: beforeRange });
              editor.tf.setNodes(
                { type: editor.getType(headingKey) },
                { at: blockPath }
              );
              return;
            }

            if (/^[-*+]$/.test(beforeText)) {
              editor.tf.delete({ at: beforeRange });
              toggleList(editor, { listStyleType: ListStyleType.Disc });
              return;
            }

            if (/^1\.$/.test(beforeText)) {
              editor.tf.delete({ at: beforeRange });
              toggleList(editor, { listStyleType: ListStyleType.Decimal });
              return;
            }

            if (beforeText === '>') {
              editor.tf.delete({ at: beforeRange });
              editor.tf.setNodes(
                { type: editor.getType(KEYS.blockquote) },
                { at: blockPath }
              );
              return;
            }

            if (/^(?:---|___|\*\*\*)$/.test(beforeText)) {
              const nextPath = PathApi.next(blockPath);
              editor.tf.withoutNormalizing(() => {
                editor.tf.delete({ at: beforeRange });
                editor.tf.setNodes(
                  { type: editor.getType(KEYS.hr) },
                  { at: blockPath }
                );
                editor.tf.insertNodes(
                  {
                    type: editor.getType(KEYS.p),
                    children: [{ text: '' }],
                  } as TElement,
                  { at: nextPath, select: true }
                );
              });
              return;
            }

            const codeFenceMatch = beforeText.match(/^```([a-zA-Z0-9_-]*)$/);
            if (codeFenceMatch) {
              convertParagraphToCodeBlock(
                editor,
                blockPath,
                codeFenceMatch[1] || ''
              );
              return;
            }
          }
        }
      }

      insertText(text, options);
    },
  },
}));

export const MarkdownShortcutsKit = [MarkdownShortcutsPlugin];
