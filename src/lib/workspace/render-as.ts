import { contentHasOnlySlidePageBlocks } from '@/lib/workspace/slide-pages';
import type { DeliverableType, LegacyDeliverableType, RenderAs } from '@/types';

export function deriveRenderAs(params: {
  content: string;
  deliverableType: DeliverableType;
  storedDeliverableType: LegacyDeliverableType | null;
}): RenderAs {
  if (params.deliverableType === 'web' || params.storedDeliverableType === 'web') {
    return 'web';
  }

  if (
    params.storedDeliverableType === 'slides' ||
    contentHasOnlySlidePageBlocks(params.content)
  ) {
    return 'slides';
  }

  return 'document';
}
