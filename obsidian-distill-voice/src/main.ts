import { MarkdownView, Notice, Plugin, type Hotkey } from 'obsidian';
import { DistillCalloutService } from './services/llm.js';
import { DistillVoiceModal } from './modal.js';
import { DistillVoiceSettingTab } from './settings.js';
import { DEFAULT_SETTINGS, type DistillVoiceSettings } from './types.js';

const HOTKEY_MODIFIERS = new Map<string, 'Mod' | 'Alt' | 'Shift'>([
  ['mod', 'Mod'],
  ['cmd', 'Mod'],
  ['command', 'Mod'],
  ['ctrl', 'Mod'],
  ['control', 'Mod'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
]);

function parseHotkey(value: string): Hotkey[] | undefined {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return undefined;
  }

  const key = parts[parts.length - 1];
  if (!key) {
    return undefined;
  }

  const modifiers = parts
    .slice(0, -1)
    .map((part) => HOTKEY_MODIFIERS.get(part.toLowerCase()))
    .filter((part): part is 'Mod' | 'Alt' | 'Shift' => part !== undefined);

  return [
    {
      modifiers,
      key: key.length === 1 ? key.toUpperCase() : key,
    },
  ];
}

export default class DistillVoicePlugin extends Plugin {
  settings: DistillVoiceSettings = DEFAULT_SETTINGS;
  readonly calloutService = new DistillCalloutService(() => this.settings);

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon('mic', 'Open Distill Voice Companion', () => {
      void this.openVoiceModal();
    });

    this.addCommand({
      id: 'open-distill-voice-companion',
      name: 'Open Distill Voice Companion',
      hotkeys: parseHotkey(this.settings.hotkey),
      callback: () => {
        void this.openVoiceModal();
      },
    });

    this.addSettingTab(new DistillVoiceSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openVoiceModal(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Open a markdown note before launching Distill Voice Companion.');
      return;
    }

    new DistillVoiceModal(this, view).open();
  }
}
