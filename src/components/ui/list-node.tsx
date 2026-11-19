'use client';

import * as React from 'react';

import type { PlateElementProps } from 'platejs/react';

import { PlateElement } from 'platejs/react';

export function BulletedListElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="ul"
      className="my-1 ml-6 list-disc space-y-0.5 marker:text-muted-foreground"
      {...props}
    >
      {props.children}
    </PlateElement>
  );
}

export function NumberedListElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="ol"
      className="my-1 ml-6 list-decimal space-y-0.5 marker:text-muted-foreground"
      {...props}
    >
      {props.children}
    </PlateElement>
  );
}

export function ListItemElement(props: PlateElementProps) {
  return (
    <PlateElement as="li" className="leading-relaxed [&>p]:py-0.5" {...props}>
      {props.children}
    </PlateElement>
  );
}
