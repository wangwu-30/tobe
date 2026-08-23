'use client';

import * as React from 'react';

export type NavigationAttempt = {
  destination?: string;
  kind: 'push' | 'replace' | 'traverse' | 'unload';
};

type NavigationBlocker = {
  id: symbol;
  message: string;
};

type GuardedRouter = {
  push: (href: string, navigate: () => void) => boolean;
  replace: (href: string, navigate: () => void) => boolean;
};

type NavigationState = {
  key: string;
  position: number;
  version: 1;
};

type NavigationEntry = NavigationState & {
  href: string;
};

type Restoration = NavigationEntry & {
  timer: ReturnType<typeof setTimeout> | null;
};

const NAVIGATION_STATE_KEY = '__multicaNavigation';
const blockers = new Map<symbol, NavigationBlocker>();
let listenersInstalled = false;
let currentEntry: NavigationEntry | null = null;
let acceptedEntry: NavigationEntry | null = null;
let restoration: Restoration | null = null;
let approvedHashHref: string | null = null;
let approvedHashTimer: ReturnType<typeof setTimeout> | null = null;
let nativePushState: History['pushState'] | null = null;
let nativeReplaceState: History['replaceState'] | null = null;
let installedPushState: History['pushState'] | null = null;
let installedReplaceState: History['replaceState'] | null = null;
let runtimeUsers = 0;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let confirmationInProgress = false;

function blockerMessage() {
  const messages = Array.from(
    new Set(
      Array.from(blockers.values(), (blocker) => blocker.message.trim()).filter(
        Boolean
      )
    )
  );
  return messages.length > 0 ? messages.join('\n\n') : null;
}

function absoluteDestination(href: string | URL) {
  return new URL(href, window.location.href).href;
}

function relativeDestination(href: string) {
  const destination = new URL(href, window.location.href);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function readNavigationState(value: unknown): NavigationState | null {
  if (!value || typeof value !== 'object') return null;
  const state = (value as Record<string, unknown>)[NAVIGATION_STATE_KEY];
  if (!state || typeof state !== 'object') return null;
  const candidate = state as Partial<NavigationState>;
  return candidate.version === 1 &&
    typeof candidate.key === 'string' &&
    typeof candidate.position === 'number'
    ? (candidate as NavigationState)
    : null;
}

function createNavigationKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function withNavigationState(
  value: unknown,
  position: number,
  key = createNavigationKey()
) {
  const state =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...state,
    [NAVIGATION_STATE_KEY]: {
      key,
      position,
      version: 1,
    } satisfies NavigationState,
  };
}

function toEntry(state: NavigationState, href = window.location.href): NavigationEntry {
  return { ...state, href: absoluteDestination(href) };
}

function entriesMatch(left: NavigationEntry | null, right: NavigationEntry | null) {
  return Boolean(
    left &&
      right &&
      left.key === right.key &&
      left.position === right.position &&
      left.href === right.href
  );
}

export function confirmNavigation(attempt: NavigationAttempt) {
  void attempt;
  const message = blockerMessage();
  if (!message) return true;
  if (confirmationInProgress) return false;

  confirmationInProgress = true;
  try {
    return window.confirm(message);
  } finally {
    confirmationInProgress = false;
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!blockerMessage()) return;
  event.preventDefault();
  event.returnValue = '';
}

function clearApprovedHash() {
  approvedHashHref = null;
  if (approvedHashTimer) clearTimeout(approvedHashTimer);
  approvedHashTimer = null;
}

function approveHash(href: string) {
  clearApprovedHash();
  approvedHashHref = absoluteDestination(href);
  approvedHashTimer = setTimeout(clearApprovedHash, 1_000);
}

function consumeApprovedHash(href: string) {
  const approved = approvedHashHref === absoluteDestination(href);
  if (approved) clearApprovedHash();
  return approved;
}

function clearRestoration() {
  if (restoration?.timer) clearTimeout(restoration.timer);
  restoration = null;
}

