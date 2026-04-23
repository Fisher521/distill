import type {
  Article,
  Callout,
  CalloutType,
  ClaudeInsights,
  Renderer,
  Tier,
} from '../types.js';

function yamlString(val: unknown): string {
  if (val === undefined || val === null || val === '') return '""';
  const s = String(val);
  const needsQuote = /[:#\-&*!|>"'@%\r\n\t`]/.test(s) || s.includes('---') || s.startsWith(' ') || s.endsWith(' ');
  if (!needsQuote) return s;
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

interface CalloutStyle {
  admonition: string;
  emoji: string;
  label: string;
}

const CALLOUT_STYLES: Record<CalloutType, CalloutStyle> = {
  insight: { admonition: 'note', emoji: '💡', label: 'Insight' },
  connect: { admonition: 'info', emoji: '🔗', label: 'Connect' },
  artifact: { admonition: 'tip', emoji: '📊', label: 'Artifact' },
  takeaway: { admonition: 'important', emoji: '🎯', label: 'Takeaway' },
};

const SLUG_MAX = 60;

function renderCallout(callout: Callout): string {
  const style = CALLOUT_STYLES[callout.type];
  const bodyLines = callout.body.split('\n').map((line) => `> ${line}`).join('\n');
  return `> [!${style.admonition}] ${style.emoji} ${style.label}\n${bodyLines}`;
}

function stripJunk(text: string): string {
  let out = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  out = out.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const lines = out.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      kept.push(line);
      continue;
    }
    const linkOnly = /^\[[^\]]*\]\([^)]*\)(\s*\[[^\]]*\]\([^)]*\))*\s*$/.test(trimmed);
    if (linkOnly) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

const CHUNK_THRESHOLD = 600;
const SENTENCES_PER_CHUNK = 3;
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z"'(\[])/;

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s/.test(line.trim());
}

function chunkBySentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (isHeadingLine(trimmed)) return [trimmed];
  if (trimmed.length <= CHUNK_THRESHOLD) return [trimmed];
  const sentences = trimmed.split(SENTENCE_SPLIT);
  if (sentences.length <= SENTENCES_PER_CHUNK) return [trimmed];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_CHUNK) {
    const chunk = sentences.slice(i, i + SENTENCES_PER_CHUNK).join(' ').replace(/\s+/g, ' ').trim();
    if (chunk) out.push(chunk);
  }
  return out.length > 0 ? out : [trimmed];
}

function splitIntoParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.trim().length === 0) return [];

  if (/\n{2,}/.test(normalized)) {
    const parts = normalized.split(/\n{2,}/);
    const paragraphs: string[] = [];
    for (const raw of parts) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const lines = trimmed.split('\n');
      let buffer: string[] = [];
      for (const line of lines) {
        if (isHeadingLine(line)) {
          if (buffer.length > 0) {
            paragraphs.push(buffer.join('\n'));
            buffer = [];
          }
          paragraphs.push(line.trim());
        } else {
          buffer.push(line);
        }
      }
      if (buffer.length > 0) paragraphs.push(buffer.join('\n'));
    }
    const collapsed = paragraphs.map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter((p) => p.length > 0);
    return collapsed.flatMap(chunkBySentences);
  }

  const collapsed = normalized.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return [];
  const headingMatches = collapsed.match(/^(#{1,6}\s+\S[^\n]*?)(\s+)(?=[A-Z"'(])/);
  let leadHeading: string | null = null;
  let body = collapsed;
  if (headingMatches && headingMatches[1]) {
    leadHeading = headingMatches[1].trim();
    body = collapsed.slice(headingMatches[0].length);
  }
  const paragraphs: string[] = [];
  if (leadHeading) paragraphs.push(leadHeading);
  paragraphs.push(...chunkBySentences(body));
  if (paragraphs.length === 0) paragraphs.push(collapsed);
  return paragraphs;
}

function normalizeForAnchor(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraphContainsAnchor(paragraph: string, anchor: string): boolean {
  const anchorNorm = normalizeForAnchor(anchor);
  if (anchorNorm.length === 0) return false;
  return normalizeForAnchor(paragraph).includes(anchorNorm);
}

function buildFrontmatter(article: Article): string {
  const lines: string[] = ['---'];
  lines.push(`url: ${yamlString(article.url)}`);
  if (article.title !== undefined) lines.push(`title: ${yamlString(article.title)}`);
  if (article.author !== undefined) lines.push(`author: ${yamlString(article.author)}`);
  if (article.language !== undefined) lines.push(`language: ${yamlString(article.language)}`);
  lines.push(`fetched_at: ${yamlString(article.fetched_at)}`);
  if (article.word_count !== undefined) lines.push(`word_count: ${article.word_count}`);
  lines.push(`source_adapter: ${yamlString(article.source_adapter)}`);
  lines.push(`distill_version: "0.1.0-alpha"`);
  lines.push('---');
  return lines.join('\n');
}

function renderTldr(tldr: string): string {
  const trimmed = tldr.trim();
  if (trimmed.startsWith('⚠️ taste-thin:')) {
    return `*${trimmed}*`;
  }
  return trimmed;
}

function renderPullQuotes(quotes: string[]): string | null {
  const cleaned = quotes.map((q) => q.trim()).filter((q) => q.length > 0);
  if (cleaned.length === 0) return null;
  const body = cleaned
    .map((q) => {
      const lines = q.split('\n').map((line) => `> ${line}`).join('\n');
      return lines;
    })
    .join('\n>\n');
  return `## 🔥 Pull Quotes\n\n${body}`;
}

function renderTodos(todos: string[]): string | null {
  const cleaned = todos.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return null;
  const body = cleaned.map((t) => `- [ ] ${t}`).join('\n');
  return `## 📋 Todo Drafts\n\n${body}`;
}

function renderAugmented(article: Article, callouts: Callout[]): string {
  const paragraphs = splitIntoParagraphs(stripJunk(article.raw_text));
  const used = new Set<number>();
  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    blocks.push(paragraph);
    for (let i = 0; i < callouts.length; i++) {
      if (used.has(i)) continue;
      const callout = callouts[i];
      if (!callout) continue;
      if (paragraphContainsAnchor(paragraph, callout.anchor_text)) {
        blocks.push(renderCallout(callout));
        used.add(i);
      }
    }
  }

  const unanchored: Callout[] = [];
  for (let i = 0; i < callouts.length; i++) {
    if (!used.has(i)) {
      const callout = callouts[i];
      if (callout) unanchored.push(callout);
    }
  }

  let section = `## 📖 Augmented Reading\n\n${blocks.join('\n\n')}`;
  if (unanchored.length > 0) {
    const unanchoredBody = unanchored.map(renderCallout).join('\n\n');
    section += `\n\n### 📌 Unanchored Callouts\n\n${unanchoredBody}`;
  }
  return section;
}

const SLUG_KEEP_RE = /[\p{L}\p{N}]/u;

function sanitizeSlugSource(source: string): string {
  let out = '';
  for (const ch of source.normalize('NFC')) {
    if (SLUG_KEEP_RE.test(ch)) {
      out += ch.toLowerCase();
    } else if (ch === '-' || ch === '_') {
      out += ch;
    } else {
      out += '-';
    }
  }
  return out;
}

function shortUrlHash(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function collapseHyphens(input: string): string {
  let out = '';
  let prevHyphen = false;
  for (const ch of input) {
    if (ch === '-') {
      if (!prevHyphen) out += ch;
      prevHyphen = true;
    } else {
      out += ch;
      prevHyphen = false;
    }
  }
  return out;
}

function trimHyphens(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input[start] === '-') start++;
  while (end > start && input[end - 1] === '-') end--;
  return input.slice(start, end);
}

function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastHyphen = cut.lastIndexOf('-');
  if (lastHyphen > Math.floor(max * 0.5)) {
    return trimHyphens(cut.slice(0, lastHyphen));
  }
  return trimHyphens(cut);
}

function firstWords(text: string, n: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';
  const words = normalized.split(' ');
  return words.slice(0, n).join(' ');
}

function lastPathSegment(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter((p) => p.length > 0);
    return parts.length > 0 ? (parts[parts.length - 1] ?? '') : parsed.hostname;
  } catch {
    return '';
  }
}

export class MarkdownRenderer implements Renderer {
  readonly name = 'markdown';
  readonly tier: Tier = 1;

  async render(article: Article, insights: ClaudeInsights): Promise<string> {
    const frontmatter = buildFrontmatter(article);
    const heading = `# ${article.title && article.title.trim().length > 0 ? article.title : 'Untitled'}`;
    const sourceLine = `**Source**: [${article.url}](${article.url}) · by ${
      article.author && article.author.trim().length > 0 ? article.author : 'unknown'
    }`;

    const sections: string[] = [];
    sections.push(frontmatter);
    sections.push(heading);
    sections.push(sourceLine);
    sections.push('---');
    sections.push(`## 🎯 TL;DR\n\n${renderTldr(insights.tldr)}`);
    sections.push(`## 💡 Why Read (for you)\n\n${insights.why_read.trim()}`);

    const pullQuotes = renderPullQuotes(insights.pull_quotes);
    if (pullQuotes) sections.push(pullQuotes);

    sections.push('---');
    sections.push(renderAugmented(article, insights.callouts));
    sections.push('---');

    const todos = renderTodos(insights.todo_drafts);
    if (todos) sections.push(todos);

    return sections.join('\n\n') + '\n';
  }

  toSlug(article: Article): string {
    let source = '';
    if (article.title && article.title.trim().length > 0) {
      source = article.title.trim();
    } else if (article.raw_text && article.raw_text.trim().length > 0) {
      source = firstWords(article.raw_text, 8);
    } else {
      source = lastPathSegment(article.url);
    }

    if (source.length === 0) source = 'untitled';

    const sanitized = sanitizeSlugSource(source);
    const collapsed = collapseHyphens(sanitized);
    const trimmed = trimHyphens(collapsed);
    const truncated = truncateSlug(trimmed, SLUG_MAX);
    if (truncated.length > 0) return truncated;
    return `untitled-${shortUrlHash(article.url)}`;
  }
}
