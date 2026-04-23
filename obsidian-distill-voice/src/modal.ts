import { MarkdownView, Modal, Notice } from 'obsidian';
import { insertCalloutAtCursor, renderCalloutBlock } from './markdown.js';
import { DistillSpeechSession } from './services/speech.js';
import type { Callout } from './distill-compat.js';
import type DistillVoicePlugin from './main.js';

export class DistillVoiceModal extends Modal {
  private transcript = '';
  private generatedCallout: Callout | null = null;
  private session: DistillSpeechSession | null = null;

  private shellEl!: HTMLDivElement;
  private transcriptArea!: HTMLTextAreaElement;
  private statusValueEl!: HTMLDivElement;
  private previewEl!: HTMLDivElement;
  private askButton!: HTMLButtonElement;
  private insertButton!: HTMLButtonElement;
  private recordButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;

  constructor(
    private readonly plugin: DistillVoicePlugin,
    private readonly view: MarkdownView,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('distill-voice-modal');

    const editor = this.view.editor;
    const file = this.view.file;
    const selection = editor.getSelection().trim();
    const currentLine = editor.getLine(editor.getCursor().line).trim();

    this.shellEl = contentEl.createDiv({ cls: 'distill-voice-shell' });

    const header = this.shellEl.createDiv({ cls: 'distill-voice-header' });
    header.createDiv({ cls: 'distill-voice-kicker', text: 'Distill voice companion' });

    const titleRow = header.createDiv({ cls: 'distill-voice-title-row' });
    const headingBlock = titleRow.createDiv();
    headingBlock.createEl('h1', {
      cls: 'distill-voice-title',
      text: 'Read, speak, insert.',
    });
    headingBlock.createEl('p', {
      cls: 'distill-voice-subtitle',
      text: 'Capture a spoken question, route it through Distill, and write the response back into the note you are already reading.',
    });

    const chipRow = header.createDiv({ cls: 'distill-voice-chip-row' });
    chipRow.createDiv({
      cls: 'distill-voice-chip',
      text: `LLM ${this.plugin.settings.llmBackend}`,
    });
    chipRow.createDiv({
      cls: 'distill-voice-chip',
      text: `STT ${this.plugin.settings.sttBackend}`,
    });
    chipRow.createDiv({
      cls: 'distill-voice-chip',
      text: `Hotkey ${this.plugin.settings.hotkey}`,
    });

    const grid = this.shellEl.createDiv({ cls: 'distill-voice-grid' });
    const primaryPanel = grid.createDiv({ cls: 'distill-voice-panel' });
    primaryPanel.createEl('h3', { text: 'Voice capture' });
    primaryPanel.createEl('p', {
      text: 'Live transcript appears below. Stop recording before you ask Distill for an inline reaction.',
    });

    const controls = primaryPanel.createDiv({ cls: 'distill-voice-controls' });
    this.recordButton = this.createButton(controls, 'Record', 'distill-voice-button-primary', () => {
      void this.startRecording();
    });
    this.stopButton = this.createButton(controls, 'Stop', 'distill-voice-button-secondary', () => {
      void this.stopRecording();
    });
    this.askButton = this.createButton(controls, 'Ask Distill', 'distill-voice-button-secondary', () => {
      void this.askDistill();
    });
    this.insertButton = this.createButton(controls, 'Insert callout', 'distill-voice-button-ghost', () => {
      this.insertCallout();
    });
    this.stopButton.disabled = true;
    this.askButton.disabled = true;
    this.insertButton.disabled = true;

    const status = primaryPanel.createDiv({ cls: 'distill-voice-status' });
    const statusText = status.createDiv({ cls: 'distill-voice-status-text' });
    statusText.createDiv({ cls: 'distill-voice-status-label', text: 'Status' });
    this.statusValueEl = statusText.createDiv({
      cls: 'distill-voice-status-value',
      text: 'Ready to listen',
    });
    const wave = status.createDiv({ cls: 'distill-voice-wave' });
    for (let i = 0; i < 5; i++) {
      wave.createSpan();
    }

    const transcriptCard = primaryPanel.createDiv({ cls: 'distill-voice-transcript' });
    this.transcriptArea = transcriptCard.createEl('textarea', {
      attr: {
        placeholder: 'Your spoken question will land here. You can edit it before asking Distill.',
      },
    });
    this.transcriptArea.value = this.transcript;
    this.transcriptArea.addEventListener('input', () => {
      this.transcript = this.transcriptArea.value;
      this.askButton.disabled = this.transcript.trim().length === 0;
    });

    primaryPanel.createDiv({
      cls: 'distill-voice-hint',
      text: 'When whisper-cli is selected, the final transcript replaces the live preview after recording stops.',
    });

    const sidePanel = grid.createDiv({ cls: 'distill-voice-meta' });
    sidePanel.createDiv({ cls: 'distill-voice-panel' });
    const metaPanel = sidePanel.children[0] as HTMLDivElement;
    metaPanel.createEl('h3', { text: 'Current context' });
    metaPanel.createEl('p', {
      text: 'The active note, selection, and current line are included in the prompt so the response stays anchored to what you are reading.',
    });

    this.buildMetaBlock(metaPanel, 'Active note', file?.path ?? '(no file)');
    this.buildMetaBlock(metaPanel, 'Selection', selection || '(no selection)');
    this.buildMetaBlock(metaPanel, 'Current line', currentLine || '(no current line)');

    const previewPanel = sidePanel.createDiv({ cls: 'distill-voice-panel' });
    previewPanel.createEl('h3', { text: 'Response preview' });
    previewPanel.createEl('p', {
      text: 'Distill returns one callout object. Review it here before insertion.',
    });
    this.previewEl = previewPanel.createDiv({ cls: 'distill-voice-preview distill-voice-callout' });
    this.previewEl.setText('No callout generated yet.');
  }