function scheduleRestoration() {
  if (!restoration || !currentEntry) return;
  if (restoration.timer) clearTimeout(restoration.timer);

  const target = restoration;
  target.timer = setTimeout(() => {
    if (restoration !== target || !currentEntry) return;
    target.timer = null;
    if (entriesMatch(currentEntry, target)) {
      clearRestoration();
      return;
    }

    const delta = target.position - currentEntry.position;
    if (delta !== 0) window.history.go(delta);
  }, 0);
}

function restoreAcceptedEntry() {
  if (!acceptedEntry || !currentEntry) return;
  clearRestoration();
  restoration = { ...acceptedEntry, timer: null };
  scheduleRestoration();
}

function followLink(event: MouseEvent) {
  if (
    !blockerMessage() ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) return;

  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
  if (
    !target ||
    (target.target && target.target.toLowerCase() !== '_self') ||
    target.hasAttribute('download')
  ) return;

  const destination = new URL(target.href, window.location.href);
  if (
    destination.origin !== window.location.origin ||
    destination.href === window.location.href
  ) {
    return;
  }

  if (!confirmNavigation({ destination: destination.href, kind: 'push' })) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const current = new URL(window.location.href);
  if (
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.hash !== current.hash
  ) {
    approveHash(destination.href);
  }
}

function markUnknownPopState(state: unknown) {
  const position = (currentEntry || acceptedEntry)?.position ?? 0;
  const inferredPosition = position - 1;
  const value = withNavigationState(state, inferredPosition);
  nativeReplaceState?.(value, '', window.location.href);
  return readNavigationState(value)!;
}

function navigateHistory(event: PopStateEvent) {
  const state = readNavigationState(event.state) || markUnknownPopState(event.state);
  currentEntry = toEntry(state);

  if (restoration) {
    if (entriesMatch(currentEntry, restoration)) {
      clearRestoration();
      return;
    }
    event.stopImmediatePropagation();
    scheduleRestoration();
    return;
  }

  if (
    acceptedEntry &&
    state.key === acceptedEntry.key &&
    state.position === acceptedEntry.position &&
    currentEntry.href !== acceptedEntry.href
  ) {
    const value = withNavigationState(
      event.state,
      acceptedEntry.position + 1
    );
    nativeReplaceState?.(value, '', window.location.href);
    currentEntry = toEntry(readNavigationState(value)!);

    if (
      consumeApprovedHash(currentEntry.href) ||
      !blockerMessage() ||
      confirmNavigation({ destination: currentEntry.href, kind: 'push' })
    ) {
      acceptedEntry = currentEntry;
      return;
    }

    event.stopImmediatePropagation();
    restoreAcceptedEntry();
    return;
  }

  if (entriesMatch(currentEntry, acceptedEntry)) return;
  if (
    !blockerMessage() ||
    confirmNavigation({ destination: currentEntry.href, kind: 'traverse' })
  ) {
    acceptedEntry = currentEntry;
    clearApprovedHash();
    return;
  }

  event.stopImmediatePropagation();
  restoreAcceptedEntry();
}

function navigateHash(event: HashChangeEvent) {
  if (!acceptedEntry || restoration) return;
  const href = absoluteDestination(event.newURL);
  if (href === acceptedEntry.href) return;

  const state = readNavigationState(window.history.state);
  if (!state) return;

  // A direct fragment navigation copies the current entry state. Give the new
  // entry its own position so a rejected back/forward can be reversed exactly.
  if (state.key === acceptedEntry.key && state.position === acceptedEntry.position) {
    const value = withNavigationState(
      window.history.state,
      acceptedEntry.position + 1
    );
    nativeReplaceState?.(value, '', window.location.href);
    currentEntry = toEntry(readNavigationState(value)!);

    if (
      consumeApprovedHash(href) ||
      !blockerMessage() ||
      confirmNavigation({ destination: href, kind: 'push' })
    ) {
      acceptedEntry = currentEntry;
      return;
    }

    event.stopImmediatePropagation();
    restoreAcceptedEntry();
  }
}

