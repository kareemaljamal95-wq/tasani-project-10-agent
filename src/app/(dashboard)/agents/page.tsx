'use client';

import { useState } from 'react';
import { AGENT_DISPLAY_INFO, type AgentType } from '@/types/agent';
import { AGENT_COLORS } from '@/lib/constants';
import { ChatInterface } from '@/components/layout/chat-interface';
import { cn } from '@/lib/utils';
import { Bot, ChevronRight, Sparkles, Activity, Settings, Power } from 'lucide-react';

const agentTypes = Object.keys(AGENT_DISPLAY_INFO) as AgentType[];
const defaultAgents = agentTypes.filter(t => !['EXECUTIVE', 'BUSINESS', 'COMMERCE', 'GROWTH'].includes(t));

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('CEO');
  const [chatOpen, setChatOpen] = useState(false);

  const agentInfo = AGENT_DISPLAY_INFO[selectedAgent];

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">AI Agents</h1>
        <p className="text-white/60 mt-1">Multi-agent system — specialized AI agents working together</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {defaultAgents.map((type) => {
          const info = AGENT_DISPLAY_INFO[type];
          const isSelected = selectedAgent === type;
          return (
            <button
              key={type}
              onClick={() => { setSelectedAgent(type); setChatOpen(true); }}
              className={cn(
                'relative rounded-2xl border p-4 text-left transition-all duration-200',
                isSelected
                  ? 'border-violet-500/50 bg-violet-500/10 shadow-lg shadow-violet-500/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              )}
            >
              <div className={cn(
                'absolute inset-0 rounded-2xl bg-gradient-to-br opacity-0 transition-opacity',
                AGENT_COLORS[type],
                isSelected ? 'opacity-10' : ''
              )} />
              <div className="relative">
                <div className={cn(
                  'h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                  AGENT_COLORS[type]
                )}>
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <p className="text-sm font-medium text-white">{info.name}</p>
                <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{info.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {chatOpen && selectedAgent && (
        <ChatInterface
          defaultAgent={selectedAgent}
          fullScreen={false}
          placeholder={`Message ${AGENT_DISPLAY_INFO[selectedAgent]?.name ?? 'Agent'}...`}
        />
      )}

      {!chatOpen && (
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-12 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-purple-600/20 border border-violet-500/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-violet-400" />
            </div>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Select an Agent</h3>
          <p className="text-white/60 max-w-md mx-auto">
            Choose an AI agent above to start a conversation. Each agent has specialized expertise to help you.
          </p>
        </div>
      )}
    </div>
  );
}
