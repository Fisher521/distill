export type DistillVoiceLLMBackend = 'claude-code' | 'anthropic';
export type DistillVoiceSTTBackend = 'macos-native' | 'whisper-cli';

export interface DistillVoiceSettings {
  llmBackend: DistillVoiceLLMBackend;
  sttBackend: DistillVoiceSTTBackend;
  hotkey: string;
  speechLanguage: string;
  responseLanguage: string;
  whisperBinary: string;
  whisperModelPath: string;
  claudeBinary: string;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
}

export const DEFAULT_SETTINGS: DistillVoiceSettings = {
  llmBackend: 'claude-code',
  sttBackend: 'macos-native',
  hotkey: 'Mod+Shift+V',
  speechLanguage: 'auto',
  responseLanguage: 'zh-CN',
  whisperBinary: 'whisper-cli',
  whisperModelPath: '~/.distill/models/ggml-base.bin',
  claudeBinary: 'claude',
  ttsEnabled: true,
  ttsVoice: 'Sandy (Chinese (China mainland))',
  ttsRate: 190,
};
