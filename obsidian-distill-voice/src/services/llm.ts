import { buildInteractiveCalloutPrompt } from '../prompts.js';
import {
  AnthropicAdapter,
  ClaudeCodeAdapter,
  parseRobustJSON,
} from '../distill-compat.js';
import type { Callout, CalloutType, LLMBackend } from '../distill-compat.js';
import type { DistillVoiceSettings } from '../types.js';

export interface GenerateCalloutInput {
  filePath: string;
  question: string;
  noteContent: string;
  currentSelection: string;
  currentLine: string;
  targetLanguage: string;
}

const VALID_TYPES: CalloutType[] = ['insight', 'connect', 'artifact', 'takeaway'];

function isCalloutType(value: unknown): value is CalloutType {
  return typeof value === 'string' && VALID_TYPES.includes(value as CalloutType);
}

function createAdapter(settings: DistillVoiceSettings): LLMBackend {
  if (settings.llmBackend === 'anthropic') {
    return new AnthropicAdapter();
  }

  return new ClaudeCodeAdapter({ claudeBinary: settings.claudeBinary });
}

function validateCallout(value: unknown, fallbackAnchor: string): Callout {
  if (typeof value !== 'object' || value === null) {
    throw new Error('callout JSON is not an object');
  }

  const obj = value as Record<string, unknown>;

  if (!isCalloutType(obj.type)) {
    throw new Error('callout.type must be insight|connect|artifact|takeaway');
  }

  if (typeof obj.body !== 'string' || obj.body.trim().length === 0) {
    throw new Error('callout.body must be a non-empty string');
  }

  const anchorText =
    typeof obj.anchor_text === 'string' && obj.anchor_text.trim().length > 0
      ? obj.anchor_text.trim()
      : fallbackAnchor;

  return {
    type: obj.type,
    anchor_text: anchorText,
    body: obj.body.trim(),
  };
}

function buildRetryPrompt(userPrompt: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `${userPrompt}

---

Your previous response failed strict JSON parsing/validation with this error:
${message}

Re-emit exactly one valid Callout JSON object. Output only JSON.`;
}

export class DistillCalloutService {
  constructor(private readonly getSettings: () => DistillVoiceSettings) {}

  async generateCallout(input: GenerateCalloutInput): Promise<Callout> {
    const settings = this.getSettings();
    const adapter = createAdapter(settings);
    const prompt = buildInteractiveCalloutPrompt(input);
    const fallbackAnchor =
      input.currentSelection.trim() ||
      input.currentLine.trim() ||
      input.question.trim();

    const raw = await adapter.generate(prompt.user, prompt.system);

    try {
      return validateCallout(parseRobustJSON(raw), fallbackAnchor);
    } catch (firstErr) {
      const retryRaw = await adapter.generate(buildRetryPrompt(prompt.user, firstErr), prompt.system);

      try {
        return validateCallout(parseRobustJSON(retryRaw), fallbackAnchor);
      } catch {
        throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
      }
    }
  }
}
