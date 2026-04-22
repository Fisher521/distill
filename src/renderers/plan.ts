import { TriageDecision } from '../types.js';
import type { TriagedArticle, TriagePlan } from '../types.js';

function deriveDate(generatedAt: string): string {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return generatedAt.slice(0, 10);
  }
  const y = parsed.getUTCFullYear().toString().padStart(4, '0');
  const m = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = parsed.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function titleOrFallback(article: TriagedArticle): string {
  if (article.title && article.title.trim().length > 0) {
    return article.title.trim();
  }
  return '(untitled)';
}

function findIndex(
  articles: TriagedArticle[],
  target: TriagedArticle,
): number {
  return articles.indexOf(target);
}

export function renderPlan(plan: TriagePlan): string {
  const { articles, generated_at } = plan;
  const date = deriveDate(generated_at);

  const read: TriagedArticle[] = [];
  const delegate: TriagedArticle[] = [];
  const cluster: TriagedArticle[] = [];
  const skip: TriagedArticle[] = [];

  for (const article of articles) {
    switch (article.decision) {
      case TriageDecision.READ:
        read.push(article);
        break;
      case TriageDecision.DELEGATE:
        delegate.push(article);
        break;
      case TriageDecision.CLUSTER:
        cluster.push(article);
        break;
      case TriageDecision.SKIP:
        skip.push(article);
        break;
    }
  }

  const lines: string[] = [];

  lines.push('---');
  lines.push(`generated_at: ${generated_at}`);
  lines.push(`article_count: ${articles.length}`);
  lines.push('distill_version: 0.1.0-alpha');
  lines.push('---');
  lines.push('');
  lines.push(`# Reading Plan · ${date}`);
  lines.push('');
  lines.push(`${articles.length} articles pulled from your last 24h bookmarks.`);
  lines.push('');

  if (read.length > 0) {
    lines.push(`## 🔥 READ (${read.length})`);
    lines.push('');
    for (const article of read) {
      const i = findIndex(articles, article);
      lines.push(`### [${i}] ${titleOrFallback(article)}`);
      lines.push(`- **URL**: ${article.url}`);
      lines.push(
        `- **Length**: ${typeof article.word_count === 'number' ? article.word_count : 0} words`,
      );
      lines.push(`- **Why**: ${getRationale(article)}`);
      lines.push('');
    }
  }

  if (delegate.length > 0) {
    lines.push(`## 🤖 DELEGATE (${delegate.length})`);
    lines.push('');
    lines.push(
      '(Claude will pre-digest these; you\'ll see the output in ~/.distill/.../*.md)',
    );
    lines.push('');
    for (const article of delegate) {
      const i = findIndex(articles, article);
      lines.push(`### [${i}] ${titleOrFallback(article)}`);
      lines.push(`- **URL**: ${article.url}`);
      lines.push(
        `- **Length**: ${typeof article.word_count === 'number' ? article.word_count : 0} words`,
      );
      lines.push(`- **Why**: ${getRationale(article)}`);
      lines.push('');
    }
  }

  if (cluster.length > 0) {
    const groups = new Map<string, TriagedArticle[]>();
    for (const article of cluster) {
      const key = article.cluster_id ?? '_';
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(article);
      } else {
        groups.set(key, [article]);
      }
    }

    lines.push(`## 🔗 CLUSTER (${cluster.length})`);
    lines.push('');

    const orderedKeys = Array.from(groups.keys()).sort();
    for (const key of orderedKeys) {
      const members = groups.get(key);
      if (!members || members.length === 0) continue;
      lines.push(`### Cluster ${key}`);
      for (const member of members) {
        const i = findIndex(articles, member);
        lines.push(`- [${i}] ${titleOrFallback(member)}`);
      }
      const firstMember = members[0];
      if (firstMember) {
        lines.push(`**Why grouped**: ${getRationale(firstMember)}`);
      }
      lines.push('');
    }
  }

  if (skip.length > 0) {
    lines.push(`## 🗑️ SKIP (${skip.length})`);
    lines.push('');
    for (const article of skip) {
      const i = findIndex(articles, article);
      lines.push(
        `- [${i}] ${titleOrFallback(article)} — ${getRationale(article)}`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**Next steps**');
  lines.push('- Read READ articles fully');
  lines.push(
    '- Delegate DELEGATE to Claude (run `distill delegate --plan _PLAN.md`) — coming in Wave 3',
  );
  lines.push('- Skim CLUSTER groups together');
  lines.push('- SKIP are already in ash');
  lines.push('');

  return lines.join('\n');
}

function getRationale(article: TriagedArticle): string {
  const anyArticle = article as TriagedArticle & { rationale?: string };
  if (typeof anyArticle.rationale === 'string' && anyArticle.rationale.trim().length > 0) {
    return anyArticle.rationale.trim();
  }
  return '(no rationale)';
}
