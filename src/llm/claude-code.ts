import { spawn } from 'node:child_process';
import type { LLMBackend, Tier } from '../types.js';

export interface ClaudeCodeAdapterOptions {
  claudeBinary?: string;
  timeout?: number;
}

export class ClaudeCodeAdapter implements LLMBackend {
  readonly name = 'claude-code';
  readonly tier: Tier = 2;

  constructor(private readonly opts?: ClaudeCodeAdapterOptions) {}

  async generate(user: string, system?: string): Promise<string> {
    const binary = this.opts?.claudeBinary ?? 'claude';
    const timeout = this.opts?.timeout ?? 300000;
    const fullPrompt = system ? `[System]\n${system}\n\n[User]\n${user}` : user;

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn(binary, ['-p', fullPrompt], { timeout });

      let stdout = '';
      let stderr = '';
      let settled = false;

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              "ClaudeCodeAdapter: 'claude' binary not found in PATH. Install Claude Code: https://claude.com/product/claude-code",
            ),
          );
          return;
        }
        reject(new Error(`ClaudeCodeAdapter: ${err.message}`));
      });

      proc.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (code === null && signal === 'SIGTERM') {
          reject(new Error(`ClaudeCodeAdapter: timed out after ${timeout}ms`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`ClaudeCodeAdapter: exit code ${code}\n${stderr}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    const binary = this.opts?.claudeBinary ?? 'claude';
    return await new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(binary, ['--version'], { timeout: 10000 });
        let settled = false;
        proc.on('error', () => {
          if (settled) return;
          settled = true;
          resolve(false);
        });
        proc.on('close', (code) => {
          if (settled) return;
          settled = true;
          resolve(code === 0);
        });
        proc.stdout?.on('data', () => {});
        proc.stderr?.on('data', () => {});
      } catch {
        resolve(false);
      }
    });
  }
}
