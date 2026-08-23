export const HOME_ONBOARDING_CONVERSATION_PARAM = 'onboardingConversationId';
export const HOME_ONBOARDING_CONVERSATION_STORAGE_KEY =
  'dao-home-onboarding-conversation-id';

export function normalizeOnboardingConversationId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

export function loadOnboardingConversationId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return normalizeOnboardingConversationId(
    searchParams.get(HOME_ONBOARDING_CONVERSATION_PARAM) ||
      searchParams.get('conversationId') ||
      window.sessionStorage.getItem(HOME_ONBOARDING_CONVERSATION_STORAGE_KEY)
  );
}

export function persistOnboardingConversationId(conversationId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeOnboardingConversationId(conversationId);
  if (!normalized) {
    return;
  }

  window.sessionStorage.setItem(
    HOME_ONBOARDING_CONVERSATION_STORAGE_KEY,
    normalized
  );

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get(HOME_ONBOARDING_CONVERSATION_PARAM) === normalized) {
    return;
  }

  searchParams.set(HOME_ONBOARDING_CONVERSATION_PARAM, normalized);
  const query = searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );
}

export function clearOnboardingConversationId(conversationId?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(HOME_ONBOARDING_CONVERSATION_STORAGE_KEY);

  const searchParams = new URLSearchParams(window.location.search);
  searchParams.delete(HOME_ONBOARDING_CONVERSATION_PARAM);
  if (
    conversationId &&
    searchParams.get('conversationId') === normalizeOnboardingConversationId(conversationId)
  ) {
    searchParams.delete('conversationId');
  }

  const query = searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );
}

export function findLastUserGoal(messages: Array<{ content: string; role: string }>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }

  return '';
}
