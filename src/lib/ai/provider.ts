import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/lib/logger';

export type AIProvider = 'openai' | 'gemini' | 'anthropic';

/** Raised when a provider call fails, so callers can return a real 502. */
export class AIProviderError extends Error {
  constructor(
    readonly provider: AIProvider,
    readonly model: string,
    readonly cause: unknown,
  ) {
    super(`AI provider ${provider} failed for model ${model}.`);
    this.name = 'AIProviderError';
  }
}

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
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
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
        // The unified @google/genai client takes the whole conversation as
        // `contents` rather than a chat session plus a trailing message, so
        // every turn is mapped in one pass. `model` is a plain string here, not
        // a pre-bound model object.
        const result = await genAI.models.generateContent({
          model,
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          ...(systemPrompt
            ? { config: { systemInstruction: systemPrompt } }
            : {}),
        });

        return {
          // `text` is a property on the new client, not a method.
          content: result.text ?? '',
          model,
          provider: 'gemini',
          usage: {
            promptTokens: result.usageMetadata?.promptTokenCount || 0,
            completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: result.usageMetadata?.totalTokenCount || 0,
          },
        };
      }

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    // Previously this returned a cheerful sentence as though it were the
    // model's answer, so an outage, a bad key or a quota error was stored in
    // the conversation as a successful assistant reply. Failures now surface.
    logger.error('AI provider call failed', {
      provider,
      model,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new AIProviderError(provider, model, error);
  }
}
