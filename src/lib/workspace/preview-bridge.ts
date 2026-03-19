export const WEB_PREVIEW_BRIDGE_CHANNEL = 'chengxing-web-preview-bridge';

export type WebPreviewBoundingRectData = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type WebPreviewAnchorPayloadData = {
  boundingRect: WebPreviewBoundingRectData | null;
  cssSelector: string | null;
  domContext: string | null;
  excerpt: string;
};

export type WebPreviewBridgeMessage =
  | {
      channel: typeof WEB_PREVIEW_BRIDGE_CHANNEL;
      type: 'ready';
    }
  | {
      channel: typeof WEB_PREVIEW_BRIDGE_CHANNEL;
      type: 'selection';
      payload: WebPreviewAnchorPayloadData | null;
    }
  | {
      channel: typeof WEB_PREVIEW_BRIDGE_CHANNEL;
      type: 'element';
      payload: WebPreviewAnchorPayloadData | null;
    }
  | {
      channel: typeof WEB_PREVIEW_BRIDGE_CHANNEL;
      type: 'focus';
      payload: {
        cssSelector?: string | null;
        domContext?: string | null;
        excerpt?: string | null;
        selector?: string | null;
      };
    };

export function buildPreviewBridgeUrl(params: {
  pathSegments?: string[];
  runId: string;
  workspaceId: string;
}) {
  const pathSuffix =
    params.pathSegments && params.pathSegments.length > 0
      ? `/${params.pathSegments.map(encodeURIComponent).join('/')}`
      : '';
  return `/api/workspaces/${encodeURIComponent(params.workspaceId)}/preview/bridge/${encodeURIComponent(params.runId)}${pathSuffix}`;
}

export function injectPreviewBridgeIntoHtml(html: string) {
  const scriptTag = `<script>${buildPreviewBridgeScript()}</script>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${scriptTag}</body>`);
  }

  if (html.includes('</head>')) {
    return html.replace('</head>', `${scriptTag}</head>`);
  }

  return `${html}\n${scriptTag}`;
}

function buildPreviewBridgeScript() {
  return `
(() => {
  const CHANNEL = ${JSON.stringify(WEB_PREVIEW_BRIDGE_CHANNEL)};
  const HIGHLIGHT_ATTR = 'data-chengxing-preview-highlight';
  let clearHighlightTimer = null;

  const normalizeText = (value) =>
    String(value || '').replace(/\\s+/g, ' ').trim();

  const toRect = (rect) => {
    if (!rect) {
      return null;
    }
    return {
      x: Number(rect.left || 0),
      y: Number(rect.top || 0),
      width: Number(rect.width || 0),
      height: Number(rect.height || 0),
    };
  };

  const post = (type, payload) => {
    window.parent.postMessage({ channel: CHANNEL, type, payload }, '*');
  };

  const buildSelector = (element) => {
    if (!element) {
      return null;
    }

    if (element.id) {
      return '#' + element.id;
    }

    const segments = [];
    let current = element;
    while (current && current !== document.body && segments.length < 5) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        segments.unshift(tag);
        break;
      }

      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === current.tagName
      );
      const index = siblings.indexOf(current) + 1;
      segments.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      current = parent;
    }

    return segments.join(' > ') || null;
  };

  const buildDomContext = (element) => {
    if (!element) {
      return null;
    }

    const parent = element.parentElement;
    const nodes = parent ? Array.from(parent.children).slice(0, 6) : [element];
    const summary = nodes
      .map((node) => normalizeText(node.textContent).slice(0, 120))
      .filter(Boolean)
      .join(' | ');

    return summary || normalizeText(element.textContent).slice(0, 240) || null;
  };

  const buildPayloadFromElement = (element, rect, excerptOverride) => {
    if (!element) {
      return null;
    }

    const excerpt = normalizeText(excerptOverride || element.textContent).slice(0, 240);
    if (!excerpt) {
      return null;
    }

    return {
      excerpt,
      cssSelector: buildSelector(element),
      domContext: buildDomContext(element),
      boundingRect: toRect(rect || element.getBoundingClientRect()),
    };
  };

  const getElementFromNode = (node) => {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return node;
    }

    return node.parentElement || null;
  };

  const readSelectionPayload = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const excerpt = normalizeText(selection.toString()).slice(0, 240);
    if (!excerpt) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }

    return buildPayloadFromElement(getElementFromNode(range.commonAncestorContainer), rect, excerpt);
  };

  const findElementByExcerpt = (excerpt) => {
    const normalizedExcerpt = normalizeText(excerpt);
    if (!normalizedExcerpt) {
      return null;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current) {
      const elementText = normalizeText(current.textContent);
      if (elementText && elementText.includes(normalizedExcerpt)) {
        return current;
      }
      current = walker.nextNode();
    }

    return null;
  };

  const findElementByDomContext = (domContext) => {
    const normalizedContext = normalizeText(domContext);
    if (!normalizedContext) {
      return null;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current) {
      const elementText = normalizeText(current.textContent);
      if (elementText && normalizedContext.includes(elementText.slice(0, 80))) {
        return current;
      }
      current = walker.nextNode();
    }

    return null;
  };

  const clearHighlight = () => {
    const highlighted = document.querySelector('[' + HIGHLIGHT_ATTR + '="true"]');
    if (!highlighted) {
      return;
    }

    highlighted.removeAttribute(HIGHLIGHT_ATTR);
    highlighted.style.outline = '';
    highlighted.style.outlineOffset = '';
    highlighted.style.scrollMarginTop = '';
    highlighted.style.transition = '';
  };

  const highlightElement = (element) => {
    if (!element) {
      return;
    }

    clearHighlight();
    element.setAttribute(HIGHLIGHT_ATTR, 'true');
    element.style.outline = '3px solid rgba(245, 158, 11, 0.95)';
    element.style.outlineOffset = '4px';
    element.style.scrollMarginTop = '96px';
    element.style.transition = 'outline-color 180ms ease';
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    if (clearHighlightTimer) {
      window.clearTimeout(clearHighlightTimer);
    }

    clearHighlightTimer = window.setTimeout(() => {
      clearHighlight();
      clearHighlightTimer = null;
    }, 2200);
  };

  const publishSelection = () => {
    post('selection', readSelectionPayload());
  };

  document.addEventListener('selectionchange', publishSelection);
  document.addEventListener('mouseup', () => {
    window.setTimeout(publishSelection, 0);
  });
  document.addEventListener(
    'click',
    (event) => {
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && normalizeText(selection.toString())) {
          return;
        }

        const target = event.target instanceof Element ? event.target.closest('*') : null;
        const payload = buildPayloadFromElement(target, target ? target.getBoundingClientRect() : null);
        if (payload) {
          post('element', payload);
        }
      }, 0);
    },
    true
  );

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.type !== 'focus') {
      return;
    }

    const payload = data.payload || {};
    const element =
      (payload.cssSelector || payload.selector
        ? (() => {
            try {
              return document.querySelector(payload.cssSelector || payload.selector);
            } catch {
              return null;
            }
          })()
        : null) ||
      findElementByExcerpt(payload.excerpt) ||
      findElementByDomContext(payload.domContext);

    if (element) {
      highlightElement(element);
    }
  });

  post('ready');
})();
  `.trim();
}
