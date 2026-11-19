import * as React from 'react';

import type { SlateElementProps } from 'platejs/static';

import { SlateElement } from 'platejs/static';

export function BulletedListElementStatic(props: SlateElementProps) {
  return (
    <SlateElement
      as="ul"
      className="my-1 ml-6 list-disc space-y-0.5 marker:text-muted-foreground"
      {...props}
    >
      {props.children}
    </SlateElement>
  );
}

export function NumberedListElementStatic(props: SlateElementProps) {
  return (
    <SlateElement
      as="ol"
      className="my-1 ml-6 list-decimal space-y-0.5 marker:text-muted-foreground"
      {...props}
    >
      {props.children}
    </SlateElement>
  );
}

export function ListItemElementStatic(props: SlateElementProps) {
  return (
    <SlateElement as="li" className="leading-relaxed [&>p]:py-0.5" {...props}>
      {props.children}
    </SlateElement>
  );
}
