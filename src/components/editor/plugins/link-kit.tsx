'use client';

import { LinkPlugin } from '@platejs/link/react';

import { LinkElement } from '@/components/ui/link-node';

export const LinkKit = [
  LinkPlugin.configure({
    node: { component: LinkElement },
    options: {
      defaultLinkAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    },
  }),
];
