'use client';

import { IndentPlugin } from '@platejs/indent/react';
import { ListPlugin } from '@platejs/list/react';
import { KEYS } from 'platejs';
import { createPlatePlugin } from 'platejs/react';

import {
  BulletedListElement,
  ListItemElement,
  NumberedListElement,
} from '@/components/ui/list-node';

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

const BulletedListCompatPlugin = createPlatePlugin({
  key: 'ul',
  node: { isElement: true },
}).withComponent(BulletedListElement);

const NumberedListCompatPlugin = createPlatePlugin({
  key: 'ol',
  node: { isElement: true },
}).withComponent(NumberedListElement);

const ListItemCompatPlugin = createPlatePlugin({
  key: 'li',
  node: { isElement: true },
}).withComponent(ListItemElement);

export const ListKit = [
  IndentPlugin.configure({
    inject: {
      targetPlugins: LIST_TARGET_PLUGINS,
    },
    options: {
      indentMax: 6,
      offset: 24,
      unit: 'px',
    },
  }),
  ListPlugin.configure({
    inject: {
      targetPlugins: LIST_TARGET_PLUGINS,
    },
  }),
  BulletedListCompatPlugin,
  NumberedListCompatPlugin,
  ListItemCompatPlugin,
];
