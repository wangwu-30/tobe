'use client';

import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

export function useAppRouter() {
  const navigate = useNavigate();
  return {
    back: () => navigate(-1),
    forward: () => navigate(1),
    prefetch: async () => undefined,
    push: (href: string) => navigate(href),
    refresh: () => window.location.reload(),
    replace: (href: string) => navigate(href, { replace: true }),
  };
}

export function useAppPathname() {
  return useLocation().pathname;
}

export function useAppParams<T extends Record<string, string | string[]>>() {
  return useParams() as T;
}

export function useAppSearchParams() {
  return useSearchParams()[0];
}
