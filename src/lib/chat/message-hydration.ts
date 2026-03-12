export type MessageSnapshot = {
  content: string;
  id: string;
  model: string | null;
  role: string;
};

export function shouldHydrateChatMessages(params: {
  conversationChanged: boolean;
  currentMessages: MessageSnapshot[];
  isLoading: boolean;
  serverMessages: MessageSnapshot[];
}) {
  const { conversationChanged, currentMessages, isLoading, serverMessages } = params;

  if (
    isLoading &&
    hasTransientChatMessages(currentMessages) &&
    isMessageListPrefix(serverMessages, currentMessages)
  ) {
    return false;
  }

  if (conversationChanged) {
    return true;
  }

  return !areMessageSnapshotsEqual(currentMessages, serverMessages);
}

export function hasTransientChatMessages(messages: MessageSnapshot[]) {
  return messages.some((message) => message.id.startsWith('temp-'));
}

function areMessageSnapshotsEqual(
  left: MessageSnapshot[],
  right: MessageSnapshot[]
) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) =>
    areExactMessageSnapshotsEqual(message, right[index])
  );
}

function isMessageListPrefix(prefix: MessageSnapshot[], full: MessageSnapshot[]) {
  if (prefix.length > full.length) {
    return false;
  }

  return prefix.every((message, index) =>
    areMessageSnapshotsEquivalent(message, full[index])
  );
}

function areExactMessageSnapshotsEqual(
  left: MessageSnapshot,
  right: MessageSnapshot | undefined
) {
  if (!right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.role === right.role &&
    left.content === right.content &&
    (left.model || null) === (right.model || null)
  );
}

function areMessageSnapshotsEquivalent(
  left: MessageSnapshot,
  right: MessageSnapshot | undefined
) {
  if (!right) {
    return false;
  }

  return (
    left.role === right.role &&
    left.content === right.content &&
    (left.model || null) === (right.model || null)
  );
}
