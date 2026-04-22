import { request } from 'undici';
import type { Fetcher, Article, FetcherBurnConfig, Tier } from '../types.js';
import { fetchViaJina } from './jina.js';

const SUPABASE_URL = 'https://juqtxylquemiuvvmgbej.supabase.co';
const ANON_KEY = 'sb_publishable_reVgmmCC6ndIo6jFRMM2LQ_wujj5FrO';
const EXCHANGE_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 30_000;
const BOOKMARK_LIST_PATH =
  '/rest/v1/bookmarks?select=title,url,platform,status,created_at,content_metadata&status=in.(read,absorbed,ash,active)&order=created_at.desc&limit=200';

interface BurnBookmark {
  title?: string | null;
  url: string;
  platform?: string | null;
  status?: string | null;
  created_at: string;
  content_metadata?: unknown;
}

interface ExchangeResponse {
  access_token?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExchangeResponse(value: unknown): value is ExchangeResponse {
  if (!isRecord(value)) return false;
  const token = value.access_token;
  return token === undefined || typeof token === 'string';
}

function isBurnBookmark(value: unknown): value is BurnBookmark {
  if (!isRecord(value)) return false;
  if (typeof value.url !== 'string' || value.url.length === 0) return false;
  if (typeof value.created_at !== 'string' || value.created_at.length === 0) return false;
  return true;
}

export class BurnFetcher implements Fetcher {
  readonly name = 'burn';
  readonly tier: Tier = 2;

  constructor(private readonly cfg: FetcherBurnConfig) {}

  async fetch(): Promise<Article[]> {
    const envVarName = this.cfg.mcp_token_env;
    const mcpToken = process.env[envVarName];
    if (!mcpToken || mcpToken.length === 0) {
      throw new Error(
        `BurnFetcher: Missing env var ${envVarName}. Get your MCP token at https://www.burn451.cloud/settings/mcp`,
      );
    }

    const jwt = await this.exchangeMcpToken(mcpToken);
    const bookmarks = await this.listBookmarks(jwt);

    const cutoffMs = Date.now() - this.cfg.since_hours * 3600 * 1000;
    const recent = bookmarks.filter((b) => {
      const ts = Date.parse(b.created_at);
      return Number.isFinite(ts) && ts >= cutoffMs;
    });

    const articles: Article[] = [];
    for (const bookmark of recent) {
      try {
        const enriched = await fetchViaJina(bookmark.url);
        const title =
          bookmark.title && bookmark.title.length > 0 ? bookmark.title : enriched.title;
        const article: Article = {
          url: bookmark.url,
          raw_text: enriched.raw_text,
          word_count: enriched.word_count,
          language: undefined,
          fetched_at: new Date().toISOString(),
          source_adapter: 'burn',
        };
        if (title) article.title = title;
        if (enriched.author) article.author = enriched.author;
        articles.push(article);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        console.error(`BurnFetcher: failed to enrich ${bookmark.url} (${cause})`);
      }
    }

    return articles;
  }

  private async exchangeMcpToken(mcpToken: string): Promise<string> {
    const endpoint = `${this.cfg.api_base}/api/mcp-exchange`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token: mcpToken }),
        signal: controller.signal,
      });

      const { statusCode } = response;

      if (statusCode < 200 || statusCode >= 300) {
        const bodyText = await response.body.text().catch(() => '');
        throw new Error(
          `BurnFetcher: MCP exchange failed with HTTP ${statusCode}: ${bodyText}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = await response.body.json();
      } catch {
        throw new Error('BurnFetcher: MCP exchange returned invalid JSON');
      }

      if (!isExchangeResponse(parsed) || typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
        throw new Error('BurnFetcher: MCP exchange returned no access_token');
      }

      return parsed.access_token;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('BurnFetcher:')) {
        throw err;
      }
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`BurnFetcher: MCP exchange request failed (${cause})`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async listBookmarks(jwt: string): Promise<BurnBookmark[]> {
    const endpoint = `${SUPABASE_URL}${BOOKMARK_LIST_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

    try {
      const response = await request(endpoint, {
        method: 'GET',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const { statusCode } = response;

      if (statusCode < 200 || statusCode >= 300) {
        const bodyText = await response.body.text().catch(() => '');
        throw new Error(
          `BurnFetcher: bookmark list failed with HTTP ${statusCode}: ${bodyText}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = await response.body.json();
      } catch {
        throw new Error('BurnFetcher: bookmark list returned invalid JSON');
      }

      if (!Array.isArray(parsed)) {
        throw new Error('BurnFetcher: bookmark list response was not an array');
      }

      const bookmarks: BurnBookmark[] = [];
      for (const entry of parsed) {
        if (isBurnBookmark(entry)) bookmarks.push(entry);
      }
      return bookmarks;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('BurnFetcher:')) {
        throw err;
      }
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`BurnFetcher: bookmark list request failed (${cause})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
