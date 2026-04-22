import { z } from "zod";

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const SourceSchema = z.enum(["local", "burn", "pocket", "raindrop"]);

export const GeneralConfigSchema = z.object({
  data_dir: z.string().default("~/.distill"),
  default_source: SourceSchema.default("local"),
  default_language: z.string().default("zh-CN"),
  log_level: LogLevelSchema.default("info"),
});

export const FetcherLocalConfigSchema = z.object({
  path: z.string().default("./urls.txt"),
  watch: z.boolean().default(false),
});

export const FetcherBurnConfigSchema = z.object({
  mcp_token_env: z.string().default("BURN_MCP_TOKEN"),
  api_base: z.string().url().default("https://api.burn451.cloud"),
  since_hours: z.number().int().positive().default(24),
});

export const FetcherPocketConfigSchema = z
  .object({
    consumer_key_env: z.string().optional(),
  })
  .partial();

export const FetcherRaindropConfigSchema = z
  .object({
    token_env: z.string().optional(),
  })
  .partial();

export const FetcherConfigSchema = z.object({
  local: FetcherLocalConfigSchema.default({}),
  burn: FetcherBurnConfigSchema.default({}),
  pocket: FetcherPocketConfigSchema.default({}),
  raindrop: FetcherRaindropConfigSchema.default({}),
});

export const STTBackendNameSchema = z.enum([
  "whisper-cli",
  "groq-whisper",
  "elevenlabs-scribe",
  "macos-native",
]);

export const STTConfigSchema = z.object({
  backend: STTBackendNameSchema.default("whisper-cli"),
  fallback: STTBackendNameSchema.default("macos-native"),
  model_path: z.string().default("~/.distill/models/ggml-base.bin"),
  language: z.string().default("auto"),
});

export const TTSBackendNameSchema = z.enum([
  "edge-tts",
  "macos-say",
  "elevenlabs",
  "openai-tts",
]);

export const TTSConfigSchema = z.object({
  backend: TTSBackendNameSchema.default("edge-tts"),
  fallback: TTSBackendNameSchema.default("macos-say"),
  voice: z.string().default("zh-CN-XiaoxiaoNeural"),
  rate: z.string().default("+0%"),
  volume: z.string().default("+0%"),
});

export const LLMBackendNameSchema = z.enum([
  "claude-code",
  "cursor",
  "api-direct",
]);

export const LLMConfigSchema = z.object({
  backend: LLMBackendNameSchema.default("claude-code"),
  fallback: z.union([LLMBackendNameSchema, z.literal("none")]).default("none"),
  model: z.string().default("claude-opus-4-7"),
});

export const TriageConfigSchema = z.object({
  max_read: z.number().int().nonnegative().default(3),
  max_delegate: z.number().int().nonnegative().default(2),
  cluster_similarity_threshold: z.number().min(0).max(1).default(0.7),
});

export const VoiceConfigSchema = z.object({
  hotkey: z.string().default("alt+space"),
  push_to_talk: z.boolean().default(true),
  timeout_seconds: z.number().int().positive().default(60),
});

export const RendererNameSchema = z.enum(["markdown", "html", "both"]);
export const HtmlThemeSchema = z.enum(["default", "minimal", "dark"]);

export const ArtifactConfigSchema = z.object({
  format: RendererNameSchema.default("markdown"),
  html_theme: HtmlThemeSchema.default("default"),
  quote_ratio_target: z.number().min(0).max(1).default(0.3),
});

export const ConfigSchema = z.object({
  general: GeneralConfigSchema.default({}),
  fetcher: FetcherConfigSchema.default({}),
  stt: STTConfigSchema.default({}),
  tts: TTSConfigSchema.default({}),
  llm: LLMConfigSchema.default({}),
  triage: TriageConfigSchema.default({}),
  voice: VoiceConfigSchema.default({}),
  artifact: ArtifactConfigSchema.default({}),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type GeneralConfig = z.infer<typeof GeneralConfigSchema>;
export type FetcherLocalConfig = z.infer<typeof FetcherLocalConfigSchema>;
export type FetcherBurnConfig = z.infer<typeof FetcherBurnConfigSchema>;
export type FetcherPocketConfig = z.infer<typeof FetcherPocketConfigSchema>;
export type FetcherRaindropConfig = z.infer<typeof FetcherRaindropConfigSchema>;
export type FetcherConfig = z.infer<typeof FetcherConfigSchema>;
export type STTBackendName = z.infer<typeof STTBackendNameSchema>;
export type STTConfig = z.infer<typeof STTConfigSchema>;
export type TTSBackendName = z.infer<typeof TTSBackendNameSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type LLMBackendName = z.infer<typeof LLMBackendNameSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type TriageConfig = z.infer<typeof TriageConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type RendererName = z.infer<typeof RendererNameSchema>;
export type HtmlTheme = z.infer<typeof HtmlThemeSchema>;
export type ArtifactConfig = z.infer<typeof ArtifactConfigSchema>;

export type Config = z.infer<typeof ConfigSchema>;

export type Tier = 1 | 2 | 3;

export interface Article {
  url: string;
  title?: string;
  author?: string;
  fetched_at: string;
  raw_text: string;
  language?: string;
  word_count?: number;
  source_adapter: string;
}

export enum TriageDecision {
  READ = "read",
  DELEGATE = "delegate",
  SKIP = "skip",
  CLUSTER = "cluster",
}

export interface TriagedArticle extends Article {
  decision: TriageDecision;
  cluster_id?: string;
}

export interface TriagePlan {
  articles: TriagedArticle[];
  generated_at: string;
  config_snapshot: Config;
}

export type CalloutType = "insight" | "connect" | "artifact" | "takeaway";

export interface Callout {
  type: CalloutType;
  anchor_text: string;
  body: string;
}

export interface ClaudeInsights {
  tldr: string;
  why_read: string;
  pull_quotes: string[];
  callouts: Callout[];
  todo_drafts: string[];
}

export interface Fetcher {
  readonly name: string;
  readonly tier: Tier;
  fetch(): Promise<Article[]>;
}

export interface STTBackend {
  readonly name: string;
  readonly tier: Tier;
  transcribe(audio: Buffer, language?: string): Promise<string>;
}

export interface TTSBackend {
  readonly name: string;
  readonly tier: Tier;
  speak(text: string, voice?: string): Promise<Buffer>;
}

export interface LLMBackend {
  readonly name: string;
  readonly tier: Tier;
  generate(prompt: string, system?: string): Promise<string>;
}

export interface Renderer {
  readonly name: string;
  readonly tier: Tier;
  render(article: Article, insights: ClaudeInsights): Promise<string>;
}
