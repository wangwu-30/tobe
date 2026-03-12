export const AI_STREAM_HEARTBEAT_TOKEN = '<<__DAO_AI_STREAM_HEARTBEAT__>>';

export function stripAIStreamControlTokens(value: string) {
  return value.split(AI_STREAM_HEARTBEAT_TOKEN).join('');
}
