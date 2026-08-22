/**
 * Known provider/model combinations.
 *
 * Validated against this registry when configuration is *written*, never on
 * every render: checking a model id costs a provider round trip, and doing
 * that per page load would add latency and burn quota for no benefit. A model
 * that passes here but has since been retired surfaces as a 502 from the
 * provider at call time, which is the correct place to find out.
 *
 * Keep this list current with the providers' published model ids.
 */
export type ProviderId = 'openai' | 'anthropic' | 'gemini';

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  label: string;
}

export const SUPPORTED_MODELS: ModelSpec[] = [
  { id: 'gpt-4o', provider: 'openai', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', provider: 'openai', label: 'GPT-4o mini' },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini' },

  { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-1', provider: 'anthropic', label: 'Claude Opus 4.1' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },

  // Verified live against the API on 2026-08-22. gemini-2.5-flash and
  // gemini-2.5-pro were both retired and answer 404 ("no longer available to
  // new users"), which surfaced as a 502 at call time — exactly the failure
  // mode PRODUCTION.md warns about for a stale registry.
  { id: 'gemini-3.6-flash', provider: 'gemini', label: 'Gemini 3.6 Flash' },
];

export function findModel(id: string): ModelSpec | undefined {
  return SUPPORTED_MODELS.find((model) => model.id === id);
}

export function isKnownModel(id: string): boolean {
  return findModel(id) !== undefined;
}

/**
 * Which providers actually have a key configured. Server-side only — the
 * booleans may cross to the client, the values never do.
 */
export function configuredProviders(): Record<ProviderId, boolean> {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
}

export interface ModelValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Rejects an unknown model id outright, and reports when a known model's
 * provider has no credential — the second is a warning rather than a hard
 * failure, so an account can configure a model ahead of adding its key.
 */
export function validateModelSelection(id: string): ModelValidation {
  const model = findModel(id);

  if (!model) {
    return {
      ok: false,
      reason: `Unknown model "${id}". Supported: ${SUPPORTED_MODELS.map((m) => m.id).join(', ')}.`,
    };
  }

  if (!configuredProviders()[model.provider]) {
    return {
      ok: false,
      reason: `Model "${id}" requires the ${model.provider} provider, which has no API key configured.`,
    };
  }

  return { ok: true };
}

/** Models the account can actually use right now, for the settings UI. */
export function availableModels(): Array<ModelSpec & { configured: boolean }> {
  const providers = configuredProviders();
  return SUPPORTED_MODELS.map((model) => ({
    ...model,
    configured: providers[model.provider],
  }));
}
