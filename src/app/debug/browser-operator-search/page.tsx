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

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-300/80">
            Browser Operator Search Debug
          </p>
          <h1 className="text-3xl font-semibold">Mock Search Surface</h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-300">
            This page mimics an HTML search engine result surface so the Browser Operator
            provider can be verified end-to-end without depending on external websites.
          </p>
        </header>

        <form className="rounded-2xl border border-white/10 bg-white/5 p-4" method="GET">
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-400" htmlFor="q">
            Query
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-zinc-900 px-4 text-sm text-zinc-50 outline-none ring-0 placeholder:text-zinc-500"
              defaultValue={query}
              id="q"
              name="q"
              placeholder="browser operator runtime search"
              type="text"
            />
            <button
              className="min-h-11 rounded-xl bg-emerald-400 px-5 text-sm font-medium text-zinc-950"
              type="submit"
            >
              Search
            </button>
          </div>
        </form>

        {query ? (
          <section
            className="rounded-3xl border border-white/10 bg-zinc-900/70 p-6"
            data-browser-operator-role="results"
          >
            <div className="mb-4 text-xs uppercase tracking-[0.2em] text-zinc-400">
              Results for &quot;{query}&quot;
            </div>
            <ol className="results space-y-5">
              {results.map((result) => (
                <li
                  key={result.url}
                  className="result rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  data-browser-operator-result="item"
                >
                  <a
                    className="result__a text-lg font-medium text-emerald-300 underline decoration-emerald-400/40 underline-offset-4"
                    data-browser-operator-role="title-link"
                    href={result.url}
                  >
                    {result.title}
                  </a>
                  <div
                    className="result__url mt-2 text-xs uppercase tracking-[0.18em] text-zinc-500"
                    data-browser-operator-role="source"
                  >
                    {result.source}
                  </div>
                  <p
                    className="result__snippet mt-3 text-sm leading-6 text-zinc-300"
                    data-browser-operator-role="snippet"
                  >
                    {result.snippet}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-sm text-zinc-400">
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
