import { request } from 'undici';
import type { LLMBackend, Tier } from '../types.js';

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  // Per-attempt timeout. Total wall time = (perAttemptTimeoutMs + backoff) * (MAX_RETRIES + 1).
  perAttemptTimeoutMs?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: AnthropicContentBlock[];
  model?: string;
}

interface AnthropicErrorPayload {
  type?: string;
  error?: {
    type?: string;
    message?: string;
  };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

const MISSING_KEY_MESSAGE =
  'AnthropicAdapter: Missing ANTHROPIC_API_KEY. Set it via env var or opts. Sign up at https://console.anthropic.com/';
const INVALID_KEY_MESSAGE =
  'AnthropicAdapter: API key invalid (401). Check your key at https://console.anthropic.com/settings/keys';
const RATE_LIMIT_MESSAGE =
  'AnthropicAdapter: rate limited after 3 retries';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text: string, key: string): string {
  if (!key) return text;
  return text.split(key).join('[REDACTED]');
}

function safeParseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function extractErrorMessage(body: string, key: string): string {
  const parsed = safeParseJson<AnthropicErrorPayload>(body);
  const message = parsed?.error?.message;
  const raw = typeof message === 'string' && message.length > 0 ? message : body;
  const truncated = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
  return redact(truncated, key);
}

export class AnthropicAdapter implements LLMBackend {
  readonly name = 'anthropic-api';
  readonly tier: Tier = 3;

  constructor(private readonly opts?: AnthropicAdapterOptions) {}

  async generate(user: string, system?: string): Promise<string> {
    const apiKey = this.opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(MISSING_KEY_MESSAGE);
    }

    const model = this.opts?.model ?? DEFAULT_MODEL;
    const maxTokens = this.opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const perAttemptTimeoutMs = this.opts?.perAttemptTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: user }],
    };
    if (typeof system === 'string' && system.length > 0) {
      body.system = system;
    }

    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    };

    let lastRetryableError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), perAttemptTimeoutMs);

      try {
        const response = await request(ANTHROPIC_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const status = response.statusCode;
        const text = await response.body.text();

        if (status >= 200 && status < 300) {
          const parsed = safeParseJson<AnthropicMessageResponse>(text);
          if (!parsed || !Array.isArray(parsed.content) || parsed.content.length === 0) {
            throw new Error('AnthropicAdapter: malformed response (no content)');
          }
          const first = parsed.content.find((b) => b.type === 'text' && typeof b.text === 'string');
          if (!first || typeof first.text !== 'string') {
            throw new Error('AnthropicAdapter: malformed response (no text block)');
          }
          return first.text;
        }

        if (status === 401) {
          throw new Error(INVALID_KEY_MESSAGE);
        }

        if (status === 429 || (status >= 500 && status < 600)) {
          lastRetryableError = new Error(
            status === 429
              ? RATE_LIMIT_MESSAGE
              : `AnthropicAdapter: server error ${status}: ${extractErrorMessage(text, apiKey)}`,
          );
          if (attempt < MAX_RETRIES) {
            const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
            await sleep(backoff);
            continue;
          }
          throw status === 429
            ? new Error(RATE_LIMIT_MESSAGE)
            : lastRetryableError;
        }

        throw new Error(
          `AnthropicAdapter: request failed (${status}): ${extractErrorMessage(text, apiKey)}`,
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          lastRetryableError = new Error(`AnthropicAdapter: request timed out after ${perAttemptTimeoutMs}ms (per attempt)`);
          if (attempt < MAX_RETRIES) {
            const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
            await sleep(backoff);
            continue;
          }
          throw lastRetryableError;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastRetryableError ?? new Error('AnthropicAdapter: exhausted retries');
  }
}
