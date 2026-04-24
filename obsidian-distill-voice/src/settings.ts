import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DistillVoicePlugin from './main.js';

export class DistillVoiceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DistillVoicePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Distill Voice Companion' });
    containerEl.createEl('p', {
      text: 'Configure the LLM and speech path for the Obsidian voice loop.',
    });

    new Setting(containerEl)
      .setName('LLM backend')
      .setDesc('claude-code uses the local Claude Code binary. anthropic uses ANTHROPIC_API_KEY.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('claude-code', 'claude-code')
          .addOption('anthropic', 'anthropic')
          .setValue(this.plugin.settings.llmBackend)
          .onChange(async (value) => {
            this.plugin.settings.llmBackend = value as typeof this.plugin.settings.llmBackend;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Speech backend')
      .setDesc('macos-native is the zero-install path. whisper-cli records locally and finalizes after stop.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('macos-native', 'macos-native')
          .addOption('whisper-cli', 'whisper-cli')
          .setValue(this.plugin.settings.sttBackend)
          .onChange(async (value) => {
            this.plugin.settings.sttBackend = value as typeof this.plugin.settings.sttBackend;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Default hotkey')
      .setDesc('This sets the plugin default. Obsidian Hotkeys can still override it.')
      .addText((text) =>
        text
          .setPlaceholder('Mod+Shift+V')
          .setValue(this.plugin.settings.hotkey)
          .onChange(async (value) => {
            this.plugin.settings.hotkey = value.trim() || 'Mod+Shift+V';
            await this.plugin.saveSettings();
          }),
      )
      .addButton((button) =>
        button.setButtonText('Reload hint').onClick(() => {
          new Notice('Reload the plugin to apply the new default hotkey, or rebind it in Obsidian Hotkeys.');
        }),
      );

    new Setting(containerEl)
      .setName('Speech language')
      .setDesc('Use auto for mixed-language notes, or pin a locale like zh-CN / en-US.')
      .addText((text) =>
        text
          .setPlaceholder('auto')
          .setValue(this.plugin.settings.speechLanguage)
          .onChange(async (value) => {
            this.plugin.settings.speechLanguage = value.trim() || 'auto';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Response language')
      .setDesc('The language used in the generated callout body.')
      .addText((text) =>
        text
          .setPlaceholder('zh-CN')
          .setValue(this.plugin.settings.responseLanguage)
          .onChange(async (value) => {
            this.plugin.settings.responseLanguage = value.trim() || 'zh-CN';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Claude binary')
      .setDesc('Only used when the LLM backend is claude-code.')
      .addText((text) =>
        text
          .setPlaceholder('claude')
          .setValue(this.plugin.settings.claudeBinary)
          .onChange(async (value) => {
            this.plugin.settings.claudeBinary = value.trim() || 'claude';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Whisper binary')
      .setDesc('Only used when the speech backend is whisper-cli.')
      .addText((text) =>
        text
          .setPlaceholder('whisper-cli')
          .setValue(this.plugin.settings.whisperBinary)
          .onChange(async (value) => {
            this.plugin.settings.whisperBinary = value.trim() || 'whisper-cli';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Whisper model path')
      .setDesc('Defaults to the local ggml-base model path already drafted in Distill config.')
      .addText((text) =>
        text
          .setPlaceholder('~/.distill/models/ggml-base.bin')
          .setValue(this.plugin.settings.whisperModelPath)
          .onChange(async (value) => {
            this.plugin.settings.whisperModelPath =
              value.trim() || '~/.distill/models/ggml-base.bin';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Read callout aloud')
      .setDesc('After a callout is generated, play it back via the macOS `say` command. macOS only.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ttsEnabled).onChange(async (value) => {
          this.plugin.settings.ttsEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('TTS voice')
      .setDesc('macOS voice name. Run `say -v ?` in a terminal to see what is installed. Tingting is zh-CN.')
      .addText((text) =>
        text
          .setPlaceholder('Tingting')
          .setValue(this.plugin.settings.ttsVoice)
          .onChange(async (value) => {
            this.plugin.settings.ttsVoice = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('TTS rate (words per minute)')
      .setDesc('macOS `say -r` value. 180-220 is a comfortable reading cadence.')
      .addText((text) =>
        text
          .setPlaceholder('190')
          .setValue(String(this.plugin.settings.ttsRate))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value.trim(), 10);
            this.plugin.settings.ttsRate = Number.isFinite(parsed) && parsed > 0 ? parsed : 190;
            await this.plugin.saveSettings();
          }),
      );
  }
}
