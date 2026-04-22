import { request } from 'undici';

export interface JinaResult {
  url: string;
  title?: string;
  author?: string;
  raw_text: string;
  word_count: number;
}

export interface JinaOptions {
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
}

interface JinaResponseData {
  url?: string;
  title?: string;
  author?: string;
  content?: string;
}

interface JinaResponseBody {
  data?: JinaResponseData;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  if (!header) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function countWords(text: string): number {
  if (!text) return 0;
  const tokens = text.split(/\s+/);
  let count = 0;
  for (const token of tokens) {
    if (token.length > 0) count += 1;
  }
  return count;
}

function isJinaResponseBody(value: unknown): value is JinaResponseBody {
  return typeof value === 'object' && value !== null;
}

export async function fetchViaJina(url: string, opts?: JinaOptions): Promise<JinaResult> {
  const apiKey = opts?.apiKey ?? process.env.JINA_API_KEY;
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;

  const endpoint = `https://r.jina.ai/${encodeURI(url)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await request(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const { statusCode } = response;

      if (statusCode >= 200 && statusCode < 300) {
        let parsed: unknown;
        try {
          parsed = await response.body.json();
        } catch {
          throw new Error(`JinaReader: unexpected response format for ${url}`);
        }
        if (!isJinaResponseBody(parsed) || !parsed.data) {
          throw new Error(`JinaReader: unexpected response format for ${url}`);
        }
        const data = parsed.data;
        if (typeof data.content !== 'string' || data.content.length === 0) {
          throw new Error(`JinaReader: no content in response for ${url}`);
        }
        const result: JinaResult = {
          url: typeof data.url === 'string' && data.url.length > 0 ? data.url : url,
          raw_text: data.content,
          word_count: countWords(data.content),
        };
        if (typeof data.title === 'string' && data.title.length > 0) result.title = data.title;
        if (typeof data.author === 'string' && data.author.length > 0) result.author = data.author;
        return result;
      }

      const bodyText = await response.body.text().catch(() => '');

      if (statusCode === 429) {
        if (attempt >= maxRetries) {
          throw new Error(`JinaReader: rate limited (429) after ${maxRetries} retries: ${bodyText}`);
        }
        const retryAfterMs = parseRetryAfter(response.headers['retry-after']);
        const waitMs = retryAfterMs ?? 2 ** attempt * 1000;
        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      if (statusCode >= 500 && statusCode < 600) {
        if (attempt >= maxRetries) {
          throw new Error(`JinaReader: server error ${statusCode} after ${maxRetries} retries: ${bodyText}`);
        }
        const waitMs = 2 ** attempt * 1000;
        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      throw new Error(`JinaReader: HTTP ${statusCode} fetching ${url}: ${bodyText}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isRetryError =
        error.message.startsWith('JinaReader: rate limited') ||
        error.message.startsWith('JinaReader: server error');
      if (error.message.startsWith('JinaReader:') && !isRetryError) {
        throw error;
      }
      if (isRetryError) {
        throw error;
      }
      lastError = new Error(`JinaReader: network error fetching ${url}: ${error.message}`);
      if (attempt >= maxRetries) throw lastError;
      const waitMs = 2 ** attempt * 1000;
      await sleep(waitMs);
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`JinaReader: exhausted retries fetching ${url}`);
}
