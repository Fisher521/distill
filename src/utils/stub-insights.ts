import type { Article, ClaudeInsights } from '../types.js';

export function buildStubInsights(article: Article): ClaudeInsights {
  const preview = article.raw_text.slice(0, 200).replace(/\s+/g, ' ').trim();
  return {
    tldr: `⚠️ stub: LLM analysis pending (Wave 2). Preview: ${preview}${article.raw_text.length > 200 ? '...' : ''}`,
    why_read: '(pending — real analysis in Wave 2 with LLM integration)',
    pull_quotes: [],
    callouts: [],
    todo_drafts: [],
  };
}
