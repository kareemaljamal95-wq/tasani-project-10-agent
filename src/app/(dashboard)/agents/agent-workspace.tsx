'use client';

import { useState } from 'react';
import { Bot, Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentRunner } from '@/components/agents/agent-runner';
import { ChatInterface } from '@/components/layout/chat-interface';

export interface AgentCard {
  id: string;
  type: string;
  name: string;
  arabicName: string;
  description: string | null;
  model: string;
  isEnabled: boolean;
}

export function AgentWorkspace({ agents }: { agents: AgentCard[] }) {
  const [selected, setSelected] = useState<AgentCard | null>(agents[0] ?? null);
  const [mode, setMode] = useState<'run' | 'chat'>('run');
  const [pending, setPending] = useState<string | null>(null);
  const [list, setList] = useState(agents);

  async function toggleEnabled(agent: AgentCard) {
    setPending(agent.id);

    try {
      const res = await fetch('/api/agents', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: agent.id, isEnabled: !agent.isEnabled }),
      });

      if (res.ok) {
        setList((prev) =>
          prev.map((a) =>
            a.id === agent.id ? { ...a, isEnabled: !a.isEnabled } : a,
          ),
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">الوكلاء</h1>
        <p className="text-white/60 mt-1">
          فريق وكلاء متخصص يقترح، وأنت تعتمد
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {list.map((agent) => {
          const isSelected = selected?.id === agent.id;

          return (
            <div
              key={agent.id}
              className={cn(
                'relative rounded-2xl border p-4 transition-all',
                isSelected
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10',
                !agent.isEnabled && 'opacity-50',
              )}
            >
              <button
                onClick={() => setSelected(agent)}
                className="text-right w-full"
                aria-pressed={isSelected}
              >
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center mb-3">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <p className="text-sm font-medium text-white">{agent.arabicName}</p>
                <p className="text-xs text-white/40 mt-0.5 line-clamp-2">
                  {agent.description}
                </p>
                <p className="text-[10px] font-mono text-white/25 mt-2">
                  {agent.model}
                </p>
              </button>

              <button
                onClick={() => toggleEnabled(agent)}
                disabled={pending === agent.id}
                aria-label={agent.isEnabled ? 'تعطيل الوكيل' : 'تفعيل الوكيل'}
                title={agent.isEnabled ? 'تعطيل' : 'تفعيل'}
                className="absolute top-3 left-3 p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40"
              >
                <Power
                  className={cn(
                    'h-3.5 w-3.5',
                    agent.isEnabled ? 'text-green-400' : 'text-white/30',
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>

      {selected && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('run')}
              className={cn(
                'px-4 py-2 rounded-xl text-sm transition-all',
                mode === 'run'
                  ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                  : 'text-white/50 hover:text-white/80',
              )}
            >
              تشغيل مهمة
            </button>
            <button
              onClick={() => setMode('chat')}
              className={cn(
                'px-4 py-2 rounded-xl text-sm transition-all',
                mode === 'chat'
                  ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                  : 'text-white/50 hover:text-white/80',
              )}
            >
              محادثة
            </button>
          </div>

          {!selected.isEnabled && (
            <p className="text-sm text-amber-300">
              هذا الوكيل معطّل. فعّله لتشغيل المهام.
            </p>
          )}

          {mode === 'run' ? (
            <AgentRunner key={selected.id} agentType={selected.type} />
          ) : (
            <ChatInterface
              key={selected.id}
              defaultAgent={selected.type}
              fullScreen={false}
              placeholder={`اكتب إلى ${selected.arabicName}...`}
            />
          )}
        </>
      )}
    </div>
  );
}
