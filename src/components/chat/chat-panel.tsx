'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { useChat } from '@/hooks/use-chat';
import type { ChatMessageData } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getAvailableModelsClient, type AIModel } from '@/lib/ai/providers';
import { FileText } from 'lucide-react';

export function ChatPanel({
  sessionId,
  onDocumentGenerated,
  initialMessages,
}: {
  sessionId: string;
  onDocumentGenerated: (markdown: string) => void;
  initialMessages?: ChatMessageData[];
}) {
  const { messages, setMessages, isLoading, error, sendMessage, stopGeneration } =
    useChat(sessionId);
  const [selectedModel, setSelectedModel] = React.useState('claude-sonnet-4-20250514');
  const [availableModels, setAvailableModels] = React.useState<AIModel[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Load models dynamically (includes custom providers from localStorage)
  React.useEffect(() => {
    setAvailableModels(getAvailableModelsClient());
    const handleStorage = () => setAvailableModels(getAvailableModelsClient());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  React.useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (content: string) => {
    sendMessage(content, {
      model: selectedModel,
      onDocumentDetected: onDocumentGenerated,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Chat
        </h2>
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="h-7 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map(m => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                <span className="text-muted-foreground mr-1">[{m.provider}]</span>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Start a conversation to generate documents</p>
              <p className="text-xs mt-1 opacity-70">
                Try: &quot;Write a product requirements document for...&quot;
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {error && (
            <div className="px-4 py-2 text-sm text-destructive">
              Error: {error}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={stopGeneration}
        isLoading={isLoading}
      />
    </div>
  );
}
