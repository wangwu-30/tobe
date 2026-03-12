'use client';

import {
  DAO_DEVICE_HEADER,
  LOCAL_DEVICE_ID,
} from '@/lib/platform/defaults';

const DEVICE_STORAGE_KEY = 'dao-device-id';

export function getClientDeviceId() {
  if (typeof window === 'undefined') {
    return LOCAL_DEVICE_ID;
  }

  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${LOCAL_DEVICE_ID}-${Date.now()}`;

  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

export function buildClientPlatformHeaders(headers?: HeadersInit) {
  return {
    ...(headers || {}),
    [DAO_DEVICE_HEADER]: getClientDeviceId(),
  };
}
