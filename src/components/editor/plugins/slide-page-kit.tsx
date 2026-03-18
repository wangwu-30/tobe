'use client';

import { createPlatePlugin } from 'platejs/react';

import { SlidePageElement } from '@/components/ui/slide-page-node';

export const slidePagePlugin = createPlatePlugin({
  key: 'slide_page',
  node: {
    isElement: true,
  },
}).withComponent(SlidePageElement);

export const SlidePageKit = [slidePagePlugin];
