import chalk from 'chalk';
import type { LLMBackend } from '../types.js';
import { AnthropicAdapter } from './anthropic.js';
import { ClaudeCodeAdapter } from './claude-code.js';

export interface GetLLMOptions {
  backend?: string;
  model?: string;
}

function resolveBackend(opts?: GetLLMOptions): string {
  if (opts?.backend && opts.backend.trim().length > 0) {
    return opts.backend;
  }
  const envBackend = process.env.DISTILL_LLM_BACKEND;
  if (envBackend && envBackend.trim().length > 0) {
    return envBackend;
  }
  return 'claude-code';
}

export function getLLMAdapter(opts?: GetLLMOptions): LLMBackend {
  const backend = resolveBackend(opts);

  switch (backend) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'anthropic':
    case 'anthropic-api':
      return new AnthropicAdapter({ model: opts?.model });
    default:
      throw new Error(
        `Unknown LLM backend: "${backend}". Supported: claude-code, anthropic. Set DISTILL_LLM_BACKEND env var or pass --llm-backend.`,
      );
  }
}

export async function printLLMStatus(backend?: string): Promise<void> {
  let resolved: string;
  try {
    resolved = resolveBackend({ backend });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ ${message}`));
    return;
  }

  if (resolved === 'claude-code') {
    const adapter = new ClaudeCodeAdapter();
    const available = await adapter.isAvailable();
    if (available) {
      console.log(chalk.green(`✓ claude-code: ready ('claude' binary found in PATH)`));
    } else {
      console.log(
        chalk.red(
          `✗ claude-code: 'claude' binary not found in PATH. Install: https://claude.com/product/claude-code`,
        ),
      );
    }
    return;
  }

  if (resolved === 'anthropic' || resolved === 'anthropic-api') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (key && key.trim().length > 0) {
      console.log(chalk.green(`✓ anthropic: ready (ANTHROPIC_API_KEY set)`));
    } else {
      console.log(
        chalk.yellow(
          `⚠ anthropic: ANTHROPIC_API_KEY not set. Get a key at https://console.anthropic.com/settings/keys`,
        ),
      );
    }
    return;
  }

  console.log(
    chalk.red(
      `✗ Unknown LLM backend: "${resolved}". Supported: claude-code, anthropic.`,
    ),
  );
}
