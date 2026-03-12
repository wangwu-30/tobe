export const CHAT_CLIPBOARD_TEXT_FILE_THRESHOLD = 4000;

export type ChatComposerAttachment = {
  id: string;
  file: File;
  kind: 'image' | 'text' | 'file';
  source: 'upload' | 'clipboard';
  previewUrl?: string | null;
};
