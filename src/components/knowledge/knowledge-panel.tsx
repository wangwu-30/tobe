'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  Brain,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { KnowledgeItemData, MemoryData } from '@/types';

export function KnowledgePanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [knowledgeItems, setKnowledgeItems] = React.useState<KnowledgeItemData[]>([]);
  const [memories, setMemories] = React.useState<MemoryData[]>([]);
  const [newTitle, setNewTitle] = React.useState('');
  const [newContent, setNewContent] = React.useState('');

  const loadData = React.useCallback(async () => {
    const [kRes, mRes] = await Promise.all([
      fetch('/api/knowledge'),
      fetch('/api/memories'),
    ]);
    if (kRes.ok) setKnowledgeItems(await kRes.json());
    if (mRes.ok) setMemories(await mRes.json());
  }, []);

  React.useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  const addKnowledgeItem = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, content: newContent }),
    });
    if (res.ok) {
      setNewTitle('');
      setNewContent('');
      loadData();
    }
  };

  const deleteKnowledgeItem = async (id: string) => {
    await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  const toggleMemory = async (id: string, active: boolean) => {
    await fetch('/api/memories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    });
    loadData();
  };

  const deleteMemory = async (id: string) => {
    await fetch(`/api/memories?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  if (!isOpen) return null;

  const categoryColors: Record<string, string> = {
    correction: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    preference: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    domain_knowledge: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    constraint: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[360px] border-l border-border bg-background shadow-lg z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          Knowledge Base
        </h2>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="knowledge" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="knowledge" className="text-xs">
            <BookOpen className="h-3 w-3 mr-1" />
            Knowledge
          </TabsTrigger>
          <TabsTrigger value="memories" className="text-xs">
            <Brain className="h-3 w-3 mr-1" />
            AI Memories
            {memories.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                {memories.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge" className="flex-1 flex flex-col mt-0">
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-2 py-3">
              {knowledgeItems.map(item => (
                <div key={item.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium">{item.title}</h4>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => deleteKnowledgeItem(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="mt-1 text-muted-foreground">{item.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t border-border p-3 space-y-2">
            <Input
              placeholder="Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Content..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="min-h-[60px] text-xs resize-none"
              rows={2}
            />
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={addKnowledgeItem}
              disabled={!newTitle.trim() || !newContent.trim()}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Knowledge
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="memories" className="flex-1 flex flex-col mt-0">
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-2 py-3">
              {memories.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  <Brain className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p>No memories yet</p>
                  <p className="mt-1 opacity-70">
                    AI will learn from resolved comment threads
                  </p>
                </div>
              )}
              {memories.map(memory => (
                <div
                  key={memory.id}
                  className={`rounded-lg border p-3 text-xs ${!memory.active ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <Badge className={`text-[10px] mb-1 ${categoryColors[memory.category] || ''}`}>
                        {memory.category}
                      </Badge>
                      <p className="leading-relaxed">{memory.content}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={memory.active}
                        onCheckedChange={(checked) => toggleMemory(memory.id, checked)}
                        className="scale-75"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={() => deleteMemory(memory.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
