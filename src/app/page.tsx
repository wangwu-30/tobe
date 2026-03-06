'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Plus,
  FileText,
  Trash2,
  MessageSquare,
  Settings,
} from 'lucide-react';

type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: { content: string }[];
  documents: { title: string }[];
};

export default function HomePage() {
  const router = useRouter();
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadSessions = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        setSessions(await res.json());
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const createSession = async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const session = await res.json();
      router.push(`/session/${session.id}`);
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' });
    loadSessions();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-bold">Chat to Your Mind</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/settings')}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button onClick={createSession}>
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-sm font-semibold text-muted-foreground mb-4">
          Recent Sessions
        </h2>

        {isLoading && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Loading...
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <div className="text-center py-16">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm mb-4">
              No sessions yet. Start a new conversation to generate documents.
            </p>
            <Button onClick={createSession}>
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Button>
          </div>
        )}

        <div className="grid gap-3">
          {sessions.map(session => (
            <Card
              key={session.id}
              className="p-4 cursor-pointer hover:bg-accent/50 transition-colors group"
              onClick={() => router.push(`/session/${session.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">
                    {session.title}
                  </h3>
                  {session.messages[0] && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {session.messages[0].content}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </span>
                    {session.documents[0] && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {session.documents[0].title}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 h-8 w-8"
                  onClick={(e) => deleteSession(session.id, e)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
