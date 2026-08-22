type SearchPageProps = {
  searchParams?: Promise<{
    q?: string;
  }>;
};

type MockSearchResult = {
  snippet: string;
  source: string;
  title: string;
  url: string;
};

export default async function BrowserOperatorSearchDebugPage({
  searchParams,
}: SearchPageProps) {
  const resolvedParams = (await searchParams) || {};
  const query = (resolvedParams.q || '').trim();
  const results = buildMockSearchResults(query);
  const resultSummary = query
    ? `${results.length} results for ${query}`
    : 'Enter a query to render deterministic mock search results.';

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-50 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-300/80">
            Browser Operator Search Debug
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Mock Search Surface</h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-300">
            This page mimics an HTML search engine result surface so the Browser Operator
            provider can be verified end-to-end without depending on external websites.
          </p>
        </header>

        <form
          aria-label="Search mock browser results"
          className="rounded-2xl border border-white/10 bg-white/5 p-4"
          method="GET"
          role="search"
        >
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-400" htmlFor="q">
            Query
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              autoComplete="off"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-900 px-4 text-base text-zinc-50 outline-none transition-[border-color,box-shadow] placeholder:text-zinc-500 focus-visible:border-emerald-300 focus-visible:ring-[3px] focus-visible:ring-emerald-300/30 motion-reduce:transition-none sm:text-sm"
              defaultValue={query}
              id="q"
              name="q"
              placeholder="browser operator runtime search"
              type="text"
            />
            <button
              className="min-h-11 rounded-xl bg-emerald-400 px-5 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 motion-reduce:transition-none"
              type="submit"
            >
              Search
            </button>
          </div>
        </form>

        {query ? (
          <section
            aria-label={resultSummary}
            className="min-w-0 rounded-3xl border border-white/10 bg-zinc-900/70 p-4 sm:p-6"
            data-browser-operator-role="results"
          >
            <div
              className="mb-4 break-words text-xs uppercase tracking-[0.2em] text-zinc-400 [overflow-wrap:anywhere]"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              Results for &quot;{query}&quot;
            </div>
            <ol className="results space-y-5">
              {results.map((result) => (
                <li
                  key={result.url}
                  className="result min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  data-browser-operator-result="item"
                >
                  <a
                    className="result__a break-words rounded-sm text-lg font-medium text-emerald-300 underline decoration-emerald-400/40 underline-offset-4 outline-none transition-colors hover:text-emerald-200 focus-visible:ring-[3px] focus-visible:ring-emerald-300/40 motion-reduce:transition-none [overflow-wrap:anywhere]"
                    data-browser-operator-role="title-link"
                    href={result.url}
                  >
                    {result.title}
                  </a>
                  <div
                    className="result__url mt-2 break-words text-xs uppercase tracking-[0.18em] text-zinc-500 [overflow-wrap:anywhere]"
                    data-browser-operator-role="source"
                  >
                    {result.source}
                  </div>
                  <p
                    className="result__snippet mt-3 break-words text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]"
                    data-browser-operator-role="snippet"
                  >
                    {result.snippet}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <section
            className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400 sm:p-8"
            aria-live="polite"
          >
            Enter a query to render deterministic mock search results.
          </section>
        )}
      </div>
    </main>
  );
}

function buildMockSearchResults(query: string): MockSearchResult[] {
  if (!query) {
    return [];
  }

  const encodedQuery = encodeURIComponent(query);

  return [
    {
      snippet: `An implementation brief showing how ${query} can be routed through a shared browser operator instead of a provider-only API path.`,
      source: 'docs.example.test',
      title: `${query} architecture brief`,
      url: `https://docs.example.test/search?q=${encodedQuery}`,
    },
    {
      snippet: `A practical walkthrough for opening a page, waiting for results, extracting cards, and sending structured findings back into the runtime loop.`,
      source: 'labs.example.test',
      title: `${query} runtime walkthrough`,
      url: `https://labs.example.test/runtime?q=${encodedQuery}`,
    },
    {
      snippet: `Reference notes comparing browser-driven lookup against plain API search, with tradeoffs around observability and recovery.`,
      source: 'notes.example.test',
      title: `${query} comparison notes`,
      url: `https://notes.example.test/compare?q=${encodedQuery}`,
    },
  ];
}
