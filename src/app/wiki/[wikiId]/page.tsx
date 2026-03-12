import { redirect } from 'next/navigation';

export default async function WikiRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ wikiId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { wikiId } = await params;
  const nextSearchParams = await searchParams;
  const query = new URLSearchParams();

  Object.entries(nextSearchParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      query.set(key, value);
      return;
    }

    value?.forEach((entry) => query.append(key, entry));
  });

  redirect(`/workspace/${wikiId}${query.size > 0 ? `?${query.toString()}` : ''}`);
}
