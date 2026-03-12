import { normalizeAppLanguage, type AppLanguage } from '@/lib/i18n/language';

export function buildReplyLanguageInstruction(language?: AppLanguage | null) {
  const normalized = normalizeAppLanguage(language);

  if (normalized === 'en-US') {
    return 'Use English for user-facing replies, summaries, review responses, and plan labels unless the user explicitly asks for another language. Do not translate or rewrite the deliverable content itself unless the user asks.';
  }

  return '使用简体中文输出面向用户的回复、总结、评审响应和计划标题，除非用户明确要求其他语言。不要自动翻译或改写交付物内容本身，除非用户明确提出。';
}

export function buildPlanLanguageInstruction(language?: AppLanguage | null) {
  const normalized = normalizeAppLanguage(language);

  if (normalized === 'en-US') {
    return 'Return stage titles and descriptions in English unless the user explicitly asks for another language.';
  }

  return '阶段标题和描述请使用简体中文，除非用户明确要求其他语言。';
}
