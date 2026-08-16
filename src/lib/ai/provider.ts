import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

export type AIProvider = 'openai' | 'gemini' | 'anthropic';
export type ModelName = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-3.5-turbo' | 'claude-3-sonnet' | 'claude-3-haiku' | 'gemini-pro';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: AIProvider;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

function getModelProvider(model: string): AIProvider {
  if (model.startsWith('gpt')) return 'openai';
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gemini')) return 'gemini';
  return 'openai';
}

export async function generateAIResponse(params: {
  messages: Message[];
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<AIResponse> {
  const { messages, systemPrompt, model = 'gpt-4o', temperature = 0.7, maxTokens = 4096 } = params;
  const provider = getModelProvider(model);

  try {
    switch (provider) {
      case 'openai': {
        const completion = await openai.chat.completions.create({
          model,
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
          temperature,
          max_tokens: maxTokens,
        });

        return {
          content: completion.choices[0]?.message?.content || '',
          model,
          provider: 'openai',
          usage: {
            promptTokens: completion.usage?.prompt_tokens || 0,
            completionTokens: completion.usage?.completion_tokens || 0,
            totalTokens: completion.usage?.total_tokens || 0,
          },
        };
      }

      case 'anthropic': {
        const systemMsg = systemPrompt ? [{ type: 'text' as const, text: systemPrompt }] : undefined;
        const msg = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemMsg,
          messages: messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          temperature,
        });

        const content = msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');

        return {
          content,
          model,
          provider: 'anthropic',
          usage: {
            promptTokens: msg.usage?.input_tokens || 0,
            completionTokens: msg.usage?.output_tokens || 0,
            totalTokens: (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0),
          },
        };
      }

      case 'gemini': {
        const geminiModel = genAI.getGenerativeModel({ model });
        const chat = geminiModel.startChat({
          history: messages.slice(0, -1).map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          systemInstruction: systemPrompt ? { role: 'user', parts: [{ text: systemPrompt }] } : undefined,
        });

        const lastMsg = messages[messages.length - 1];
        const result = await chat.sendMessage(lastMsg.content);
        const response = result.response;

        return {
          content: response.text(),
          model,
          provider: 'gemini',
        };
      }

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`AI provider error (${provider}/${model}):`, error);
    return {
      content: `I encountered an error processing your request. Please check your API keys and try again.`,
      model,
      provider,
    };
  }
}
