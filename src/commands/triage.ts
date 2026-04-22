import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { LocalFileFetcher } from '../fetchers/local-file.js';
import { BurnFetcher } from '../fetchers/burn.js';
import { buildTriagePrompt } from '../prompts/triage.js';
import { renderPlan } from '../renderers/plan.js';
import { getLLMAdapter } from '../llm/index.js';
import { parseRobustJSON } from '../utils/json-extract.js';
import { TriageDecision } from '../types.js';
import type {
  Article,
  Config,
  FetcherBurnConfig,
  LLMBackendName,
  TriagedArticle,
  TriagePlan,
} from '../types.js';

interface TriageCommandOptions {
  source: string;
  input: string;
  outputDir: string;
  llmBackend?: string;
  maxRead: string;
  maxDelegate: string;
  dryRun?: boolean;
}

interface RawDecision {
  article_index: number;
  decision: string;
  cluster_id: string | null;
  rationale: string;
}

interface DecisionsEnvelope {
  decisions: RawDecision[];
}

function expandHome(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  if (path === '~') return homedir();
  return path;
}

function isValidRawDecision(value: unknown): value is RawDecision {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (typeof d.article_index !== 'number' || !Number.isFinite(d.article_index)) return false;
  if (typeof d.decision !== 'string') return false;
  if (d.cluster_id !== null && typeof d.cluster_id !== 'string') return false;
  if (typeof d.rationale !== 'string') return false;
  return true;
}

