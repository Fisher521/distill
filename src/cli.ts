#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalFileFetcher } from './fetchers/local-file.js';
import { BurnFetcher } from './fetchers/burn.js';
import { MarkdownRenderer } from './renderers/markdown.js';
import { buildStubInsights } from './utils/stub-insights.js';
import { parseRobustJSON } from './utils/json-extract.js';
import { getLLMAdapter, printLLMStatus } from './llm/index.js';
import { buildAugmentedPrompt } from './prompts/augmented.js';
import { registerTriageCommand } from './commands/triage.js';
import type {
  Article,
  Callout,
  CalloutType,
  ClaudeInsights,
  Fetcher,
  FetcherBurnConfig,
  LLMBackend,
} from './types.js';

interface FetchOptions {
  source: string;
  input: string;
  outputDir: string;
  dryRun?: boolean;
  llmBackend?: string;
  skipLlm?: boolean;
}

interface LLMCommandOptions {
  backend?: string;
}

function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

const program = new Command();

program
  .name('distill')
  .description('Voice-first AI reading workflow')
  .version('0.1.0-alpha');

program
  .command('fetch')
  .description('Fetch articles from a source and render augmented markdown')
  .option('--source <type>', 'source adapter: local | burn (burn requires BURN_MCP_TOKEN env)', 'local')
  .option('--input <path>', 'input file path for local source', './urls.txt')
  .option('--output-dir <path>', 'where to write rendered markdown', '~/.distill')
  .option('--dry-run', 'fetch + list titles, do not write files', false)
  .option('--llm-backend <name>', 'LLM backend: claude-code | anthropic (reads DISTILL_LLM_BACKEND env if unset)')
  .option('--skip-llm', 'skip LLM analysis, write article with raw stub insights', false)
  .action(async (opts: FetchOptions) => {
    const spinner = ora('Fetching articles...').start();
    const startTime = Date.now();

    try {
      let fetcher: Fetcher;
      if (opts.source === 'local') {
        const inputPath = expandPath(opts.input);
        fetcher = new LocalFileFetcher({ path: inputPath });
      } else if (opts.source === 'burn') {
        const burnCfg: FetcherBurnConfig = {
          mcp_token_env: 'BURN_MCP_TOKEN',
          api_base: 'https://api.burn451.cloud',
          since_hours: 24,
        };
        fetcher = new BurnFetcher(burnCfg);
      } else {
        spinner.fail(`Unknown source: ${opts.source} (supported: local, burn)`);
        process.exit(1);
        return;
      }

      let llm = null;
      if (!opts.skipLlm) {
        try {
          llm = getLLMAdapter({ backend: opts.llmBackend });
        } catch (err) {
          spinner.fail('LLM init failed');
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      }

      const articles: Article[] = await fetcher.fetch();

      if (articles.length === 0) {
        spinner.fail('No articles fetched');
        console.error(chalk.red('Check that your input file contains valid http(s) URLs and that Jina Reader is reachable.'));
        process.exit(1);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      spinner.succeed(`Fetched ${articles.length} article${articles.length === 1 ? '' : 's'} in ${elapsed}s`);

      if (opts.dryRun) {
        console.log(chalk.dim('\nDry run — not writing files:'));
        for (const a of articles) {
          console.log(`  • ${a.title ?? '(untitled)'} — ${a.url}`);
        }
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const outDir = path.join(expandPath(opts.outputDir), dateStr);
      await mkdir(outDir, { recursive: true });

      const renderer = new MarkdownRenderer();
      let written = 0;
      let llmOk = 0;
      let llmFail = 0;

      for (const article of articles) {
        let insights: ClaudeInsights;

        if (llm) {
          const spinner2 = ora(`Analyzing: ${article.title ?? article.url}`).start();
          try {
            const { insights: parsedInsights, retried } = await generateInsightsWithRetry(
              llm,
              article,
            );
            insights = parsedInsights;
            spinner2.succeed(
              `Analyzed: ${article.title ?? article.url}${retried ? ' (after JSON retry)' : ''}`,
            );
            llmOk++;
          } catch (err) {
            spinner2.fail(`LLM failed for ${article.url}: ${err instanceof Error ? err.message : String(err)}`);
            llmFail++;
            continue;
          }
        } else {
          insights = buildStubInsights(article);
        }

        const md = await renderer.render(article, insights);
        const slug = renderer.toSlug(article);
        const filePath = path.join(outDir, `${slug}.md`);
        await writeFile(filePath, md, 'utf8');
        console.log(chalk.dim(`  → ${filePath}`));
        written++;
      }

      if (llm) {
        const total = llmOk + llmFail;
        console.log(chalk.cyan(`\nLLM succeeded on ${llmOk}/${total} article${total === 1 ? '' : 's'}.`));
      }

      console.log(chalk.green(`✓ Wrote ${written} article${written === 1 ? '' : 's'} to ${outDir}`));
    } catch (err) {
      spinner.fail('Fetch failed');
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

program
  .command('llm')
  .description('Show which LLM backend is active')
  .option('--backend <name>', 'check a specific backend')
  .action(async (opts: LLMCommandOptions) => {
    await printLLMStatus(opts.backend);
  });

registerTriageCommand(program);

program.action(() => {
  console.log(chalk.cyan('distill v0.1.0-alpha'));
  console.log('\nAvailable commands:');
  console.log('  fetch    Fetch articles and render augmented markdown');
  console.log('  triage   Stage 1: scan bookmarks and produce _PLAN.md');
  console.log('  llm      Show which LLM backend is active');
  console.log('\nRun `distill <command> --help` for details.');
  console.log('\nDocs: https://github.com/Fisher521/distill');
});

program.parse();

function isCalloutType(v: unknown): v is CalloutType {
  return v === 'insight' || v === 'connect' || v === 'artifact' || v === 'takeaway';
}

function validateInsightsShape(value: unknown): ClaudeInsights {
  if (typeof value !== 'object' || value === null) {
    throw new Error('insights JSON is not an object');
  }
  const obj = value as Record<string, unknown>;

  const tldr = obj.tldr;
  const whyRead = obj.why_read;
  const pullQuotes = obj.pull_quotes;
  const callouts = obj.callouts;
  const todoDrafts = obj.todo_drafts;

  if (typeof tldr !== 'string') throw new Error('insights.tldr missing or not a string');
  if (typeof whyRead !== 'string') throw new Error('insights.why_read missing or not a string');
  if (!Array.isArray(pullQuotes) || !pullQuotes.every((q) => typeof q === 'string')) {
    throw new Error('insights.pull_quotes missing or not string[]');
  }
  if (!Array.isArray(callouts)) {
    throw new Error('insights.callouts missing or not an array');
  }
  if (!Array.isArray(todoDrafts) || !todoDrafts.every((t) => typeof t === 'string')) {
    throw new Error('insights.todo_drafts missing or not string[]');
  }

  const validatedCallouts: Callout[] = callouts.map((c, i) => {
    if (typeof c !== 'object' || c === null) {
      throw new Error(`insights.callouts[${i}] is not an object`);
    }
    const cc = c as Record<string, unknown>;
    if (!isCalloutType(cc.type)) {
      throw new Error(`insights.callouts[${i}].type invalid (expected insight|connect|artifact|takeaway)`);
    }
    if (typeof cc.anchor_text !== 'string') {
      throw new Error(`insights.callouts[${i}].anchor_text missing or not a string`);
    }
    if (typeof cc.body !== 'string') {
      throw new Error(`insights.callouts[${i}].body missing or not a string`);
    }
    return { type: cc.type, anchor_text: cc.anchor_text, body: cc.body };
  });

  return {
    tldr,
    why_read: whyRead,
    pull_quotes: pullQuotes as string[],
    callouts: validatedCallouts,
    todo_drafts: todoDrafts as string[],
  };
}

function parseInsightsJSON(raw: string): ClaudeInsights {
  let parsed: unknown;
  try {
    parsed = parseRobustJSON(raw);
  } catch (err) {
    throw new Error(
      `LLM output JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateInsightsShape(parsed);
}

function buildJSONRetryPrompt(userPrompt: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `${userPrompt}

---

Your previous response failed strict JSON parsing/validation with this error:
${message}

Re-emit the same analysis, but with STRICT JSON formatting. All strings must
escape newlines as \\n and double quotes as \\". Output ONLY the JSON object.`;
}

async function generateInsightsWithRetry(
  llm: LLMBackend,
  article: Article,
): Promise<{ insights: ClaudeInsights; retried: boolean }> {
  const prompt = buildAugmentedPrompt(article);
  const raw = await llm.generate(prompt.user, prompt.system);

  try {
    return { insights: parseInsightsJSON(raw), retried: false };
  } catch (firstErr) {
    const retryUser = buildJSONRetryPrompt(prompt.user, firstErr);

    try {
      const retryRaw = await llm.generate(retryUser, prompt.system);
      return { insights: parseInsightsJSON(retryRaw), retried: true };
    } catch {
      throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    }
  }
}
