import {
  DEFAULT_VOLCENGINE_RESPONSES_ENDPOINT,
  DEFAULT_VOLCENGINE_WEB_SEARCH_MODEL,
  SearchProviderError,
  type SearchCitation,
  type SearchHit,
  type SearchProvider,
  type SearchProviderRuntimeConfig,
  type SearchQuery,
  type SearchResult,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';

type VolcengineResponsesRequest = {
  model: string;
  input: string;
  stream: false;
  tools: Array<{ type: 'web_search' }>;
};

export class VolcengineWebSearchProvider implements SearchProvider {
  readonly id = VOLCENGINE_WEB_SEARCH_PROVIDER_ID;
  readonly label = 'Volcengine Web Search';
  readonly description = 'ARK Responses API with the web_search tool';

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;

  constructor(config: SearchProviderRuntimeConfig) {
    if (!config.apiKey) {
      throw new SearchProviderError(
        'Missing API key for search provider: volcengine-web-search',
        400
      );
    }

    this.apiKey = config.apiKey;
    this.endpoint = normalizeEndpoint(config.endpoint || DEFAULT_VOLCENGINE_RESPONSES_ENDPOINT);
    this.model = config.model || DEFAULT_VOLCENGINE_WEB_SEARCH_MODEL;
  }

  async search(input: SearchQuery): Promise<SearchResult> {
    const requestBody: VolcengineResponsesRequest = {
      model: this.model,
      input: input.query,
      stream: false,
      tools: [{ type: 'web_search' }],
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      throw new SearchProviderError(
        getErrorMessage(payload, response.status),
        response.status,
        payload
      );
    }

    return normalizeSearchResult(payload, input, this.id);
  }
}

function normalizeSearchResult(
  payload: unknown,
  input: SearchQuery,
  providerId: string
): SearchResult {
  const answer = extractAnswer(payload);
  const citations = buildCitations(payload);
  const results = buildResults(payload, citations, input.maxResults);

  return {
    providerId,
    query: input.query,
    answer,
    results,
    citations,
    raw: payload,
  };
}

function extractAnswer(payload: unknown) {
  const root = asRecord(payload);
  const outputText = asString(root.output_text);
  if (outputText) {
    return outputText;
  }

  const output = asArray(root.output);
  const parts: string[] = [];

  for (const item of output) {
    const itemRecord = asRecord(item);
    const content = asArray(itemRecord.content);

    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem);
      const type = asString(contentRecord.type);

      if (type && !type.includes('text')) {
        continue;
      }

      const text = asString(contentRecord.text);
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join('\n\n').trim();
}

function buildCitations(payload: unknown): SearchCitation[] {
  const annotations = extractAnnotations(payload);
  const nestedCandidates = collectCitationCandidates(payload);
  const items = [...annotations, ...nestedCandidates];
  const deduped = new Map<string, SearchCitation>();

  for (const item of items) {
    if (!item.url) {
      continue;
    }

    const key = [
      item.url,
      item.title || '',
      item.startIndex ?? '',
      item.endIndex ?? '',
      item.snippet || '',
    ].join('::');

    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].map((item, index) => ({
    ...item,
    id: `citation-${index + 1}`,
  }));
}

function buildResults(
  payload: unknown,
  citations: SearchCitation[],
  maxResults?: number
): SearchHit[] {
  const collected = new Map<string, SearchHit>();

  walk(payload, (value) => {
    const hit = toSearchHit(value);
    if (!hit?.url) {
      return;
    }

    if (!collected.has(hit.url)) {
      collected.set(hit.url, hit);
    }
  });

  if (!collected.size) {
    for (const citation of citations) {
      collected.set(citation.url, {
        title: citation.title,
        url: citation.url,
        snippet: citation.snippet,
        source: citation.source,
        publishedAt: citation.publishedAt,
      });
    }
  }

  const results = [...collected.values()];
  if (!maxResults || maxResults <= 0) {
    return results;
  }

  return results.slice(0, maxResults);
}

function extractAnnotations(payload: unknown): SearchCitation[] {
  const annotations: SearchCitation[] = [];

  walk(payload, (value) => {
    const record = asRecord(value);
    const type = asString(record.type);

    if (type !== 'url_citation') {
      return;
    }

    const url = asString(record.url);
    if (!url) {
      return;
    }

    annotations.push({
      id: '',
      title: pickFirstString(record.title, record.text, record.site_name) || null,
      url,
      snippet: pickFirstString(record.snippet, record.content, record.text) || null,
      source: pickFirstString(record.site_name, record.source, deriveSourceFromUrl(url)) || null,
      publishedAt:
        pickFirstString(
          record.published_at,
          record.publish_time,
          record.pubdate,
          record.date
        ) || null,
      startIndex: asNumber(record.start_index),
      endIndex: asNumber(record.end_index),
    });
  });

  return annotations;
}

function collectCitationCandidates(payload: unknown): SearchCitation[] {
  const citations: SearchCitation[] = [];

  walk(payload, (value) => {
    const citation = toSearchCitation(value);
    if (citation) {
      citations.push(citation);
    }
  });

  return citations;
}

function toSearchCitation(value: unknown): SearchCitation | null {
  const record = asRecord(value);
  const url = pickFirstString(record.url, record.link);
  if (!url) {
    return null;
  }

  const type = asString(record.type);
  const hasCitationShape =
    type === 'url_citation' ||
    Boolean(
      pickFirstString(
        record.title,
        record.content,
        record.snippet,
        record.site_name,
        record.source,
        record.text
      ) || asNumber(record.start_index) !== null || asNumber(record.end_index) !== null
    );

  if (!hasCitationShape) {
    return null;
  }

  return {
    id: '',
    title: pickFirstString(record.title, record.text) || null,
    url,
    snippet: pickFirstString(record.snippet, record.content, record.summary, record.text) || null,
    source: pickFirstString(record.site_name, record.source, deriveSourceFromUrl(url)) || null,
    publishedAt:
      pickFirstString(
        record.published_at,
        record.publish_time,
        record.pubdate,
        record.published_time,
        record.date
      ) || null,
    startIndex: asNumber(record.start_index),
    endIndex: asNumber(record.end_index),
  };
}

function toSearchHit(value: unknown): SearchHit | null {
  const record = asRecord(value);
  const url = pickFirstString(record.url, record.link);
  if (!url) {
    return null;
  }

  const title = pickFirstString(record.title, record.name);
  const snippet = pickFirstString(
    record.content,
    record.snippet,
    record.summary,
    record.description
  );
  const source = pickFirstString(record.site_name, record.source, deriveSourceFromUrl(url));
  const publishedAt =
    pickFirstString(
      record.published_at,
      record.publish_time,
      record.pubdate,
      record.published_time,
      record.date
    ) || null;

  if (!title && !snippet && !source) {
    return null;
  }

  return {
    title: title || null,
    url,
    snippet: snippet || null,
    source: source || null,
    publishedAt,
  };
}

function normalizeEndpoint(endpoint: string) {
  const normalized = endpoint.replace(/\/+$/, '');

  if (normalized.endsWith('/responses')) {
    return normalized;
  }

  if (normalized.endsWith('/api/v3')) {
    return `${normalized}/responses`;
  }

  if (normalized.endsWith('/api')) {
    return `${normalized}/v3/responses`;
  }

  return `${normalized}/api/v3/responses`;
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function getErrorMessage(payload: unknown, status: number) {
  const record = asRecord(payload);
  const error = asRecord(record.error);

  return (
    asString(error.message) ||
    asString(record.message) ||
    asString(record.error) ||
    `Search provider request failed with status ${status}.`
  );
}

function walk(value: unknown, visit: (value: unknown) => void) {
  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    walk(child, visit);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function deriveSourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