function installListeners() {
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  nativePushState = window.history.pushState.bind(window.history);
  nativeReplaceState = window.history.replaceState.bind(window.history);

  let existingState = readNavigationState(window.history.state);
  if (!existingState) {
    const value = withNavigationState(window.history.state, 0);
    nativeReplaceState(value, '', window.location.href);
    existingState = readNavigationState(value)!;
  }
  currentEntry = toEntry(existingState);
  acceptedEntry = currentEntry;

  installedPushState = function guardedPushState(data, unused, url) {
    const activeState = readNavigationState(window.history.state);
    const position =
      (activeState || currentEntry || acceptedEntry)?.position ?? 0;
    const value = withNavigationState(data, position + 1);
    nativePushState?.(value, unused, url);
    currentEntry = toEntry(readNavigationState(value)!);
    acceptedEntry = currentEntry;
    clearRestoration();
    clearApprovedHash();
  };
  installedReplaceState = function guardedReplaceState(data, unused, url) {
    const activeState = readNavigationState(window.history.state);
    const previousEntry = currentEntry || acceptedEntry;
    const position = (activeState || previousEntry)?.position ?? 0;
    const key =
      activeState?.key || previousEntry?.key || createNavigationKey();
    const value = withNavigationState(data, position, key);
    nativeReplaceState?.(value, unused, url);
    currentEntry = toEntry(readNavigationState(value)!);
    if (acceptedEntry?.key === key) acceptedEntry = currentEntry;
  };

  window.history.pushState = installedPushState;
  window.history.replaceState = installedReplaceState;
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('popstate', navigateHistory, true);
  window.addEventListener('hashchange', navigateHash, true);
  document.addEventListener('click', followLink, true);
}

function uninstallListeners() {
  if (
    !listenersInstalled ||
    blockers.size > 0 ||
    runtimeUsers > 0 ||
    typeof window === 'undefined'
  ) return;
  listenersInstalled = false;
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('popstate', navigateHistory, true);
  window.removeEventListener('hashchange', navigateHash, true);
  document.removeEventListener('click', followLink, true);
  if (nativePushState && window.history.pushState === installedPushState) {
    window.history.pushState = nativePushState;
  }
  if (nativeReplaceState && window.history.replaceState === installedReplaceState) {
    window.history.replaceState = nativeReplaceState;
  }
  nativePushState = null;
  nativeReplaceState = null;
  installedPushState = null;
  installedReplaceState = null;
  currentEntry = null;
  acceptedEntry = null;
  clearRestoration();
  clearApprovedHash();
}

function scheduleListenerCleanup() {
  if (teardownTimer) clearTimeout(teardownTimer);
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    uninstallListeners();
  }, 0);
}

export function useNavigationGuardRuntime() {
  React.useEffect(() => {
    runtimeUsers += 1;
    installListeners();
    return () => {
      runtimeUsers = Math.max(0, runtimeUsers - 1);
      scheduleListenerCleanup();
    };
  }, []);
}

export function useNavigationBlocker(when: boolean, message: string) {
  const id = React.useRef(Symbol('navigation-blocker')).current;

  React.useEffect(() => {
    if (!when) return;
    blockers.set(id, { id, message });
    installListeners();
    return () => {
      blockers.delete(id);
      scheduleListenerCleanup();
    };
  }, [id, message, when]);
}

export function useGuardedRouter(): GuardedRouter {
  return React.useMemo(
    () => ({
      push(href, navigate) {
        if (relativeDestination(href) === relativeDestination(window.location.href)) {
          return false;
        }
        if (!confirmNavigation({ destination: href, kind: 'push' })) return false;
        navigate();
        return true;
      },
      replace(href, navigate) {
        if (relativeDestination(href) === relativeDestination(window.location.href)) {
          return false;
        }
        if (!confirmNavigation({ destination: href, kind: 'replace' })) return false;
        navigate();
        return true;
      },
    }),
    []
  );
}