  onClose(): void {
    void this.session?.cancel();
    this.session = null;
    this.contentEl.empty();
  }

  private createButton(
    parent: HTMLElement,
    label: string,
    className: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: `distill-voice-button ${className}`,
      text: label,
    });
    button.addEventListener('click', onClick);
    return button;
  }

  private buildMetaBlock(parent: HTMLElement, label: string, value: string): void {
    const block = parent.createDiv({ cls: 'distill-voice-meta-block' });
    block.createDiv({ cls: 'distill-voice-meta-label', text: label });
    block.createDiv({ cls: 'distill-voice-meta-value', text: value });
  }

  private setStatus(value: string): void {
    this.statusValueEl.setText(value);
  }

  private setRecording(recording: boolean): void {
    this.shellEl.toggleClass('is-recording', recording);
    this.recordButton.disabled = recording;
    this.stopButton.disabled = !recording;
  }

  private async startRecording(): Promise<void> {
    if (this.session) {
      return;
    }

    try {
      this.generatedCallout = null;
      this.insertButton.disabled = true;
      this.previewEl.setText('No callout generated yet.');
      this.session = await DistillSpeechSession.start({
        backend: this.plugin.settings.sttBackend,
        language: this.plugin.settings.speechLanguage,
        whisperBinary: this.plugin.settings.whisperBinary,
        whisperModelPath: this.plugin.settings.whisperModelPath,
        onTranscript: (value) => {
          this.transcript = value;
          this.transcriptArea.value = value;
          this.askButton.disabled = value.trim().length === 0;
        },
        onStatus: (value) => this.setStatus(value),
      });
      this.setRecording(true);
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
      this.setStatus('Recording failed to start');
      this.session = null;
    }
  }

  private async stopRecording(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      const transcript = await this.session.stop();
      this.transcript = transcript;
      this.transcriptArea.value = transcript;
      this.askButton.disabled = transcript.trim().length === 0;
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
      this.setStatus('Recording failed');
    } finally {
      this.session = null;
      this.setRecording(false);
    }
  }

  private async askDistill(): Promise<void> {
    const question = this.transcriptArea.value.trim();
    if (question.length === 0) {
      new Notice('Record or type a question first.');
      return;
    }

    const editor = this.view.editor;
    const filePath = this.view.file?.path ?? '(unsaved note)';
    const currentSelection = editor.getSelection();
    const currentLine = editor.getLine(editor.getCursor().line);

    this.askButton.disabled = true;
    this.setStatus('Asking Distill');

    try {
      const callout = await this.plugin.calloutService.generateCallout({
        filePath,
        question,
        noteContent: editor.getValue(),
        currentSelection,
        currentLine,
        targetLanguage: this.plugin.settings.responseLanguage,
      });
      this.generatedCallout = callout;
      this.previewEl.setText(renderCalloutBlock(callout));
      this.insertButton.disabled = false;
      this.setStatus('Callout ready');
    } catch (err) {
      this.previewEl.setText(err instanceof Error ? err.message : String(err));
      this.setStatus('Callout generation failed');
      new Notice(err instanceof Error ? err.message : String(err));
    } finally {
      this.askButton.disabled = this.transcriptArea.value.trim().length === 0;
    }
  }

  private insertCallout(): void {
    if (!this.generatedCallout) {
      return;
    }

    insertCalloutAtCursor(this.view.editor, this.generatedCallout);
    this.setStatus('Callout inserted');
    new Notice('Distill callout inserted.');
    this.close();
  }
}
