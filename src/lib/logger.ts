/**
 * Structured JSON logging with secret redaction.
 *
 * Two rules this module enforces:
 *  1. Nothing that looks like a credential reaches stdout or the audit table.
 *  2. Every line is one JSON object, so a log shipper can parse it without a
 *     custom pattern.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY =
  /(key|token|secret|password|authorization|credential|apikey|signature|cookie|session)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{10,}\b/g, // Google API keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic keys
  /\b[A-Fa-f0-9]{48,}\b/g, // long hex secrets
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs
  /postgres(?:ql)?:\/\/[^@\s]+@/gi, // DB URLs with inline credentials
  /smtps?:\/\/[^@\s]+@/gi,
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 4000;

function scrubString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/**
 * Deep-copies a value, dropping anything that looks like a secret. Used for
 * both log payloads and the audit log's `data` column, so a stored audit row
 * can never become a credential leak.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[max depth]';

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redact(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return undefined;
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const line = {
    level,
    time: new Date().toISOString(),
    msg: scrubString(message),
    ...(context ? { ctx: redact(context) as Record<string, unknown> } : {}),
  };

  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