function parseDecisions(raw: string): DecisionsEnvelope {
  let parsed: unknown;
  try {
    parsed = parseRobustJSON(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse LLM decisions JSON (${cause})`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { decisions?: unknown }).decisions)) {
    throw new Error('Failed to parse LLM decisions JSON (response did not contain a decisions array)');
  }

  const decisionsRaw = (parsed as { decisions: unknown[] }).decisions;
  const decisions: RawDecision[] = [];
  for (let i = 0; i < decisionsRaw.length; i++) {
    const entry = decisionsRaw[i];
    if (isValidRawDecision(entry)) {
      decisions.push(entry);
    } else {
      console.error(
        chalk.yellow(`[triage] warning: dropping malformed decision entry at position ${i}`),
      );
    }
  }
  return { decisions };
}

function normalizeDecision(value: string): TriageDecision | null {
  const upper = value.trim().toUpperCase();
  switch (upper) {
    case 'READ':
      return TriageDecision.READ;
    case 'DELEGATE':
      return TriageDecision.DELEGATE;
    case 'CLUSTER':
      return TriageDecision.CLUSTER;
    case 'SKIP':
      return TriageDecision.SKIP;
    default:
      return null;
  }
}

function mergeDecisions(
  articles: Article[],
  envelope: DecisionsEnvelope,
): TriagedArticle[] {
  const byIndex = new Map<number, RawDecision>();
  for (const d of envelope.decisions) {
    if (
      typeof d.article_index !== 'number' ||
      !Number.isInteger(d.article_index) ||
      d.article_index < 0 ||
      d.article_index >= articles.length
    ) {
      console.error(
        chalk.yellow(
          `[triage] warning: dropping decision with out-of-range index ${d.article_index} (articles.length=${articles.length})`,
        ),
      );
      continue;
    }
    if (byIndex.has(d.article_index)) {
      console.error(
        chalk.yellow(
          `[triage] warning: duplicate decision for index ${d.article_index}; keeping first occurrence`,
        ),
      );
      continue;
    }
    byIndex.set(d.article_index, d);
  }

  const merged: TriagedArticle[] = [];
  articles.forEach((article, i) => {
    const raw = byIndex.get(i);
    let decision: TriageDecision = TriageDecision.SKIP;
    let clusterId: string | undefined;
    let rationale = '(no decision returned by LLM)';

    if (raw) {
      const normalized = normalizeDecision(raw.decision);
      if (normalized) {
        decision = normalized;
      } else {
        console.error(
          chalk.yellow(
            `[triage] warning: unknown decision "${raw.decision}" at index ${i}; defaulting to SKIP`,
          ),
        );
      }
      if (
        decision === TriageDecision.CLUSTER &&
        typeof raw.cluster_id === 'string' &&
        raw.cluster_id.trim().length > 0
      ) {
        clusterId = raw.cluster_id.trim();
      }
      if (typeof raw.rationale === 'string' && raw.rationale.trim().length > 0) {
        rationale = raw.rationale.trim();
      }
    } else {
      console.error(
        chalk.yellow(
          `[triage] warning: no decision for article index ${i}; defaulting to SKIP`,
        ),
      );
    }

    const triaged: TriagedArticle & { rationale: string } = {
      ...article,
      decision,
      rationale,
    };
    if (clusterId) {
      triaged.cluster_id = clusterId;
    }
    merged.push(triaged);
  });

  const clusterCounts = new Map<string, number>();
  for (const triaged of merged) {
    if (triaged.decision === TriageDecision.CLUSTER && triaged.cluster_id) {
      clusterCounts.set(
        triaged.cluster_id,
        (clusterCounts.get(triaged.cluster_id) ?? 0) + 1,
      );
    }
  }
  for (const triaged of merged) {
    if (
      triaged.decision === TriageDecision.CLUSTER &&
      (!triaged.cluster_id || (clusterCounts.get(triaged.cluster_id) ?? 0) < 2)
    ) {
      console.error(
        chalk.yellow(
          `[triage] warning: singleton cluster "${triaged.cluster_id ?? ''}" demoted to SKIP`,
        ),
      );
      triaged.decision = TriageDecision.SKIP;
      delete triaged.cluster_id;
    }
  }

  return merged;
}

function summaryCounts(articles: TriagedArticle[]): {
  read: number;
  delegate: number;
  cluster: number;
  skip: number;
  clusterGroups: number;
} {
  let read = 0;
  let delegate = 0;
  let cluster = 0;
  let skip = 0;
  const groups = new Set<string>();
  for (const a of articles) {
    switch (a.decision) {
      case TriageDecision.READ:
        read++;
        break;
      case TriageDecision.DELEGATE:
        delegate++;
        break;
      case TriageDecision.CLUSTER:
        cluster++;
        if (a.cluster_id) groups.add(a.cluster_id);
        break;
      case TriageDecision.SKIP:
        skip++;
        break;
    }
  }
  return { read, delegate, cluster, skip, clusterGroups: groups.size };
}

function todayDir(iso: string): string {
  const parsed = new Date(iso);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const y = base.getUTCFullYear().toString().padStart(4, '0');
  const m = (base.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = base.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function runTriage(options: TriageCommandOptions): Promise<void> {
  const maxRead = Number.parseInt(options.maxRead, 10);
  const maxDelegate = Number.parseInt(options.maxDelegate, 10);

  if (!Number.isFinite(maxRead) || maxRead < 0) {
    console.error(chalk.red(`Invalid --max-read: ${options.maxRead}`));
    process.exit(1);
  }
  if (!Number.isFinite(maxDelegate) || maxDelegate < 0) {
    console.error(chalk.red(`Invalid --max-delegate: ${options.maxDelegate}`));
    process.exit(1);
  }

  const fetchSpinner = ora(`Fetching articles from ${options.source}...`).start();
  let articles: Article[];
  try {
    if (options.source === 'local') {
      const fetcher = new LocalFileFetcher({ path: options.input });
      articles = await fetcher.fetch();
    } else if (options.source === 'burn') {
      const burnCfg: FetcherBurnConfig = {
        mcp_token_env: 'BURN_MCP_TOKEN',
        api_base: 'https://api.burn451.cloud',
        since_hours: 24,
      };
      const fetcher = new BurnFetcher(burnCfg);
      articles = await fetcher.fetch();
    } else {
      fetchSpinner.fail(`Unknown --source: ${options.source}`);
      process.exit(1);
      return;
    }
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    fetchSpinner.fail(`Fetch failed: ${cause}`);
    process.exit(1);
    return;
  }

  if (articles.length === 0) {
    fetchSpinner.warn('No articles fetched — nothing to triage.');
    process.exit(1);
    return;
  }
  fetchSpinner.succeed(`Fetched ${articles.length} articles.`);

  const triageSpinner = ora('Building triage prompt and calling LLM...').start();
  const { system, user } = buildTriagePrompt(articles, {
    maxRead,
    maxDelegate,
  });

  let llmRaw: string;
  try {
    const backendOpt = options.llmBackend
      ? { backend: options.llmBackend as LLMBackendName }
      : undefined;
    const adapter = getLLMAdapter(backendOpt);
    llmRaw = await adapter.generate(user, system);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    triageSpinner.fail(`LLM call failed: ${cause}`);
    process.exit(1);
    return;
  }

  let envelope: DecisionsEnvelope;
  try {
    envelope = parseDecisions(llmRaw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    triageSpinner.fail(`Decision parsing failed: ${cause}`);
    process.exit(1);
    return;
  }

  const triagedArticles = mergeDecisions(articles, envelope);
  triageSpinner.succeed('Triage complete.');

  const generatedAt = new Date().toISOString();
  const plan: TriagePlan = {
    articles: triagedArticles,
    generated_at: generatedAt,
    config_snapshot: {} as Config,
  };

  const markdown = renderPlan(plan);
  const counts = summaryCounts(triagedArticles);
  const summary = `${chalk.green('✓')} Triage complete: ${chalk.bold(
    counts.read.toString(),
  )} READ, ${chalk.bold(counts.delegate.toString())} DELEGATE, ${chalk.bold(
    counts.clusterGroups.toString(),
  )} clusters (${counts.cluster} articles), ${chalk.bold(counts.skip.toString())} SKIP`;

  if (options.dryRun) {
    console.log(markdown);
    console.log(summary);
    return;
  }

  const outputDir = expandHome(options.outputDir);
  const dayDir = resolve(outputDir, todayDir(generatedAt));
  try {
    await mkdir(dayDir, { recursive: true });
    const outputPath = join(dayDir, '_PLAN.md');
    await writeFile(outputPath, markdown, 'utf8');
    console.log(summary);
    console.log(chalk.dim(`  → ${outputPath}`));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to write plan: ${cause}`));
    process.exit(1);
  }
}

export function registerTriageCommand(program: Command): void {
  program
    .command('triage')
    .description('Triage recent bookmarks into READ / DELEGATE / CLUSTER / SKIP')
    .option('--source <type>', 'source adapter (local | burn)', 'local')
    .option('--input <path>', 'input path for local source', './urls.txt')
    .option('--output-dir <path>', 'output directory for _PLAN.md', '~/.distill')
    .option('--llm-backend <name>', 'LLM backend name (overrides config)')
    .option('--max-read <n>', 'maximum READ decisions', '3')
    .option('--max-delegate <n>', 'maximum DELEGATE decisions', '2')
    .option('--dry-run', 'print plan to stdout instead of writing file')
    .action(async (opts: TriageCommandOptions) => {
      await runTriage(opts);
    });
}
