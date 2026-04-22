import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Fetcher, Article, Tier } from '../types.js';
import { fetchViaJina } from './jina.js';

export interface LocalFileFetcherOptions {
  path: string;
}

export class LocalFileFetcher implements Fetcher {
  readonly name = 'local-file';
  readonly tier: Tier = 1;

  constructor(private readonly opts: LocalFileFetcherOptions) {}

  async fetch(): Promise<Article[]> {
    const absolutePath = resolve(this.opts.path);
    let contents: string;
    try {
      contents = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`LocalFileFetcher: cannot read ${absolutePath} (${cause})`);
    }

    const lines = contents.split(/\r?\n/);
    const urls: string[] = [];
    const seen = new Set<string>();
    let skippedCount = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) continue;

      let parsed: URL;
      try {
        parsed = new URL(line);
      } catch {
        console.error(`LocalFileFetcher: skipping invalid URL "${line}"`);
        continue;
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        skippedCount++;
        console.error(`[local-file] skipping non-HTTP URL: ${line}`);
        continue;
      }

      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    }

    if (skippedCount > 0) {
      console.error(`[local-file] skipped ${skippedCount} non-HTTP URL${skippedCount === 1 ? '' : 's'}`);
    }

    const articles: Article[] = [];

    for (const url of urls) {
      try {
        const result = await fetchViaJina(url);
        articles.push({
          url,
          title: result.title,
          author: result.author,
          raw_text: result.raw_text,
          word_count: result.word_count,
          fetched_at: new Date().toISOString(),
          source_adapter: 'local-file',
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        console.error(`LocalFileFetcher: failed to fetch ${url} (${cause})`);
      }
    }

    return articles;
  }
}
