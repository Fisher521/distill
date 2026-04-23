import { describe, expect, it } from 'vitest';
import { parseRobustJSON, repairJSON } from '../src/utils/json-extract.js';

describe('repairJSON', () => {
  it('escapes raw newlines inside string values', () => {
    const parsed = parseRobustJSON<{ tldr: string }>(`{"tldr":"foo
bar"}`);
    expect(parsed.tldr).toBe('foo\nbar');
  });

  it('escapes bare double quotes inside string values', () => {
    const repaired = repairJSON('{"pull_quotes":["she said "no" yesterday"]}');
    const parsed = JSON.parse(repaired) as { pull_quotes: string[] };
    expect(parsed.pull_quotes[0]).toBe('she said "no" yesterday');
  });

  it('repairs extracted JSON when the model wraps it in prose', () => {
    const parsed = parseRobustJSON<{ tldr: string }>(`Here is the JSON:

{"tldr":"foo
bar"}`);
    expect(parsed.tldr).toBe('foo\nbar');
  });

  it('escapes invalid backslashes inside string values', () => {
    const repaired = repairJSON(String.raw`{"path":"C:\Users\distill\work"}`);
    const parsed = JSON.parse(repaired) as { path: string };
    expect(parsed.path).toBe(String.raw`C:\Users\distill\work`);
  });
});
