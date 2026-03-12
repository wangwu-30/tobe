'use client';

import {
  useParams as useNextParams,
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';

export function useAppRouter() {
  return useNextRouter();
}

export function useAppPathname() {
  return useNextPathname();
}

export function useAppParams<T extends Record<string, string | string[]>>() {
  return useNextParams<T>();
}

export function useAppSearchParams() {
  return useNextSearchParams();
}
