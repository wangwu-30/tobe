import {
  BaseBlockquotePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseH4Plugin,
  BaseH5Plugin,
  BaseH6Plugin,
  BaseHorizontalRulePlugin,
} from '@platejs/basic-nodes';
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
} from '@platejs/code-block';
import { BaseIndentPlugin } from '@platejs/indent';
import { BaseLinkPlugin } from '@platejs/link';
import { BaseListPlugin } from '@platejs/list';
import { common, createLowlight } from 'lowlight';
import { BaseParagraphPlugin, KEYS, createSlatePlugin } from 'platejs';

import { BlockquoteElementStatic } from '@/components/ui/blockquote-node-static';
import {
  CodeBlockElementStatic,
  CodeLineElementStatic,
  CodeSyntaxLeafStatic,
} from '@/components/ui/code-block-node-static';
import {
  H1ElementStatic,
  H2ElementStatic,
  H3ElementStatic,
  H4ElementStatic,
  H5ElementStatic,
  H6ElementStatic,
} from '@/components/ui/heading-node-static';
import { HrElementStatic } from '@/components/ui/hr-node-static';
import { LinkElementStatic } from '@/components/ui/link-node-static';
import {
  BulletedListElementStatic,
  ListItemElementStatic,
  NumberedListElementStatic,
} from '@/components/ui/list-node-static';
import { ParagraphElementStatic } from '@/components/ui/paragraph-node-static';

const lowlight = createLowlight(common);

const LIST_TARGET_PLUGINS = [
  KEYS.p,
  KEYS.h1,
  KEYS.h2,
  KEYS.h3,
  KEYS.h4,
  KEYS.h5,
  KEYS.h6,
  KEYS.blockquote,
];

const BaseBulletedListCompatPlugin = createSlatePlugin({
  key: 'ul',
  node: { isElement: true },
}).withComponent(BulletedListElementStatic);

const BaseNumberedListCompatPlugin = createSlatePlugin({
  key: 'ol',
  node: { isElement: true },
}).withComponent(NumberedListElementStatic);

const BaseListItemCompatPlugin = createSlatePlugin({
  key: 'li',
  node: { isElement: true },
}).withComponent(ListItemElementStatic);

export const BaseBasicBlocksKit = [
  BaseParagraphPlugin.withComponent(ParagraphElementStatic),
  BaseH1Plugin.withComponent(H1ElementStatic),
  BaseH2Plugin.withComponent(H2ElementStatic),
  BaseH3Plugin.withComponent(H3ElementStatic),
  BaseH4Plugin.withComponent(H4ElementStatic),
  BaseH5Plugin.withComponent(H5ElementStatic),
  BaseH6Plugin.withComponent(H6ElementStatic),
  BaseBlockquotePlugin.withComponent(BlockquoteElementStatic),
  BaseHorizontalRulePlugin.withComponent(HrElementStatic),
  BaseCodeBlockPlugin.configure({
    node: { component: CodeBlockElementStatic },
    options: { lowlight },
  }),
  BaseCodeLinePlugin.withComponent(CodeLineElementStatic),
  BaseCodeSyntaxPlugin.withComponent(CodeSyntaxLeafStatic),
  BaseLinkPlugin.withComponent(LinkElementStatic),
  BaseIndentPlugin.configure({
    inject: { targetPlugins: LIST_TARGET_PLUGINS },
    options: { indentMax: 6, offset: 24, unit: 'px' },
  }),
  BaseListPlugin.configure({
    inject: { targetPlugins: LIST_TARGET_PLUGINS },
  }),
  BaseBulletedListCompatPlugin,
  BaseNumberedListCompatPlugin,
  BaseListItemCompatPlugin,
];
