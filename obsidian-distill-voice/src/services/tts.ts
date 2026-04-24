import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SpeakOptions {
  text: string;
  voice: string;
  rate: number;
}

export async function speakWithMacOS(options: SpeakOptions): Promise<void> {
  const args: string[] = [];
  if (options.voice.trim().length > 0) {
    args.push('-v', options.voice.trim());
  }
  if (options.rate > 0) {
    args.push('-r', String(Math.round(options.rate)));
  }
  args.push('--', options.text);

  await execFileAsync('say', args);
}

export function isMacOSSayAvailable(): boolean {
  return process.platform === 'darwin';
}
